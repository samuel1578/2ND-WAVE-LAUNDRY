import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  enquiryDetailFields,
  enquiryDetailFieldsFromValues,
} from "../src/lib/enquiries/presentation";
import {
  buildEnquiryReceivedParams,
  validateEmailTemplateParams,
} from "../src/lib/email/templates";

const COMMERCIAL = {
  kind: "commercial" as const,
  name: "Amina Mensah",
  business: "Sample Business",
  phone: "+233 59 522 4280",
  email: "amina@example.test",
  // Historical shared-column values that the commercial workflow never collects.
  topic: "Services",
  message: "Legacy message that must not be projected",
  details: {
    items: "Hotel linen, approximately 40 pieces",
    frequency: "Weekly",
    location: "",
    requirements: "",
  },
};

const GENERAL = {
  kind: "general" as const,
  name: "Amina Mensah",
  business: null,
  phone: "+233 59 522 4280",
  email: null,
  topic: "Services",
  message: "Could you tell me more about wash and fold?",
  details: {},
};

test("commercial details contain only the collected commercial fields", () => {
  const fields = enquiryDetailFields(COMMERCIAL);
  assert.deepEqual(
    fields.map((field) => field.key),
    ["business", "name", "phone", "email", "items", "frequency"],
  );
  const rendered = fields.map((field) => `${field.label}: ${field.value}`).join("\n");
  assert.doesNotMatch(rendered, /topic/i);
  assert.doesNotMatch(rendered, /message/i);
  assert.doesNotMatch(rendered, /Legacy message/);
  assert.equal(fields.find((field) => field.key === "items")?.label, "Items and quantities");
  // Optional values that were never supplied are omitted, not shown as "Not provided".
  assert.equal(fields.some((field) => field.key === "location"), false);
  assert.equal(fields.some((field) => field.key === "requirements"), false);
});

test("commercial details include optional values only when supplied", () => {
  const fields = enquiryDetailFields({
    ...COMMERCIAL,
    email: null,
    details: {
      items: "40 pieces",
      frequency: "Fortnightly",
      location: "East Legon",
      requirements: "Collect before 9am",
    },
  });
  assert.deepEqual(
    fields.map((field) => field.key),
    ["business", "name", "phone", "items", "frequency", "location", "requirements"],
  );
  assert.equal(fields.at(-1)?.value, "Collect before 9am");
});

test("general enquiry details keep topic and message", () => {
  const fields = enquiryDetailFields(GENERAL);
  assert.deepEqual(
    fields.map((field) => field.key),
    ["name", "business", "phone", "email", "topic", "message"],
  );
  assert.equal(fields.find((field) => field.key === "topic")?.value, "Services");
  assert.equal(
    fields.find((field) => field.key === "message")?.value,
    GENERAL.message,
  );
});

test("demo-style value maps follow the same projection", () => {
  const fields = enquiryDetailFieldsFromValues("commercial", {
    business: "Sample Business",
    name: "Amina",
    phone: "059 522 4280",
    email: "",
    items: "40 pieces",
    topic: "Services",
    message: "ignored",
  });
  assert.deepEqual(fields.map((field) => field.key), [
    "business",
    "name",
    "phone",
    "items",
  ]);
});

test("commercial notification parameters omit the topic parameter", () => {
  const params = buildEnquiryReceivedParams(
    {
      enquiryId: "123e4567-e89b-12d3-a456-426614174000",
      kind: "commercial",
      name: "Amina Mensah",
      business: "Sample Business",
      phone: "+233 59 522 4280",
      topic: "Services",
    },
    { siteUrl: "https://2ndwave.example" },
  );
  assert.deepEqual(Object.keys(params).sort(), [
    "business",
    "enquiryUrl",
    "kind",
    "name",
    "phone",
    "websiteUrl",
  ]);
  assert.equal(params.kind, "Commercial quote request");
  assert.doesNotThrow(() => validateEmailTemplateParams("enquiry_received", params));
});

test("general notification parameters keep the topic", () => {
  const params = buildEnquiryReceivedParams(
    {
      enquiryId: "123e4567-e89b-12d3-a456-426614174000",
      kind: "general",
      name: "Amina Mensah",
      business: null,
      phone: "+233 59 522 4280",
      topic: "Services",
    },
    { siteUrl: "https://2ndwave.example" },
  );
  assert.equal(params.topic, "Services");
  assert.equal(params.business, "Not provided");
  assert.doesNotThrow(() => validateEmailTemplateParams("enquiry_received", params));
});

test("admin detail view renders the kind-aware projection", () => {
  const source = readFileSync("src/components/admin/leads.tsx", "utf8");
  assert.match(source, /item\.detail\.map/);
  assert.doesNotMatch(source, /Object\.entries\(item\.fields\)\.map/);
  assert.match(source, /enquiryDetailFields\(record\)/);
});
