import test from "node:test";
import assert from "node:assert/strict";
import type { Settings } from "../src/lib/contracts";
import {
    settingsForWrite,
    validateSettings,
} from "../src/lib/website/settings-validation";

const validSettings: Settings = {
    email: "office@example.com",
    phone: "059 522 4280",
    whatsapp: "233595224280",
    instagram: "https://www.instagram.com/yourname",
    tiktok: "https://www.tiktok.com/@yourname",
    facebook: "https://www.facebook.com/yourname",
    acceptBookings: true,
    start: "07:00",
    cutoff: "11:00",
    end: "17:00",
    newsletter: true,
    version: 3,
    bookingVersion: 5,
};

test("validateSettings accepts valid settings and empty social links", () => {
    assert.equal(validateSettings(validSettings), null);
    assert.equal(
        validateSettings({
            ...validSettings,
            email: "",
            instagram: "",
            tiktok: "",
            facebook: "",
        }),
        null,
    );
});

test("validateSettings rejects unsafe or mismatched social URLs", () => {
    for (const instagram of [
        "javascript:alert(1)",
        "http://www.instagram.com/yourname",
        "https://www.facebook.com/yourname",
    ]) {
        assert.match(
            validateSettings({ ...validSettings, instagram }) ?? "",
            /HTTPS social links/,
        );
    }
    assert.equal(
        validateSettings({
            ...validSettings,
            facebook: "https://business.fb.me/page",
        }),
        null,
    );
});

test("validateSettings rejects bad email and phone values", () => {
    assert.equal(
        validateSettings({ ...validSettings, email: "not-an-email" }),
        "Enter a valid email address.",
    );
    assert.equal(
        validateSettings({ ...validSettings, phone: "123" }),
        "Enter a valid phone number.",
    );
    assert.equal(
        validateSettings({ ...validSettings, whatsapp: "bad-number" }),
        "Enter a valid phone number.",
    );
});

test("validateSettings enforces pickup start < cutoff < end", () => {
    for (const times of [
        { start: "11:00", cutoff: "11:00", end: "17:00" },
        { start: "07:00", cutoff: "18:00", end: "17:00" },
        { start: "25:00", cutoff: "26:00", end: "27:00" },
    ]) {
        assert.equal(
            validateSettings({ ...validSettings, ...times }),
            "Pickup start time must be before the express cutoff and pickup end time.",
        );
    }
});

test("settings write preparation rejects invalid values using the same messages", () => {
    const invalidCases: Array<[Partial<Settings>, string]> = [
        [{ instagram: "javascript:alert(1)" }, "HTTPS social links"],
        [{ instagram: "http://instagram.com/name" }, "HTTPS social links"],
        [{ instagram: "https://facebook.com/name" }, "HTTPS social links"],
        [{ email: "bad-email" }, "valid email address"],
        [{ phone: "123" }, "valid phone number"],
        [{ start: "11:00" }, "Pickup start time"],
    ];
    for (const [patch, message] of invalidCases) {
        assert.throws(
            () => settingsForWrite({ ...validSettings, ...patch }),
            new RegExp(message),
        );
    }
});

test("settings write preparation trims known strings and strips unknown fields", () => {
    const safe = settingsForWrite({
        ...validSettings,
        email: " office@example.com ",
        instagram: " ",
        tiktok: "",
        facebook: "",
        phone: " 059 522 4280 ",
        whatsapp: " 233595224280 ",
        unknownCredential: "must not reach persistence",
    });
    assert.deepEqual(safe, {
        ...validSettings,
        email: "office@example.com",
        phone: "059 522 4280",
        whatsapp: "233595224280",
        instagram: "",
        tiktok: "",
        facebook: "",
    });
    assert.equal("unknownCredential" in safe, false);
});
