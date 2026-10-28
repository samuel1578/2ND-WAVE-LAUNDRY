import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = "supabase/migrations";
const PRELUDE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
`;
let db: PGlite;
let actor: string;

before(async () => {
  db = new PGlite();
  await db.exec(PRELUDE);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    try { await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8")); }
    catch (error) { throw new Error(`migration failed: ${file}: ${(error as Error).message}`); }
  }
  actor = randomUUID();
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'admin@example.test')", [actor]);
  await db.query("INSERT INTO public.admin_profiles(user_id,role,display_name) VALUES($1,'full_admin','Test Admin')", [actor]);
});
after(async () => { await db.close(); });

function bookingPayload() {
  return {
    customer_name: "Ama Mensah", customer_phone: "+233595224280", customer_email: "ama@example.test",
    whatsapp_phone: null, same_whatsapp: true, contact_method: "phone", item_category: "clothing",
    load_size: "1 Standard Bag", customer_notes: "", pickup_address: "1 Test Street", pickup_landmark: "",
    pickup_map_url: null, transport_preference: "no_preference", requested_date: "2099-01-01",
    requested_time: "09:00", express_requested: false, notice_version: "2026-10-01",
  };
}
async function createBooking() {
  const { rows } = await db.query<{ result: { booking_id: string } }>(
    "SELECT public.booking_submit($1::jsonb,$2::jsonb,$3,'public_booking_form',$4) AS result",
    [JSON.stringify(bookingPayload()), JSON.stringify(["wash-ironing-fold"]), randomUUID(), randomUUID()],
  );
  return rows[0].result.booking_id;
}
async function createTest(template = "booking_created", recipient = "qa@example.test") {
  const context = { booking: {
    reference: "2W-ABCDEFGHJK", customerName: "Template Preview", serviceTitles: ["Wash, Ironing & Fold"],
    requestedDate: "2099-01-01", requestedTime: "09:00", agreedPickupAt: "2099-01-01T09:00:00Z",
    agreedFee: 50, currency: "GHS", branch: { title: "Ashaimanâ€“Atadeka" },
  } };
  const { rows } = await db.query<{ id: string }>(
    "SELECT public.email_outbox_create_test_send($1::public.email_template,$2,$3::jsonb,$4,$5) AS id",
    [template, recipient, JSON.stringify(context), actor, randomUUID()],
  );
  return rows[0].id;
}

test("controlled test rows are bookingless, fixture-only and atomically audited", async () => {
  const id = await createTest();
  const { rows } = await db.query<{ booking_id: string | null; is_test: boolean; recipient_email: string; status: string }>(
    "SELECT booking_id,is_test,recipient_email,status::text FROM public.email_outbox WHERE id=$1", [id],
  );
  assert.equal(rows[0].booking_id, null);
  assert.equal(rows[0].is_test, true);
  assert.equal(rows[0].recipient_email, "qa@example.test");
  assert.equal(rows[0].status, "pending");
  const audit = await db.query<{ action: string; after_state: { template: string } }>(
    "SELECT action,after_state FROM public.audit_events WHERE entity_id=$1", [id],
  );
  assert.equal(audit.rows[0].action, "email.test_queued");
  assert.equal(audit.rows[0].after_state.template, "booking_created");
});

test("controlled test rejects Operational Admin, invalid recipient and oversized fixture", async () => {
  const ops = randomUUID();
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'ops@example.test')", [ops]);
  await db.query("INSERT INTO public.admin_profiles(user_id,role,display_name) VALUES($1,'operational_admin','Ops')", [ops]);
  const goodContext = JSON.stringify({ booking: {
    reference: "2W-ABCDEFGHJK", customerName: "Template Preview",
    serviceTitles: ["Wash, Ironing & Fold"], requestedDate: "2099-01-01",
    requestedTime: "09:00", agreedPickupAt: "2099-01-01T09:00:00Z",
    agreedFee: 50, currency: "GHS", branch: { title: "Ashaiman–Atadeka" },
  } });
  await assert.rejects(db.query("SELECT public.email_outbox_create_test_send('booking_created','qa@example.test',$1::jsonb,$2,$3)", [goodContext, ops, randomUUID()]), /active Full Admin/);
  await assert.rejects(db.query("SELECT public.email_outbox_create_test_send('booking_created','invalid',$1::jsonb,$2,$3)", [goodContext, actor, randomUUID()]), /controlled recipient/);
  await assert.rejects(db.query("SELECT public.email_outbox_create_test_send('booking_created','qa@example.test',$1::jsonb,$2,$3)", [JSON.stringify({ booking: { reference: "2W-ABCDEFGHJK" }, extra: 1 }), actor, randomUUID()]), /valid fixed template fixture/);
  await assert.rejects(db.query("SELECT public.email_outbox_create_test_send('staff_order_pending','qa@example.test',$1::jsonb,$2,$3)", [goodContext, actor, randomUUID()]), /valid staff fixture/);
  await assert.rejects(db.query("SELECT public.email_outbox_create_test_send('booking_created','qa@example.test',$1::jsonb,$2,$3)", [JSON.stringify({ booking: { value: "x".repeat(9000) } }), actor, randomUUID()]), /valid fixed template fixture/);
});

test("deliberate resend creates a new idempotency key and records actor, source and reason", async () => {
  const bookingId = await createBooking();
  const source = (await db.query<{ id: string }>("SELECT id FROM public.email_outbox WHERE booking_id=$1", [bookingId])).rows[0].id;
  await db.query(
    "UPDATE public.email_outbox SET status='sending',attempt_count=1,locked_at=now(),locked_by='sender',lease_expires_at=now()+interval '2 minutes' WHERE id=$1", [source],
  );
  await db.query("SELECT public.email_outbox_mark_sent($1,'sender','provider-accepted')", [source]);
  const { rows } = await db.query<{ id: string }>(
    "SELECT public.email_outbox_resend($1,$2,'Owner-approved correction', $3) AS id", [source, actor, randomUUID()],
  );
  const newId = rows[0].id;
  assert.notEqual(newId, source);
  const resend = (await db.query<{ status: string; resend_of: string; idempotency_key: string; attempt_count: number }>(
    "SELECT status::text,resend_of,idempotency_key,attempt_count FROM public.email_outbox WHERE id=$1", [newId],
  )).rows[0];
  assert.equal(resend.status, "pending");
  assert.equal(resend.resend_of, source);
  assert.notEqual(resend.idempotency_key, `booking:${bookingId}:booking_created:v1`);
  assert.match(resend.idempotency_key, /^email-resend:/);
  assert.equal(resend.attempt_count, 0);
  const audit = (await db.query<{ action: string; reason: string; before_state: { source_outbox_id: string }; after_state: { status: string } }>(
    "SELECT action,reason,before_state,after_state FROM public.audit_events WHERE entity_id=$1", [newId],
  )).rows[0];
  assert.equal(audit.action, "email.resent");
  assert.equal(audit.reason, "Owner-approved correction");
  assert.equal(audit.before_state.source_outbox_id, source);
  assert.equal(audit.after_state.status, "pending");
  await assert.rejects(db.query("SELECT public.email_outbox_resend($1,$2,'', $3)", [source, actor, randomUUID()]), /short, single-line reason/);
});

test("test and resend RPCs remain service-role-only", async () => {
  const { rows } = await db.query<Record<string, boolean>>(`SELECT
    has_function_privilege('anon','public.email_outbox_create_test_send(public.email_template,text,jsonb,uuid,uuid)','EXECUTE') AS anon_test,
    has_function_privilege('authenticated','public.email_outbox_resend(uuid,uuid,text,uuid)','EXECUTE') AS auth_resend,
    has_function_privilege('service_role','public.email_outbox_resend(uuid,uuid,text,uuid)','EXECUTE') AS service_resend`);
  assert.equal(rows[0].anon_test, false);
  assert.equal(rows[0].auth_resend, false);
  assert.equal(rows[0].service_resend, true);
});
