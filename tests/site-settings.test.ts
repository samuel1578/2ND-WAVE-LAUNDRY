import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSiteSettings,
  socialLinks,
  telHref,
  whatsappHref,
} from "../src/lib/contact-links";
import { contact } from "../src/lib/content";

test("telHref normalises Ghana numbers to +233", () => {
  assert.equal(telHref("059 522 4280"), "tel:+233595224280");
  assert.equal(telHref("233595224280"), "tel:+233595224280");
  assert.equal(telHref("+233 59 522 4280"), "tel:+233595224280");
  assert.equal(telHref("(059) 522-4280"), "tel:+233595224280");
  assert.equal(telHref(""), "");
});

test("whatsappHref keeps digits only", () => {
  assert.equal(whatsappHref("233595224280"), "https://wa.me/233595224280");
  assert.equal(whatsappHref("+233 59 522 4280"), "https://wa.me/233595224280");
  assert.equal(whatsappHref("059 522 4280"), "https://wa.me/233595224280");
  assert.equal(
    whatsappHref(contact.whatsapp),
    "https://wa.me/233595224280",
  );
  assert.equal(whatsappHref(""), "");
});

test("footer shows Facebook only when it is set", () => {
  const withoutFacebook = socialLinks(
    resolveSiteSettings({
      phone: "059 522 4280",
      whatsapp: "233595224280",
      instagram: "https://www.instagram.com/2ndwave_laundry/",
      tiktok: "https://www.tiktok.com/@2ndwave.com",
      facebook: "",
    }),
  );
  assert.deepEqual(
    withoutFacebook.map((link) => link.label),
    ["Instagram", "TikTok"],
  );

  const withFacebook = socialLinks(
    resolveSiteSettings({
      phone: "059 522 4280",
      whatsapp: "233595224280",
      instagram: "https://www.instagram.com/2ndwave_laundry/",
      tiktok: "https://www.tiktok.com/@2ndwave.com",
      facebook: "https://www.facebook.com/2ndwave",
    }),
  );
  assert.deepEqual(
    withFacebook.map((link) => link.label),
    ["Instagram", "TikTok", "Facebook"],
  );
});

test("a cleared social link disappears instead of falling back", () => {
  const settings = resolveSiteSettings({
    email: "info@example.com",
    phone: "059 522 4280",
    whatsapp: "233595224280",
    instagram: "",
    tiktok: "https://www.tiktok.com/@2ndwave.com",
    facebook: "",
  });
  assert.equal(settings.instagram, "");
  assert.equal(settings.facebook, "");
  assert.deepEqual(socialLinks(settings).map((link) => link.label), ["TikTok"]);
});

test("empty phone, whatsapp and email fall back to the built-in contact defaults", () => {
  const settings = resolveSiteSettings({
    email: "",
    phone: "",
    whatsapp: "",
    instagram: "",
    tiktok: "",
    facebook: "",
  });
  assert.equal(settings.phone, contact.phone);
  assert.equal(settings.whatsapp, contact.whatsapp);
  assert.equal(settings.email, contact.emails.info);
  assert.equal(settings.phone, "059 522 4280");
  assert.equal(settings.email, "info@2ndwavelaundry.com");
});

test("demo mode and unconfigured Supabase render the contact defaults", () => {
  for (const stored of [null, undefined]) {
    const settings = resolveSiteSettings(stored);
    assert.equal(settings.phone, contact.phone);
    assert.equal(settings.whatsapp, contact.whatsapp);
    assert.equal(settings.email, contact.emails.info);
    assert.equal(settings.instagram, contact.instagram);
    assert.equal(settings.tiktok, contact.tiktok);
    assert.equal(settings.facebook, "");
    assert.equal(settings.pickupStart, "07:00");
    assert.equal(settings.pickupEnd, "17:00");
    assert.deepEqual(socialLinks(settings).map((link) => link.label), [
      "Instagram",
      "TikTok",
    ]);
  }
});

test("stored contact details win over defaults", () => {
  const settings = resolveSiteSettings({
    email: "hello@example.com",
    pickupStart: "07:30",
    pickupEnd: "17:45",
    phone: "020 000 0000",
    whatsapp: "0200000000",
    instagram: "https://www.instagram.com/example/",
    tiktok: "",
    facebook: "https://www.facebook.com/example",
  });
  assert.equal(settings.phone, "020 000 0000");
  assert.equal(settings.pickupStart, "07:30");
  assert.equal(settings.pickupEnd, "17:45");
  assert.equal(telHref(settings.phone), "tel:+233200000000");
  assert.equal(whatsappHref(settings.whatsapp), "https://wa.me/233200000000");
  assert.equal(settings.email, "hello@example.com");
});
