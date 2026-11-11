import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AI_CHAT_SETTINGS_DEFAULTS,
  AI_CHAT_SETTINGS_LIMITS,
  checkAiChatSettings,
} from "./ai-chat-settings.js";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  roleTemplateHasPermission,
} from "./auth.js";

const valid = {
  offerEnabled: true,
  contactRequestEnabled: false,
  contactRecipientEmail: null,
  messageRetentionDays: 180,
  contactHandledRetentionDays: 30,
  contactUnhandledRetentionDays: 90,
};

const refused = (over: Record<string, unknown>) =>
  checkAiChatSettings({ ...valid, ...over });

describe("checkAiChatSettings (the server's rule and the form's)", () => {
  it("the plan's proposed defaults are themselves a valid save, and the offer and the contact request are OFF in them", () => {
    const checked = checkAiChatSettings(AI_CHAT_SETTINGS_DEFAULTS);
    assert.equal(checked.ok, true);
    assert.deepEqual(AI_CHAT_SETTINGS_DEFAULTS, {
      ...valid,
      offerEnabled: false,
    });
    assert.equal(AI_CHAT_SETTINGS_DEFAULTS.offerEnabled, false);
    assert.equal(AI_CHAT_SETTINGS_DEFAULTS.contactRequestEnabled, false);
  });

  it("S4: the message retention is a whole number from 7 to 365, refused otherwise, never clamped", () => {
    const { min, max } = AI_CHAT_SETTINGS_LIMITS.messageRetentionDays;
    assert.equal(refused({ messageRetentionDays: min }).ok, true);
    assert.equal(refused({ messageRetentionDays: max }).ok, true);
    for (const value of [
      min - 1,
      max + 1,
      0,
      -30,
      30.5,
      "30",
      null,
      undefined,
      NaN,
      Infinity,
    ])
      assert.equal(
        refused({ messageRetentionDays: value }).ok,
        false,
        String(value),
      );
  });

  it("the contact retentions are whole numbers from 7 to 180", () => {
    const { min, max } = AI_CHAT_SETTINGS_LIMITS.contactRetentionDays;
    for (const key of [
      "contactHandledRetentionDays",
      "contactUnhandledRetentionDays",
    ]) {
      assert.equal(
        refused({ [key]: min, contactUnhandledRetentionDays: max }).ok,
        true,
        key,
      );
      assert.equal(refused({ [key]: min - 1 }).ok, false, key);
      assert.equal(refused({ [key]: max + 1 }).ok, false, key);
      assert.equal(refused({ [key]: 12.5 }).ok, false, key);
    }
  });

  it("an unhandled request is not kept shorter than a handled one", () => {
    assert.equal(
      refused({
        contactHandledRetentionDays: 60,
        contactUnhandledRetentionDays: 60,
      }).ok,
      true,
    );
    const checked = refused({
      contactHandledRetentionDays: 60,
      contactUnhandledRetentionDays: 59,
    });
    assert.equal(checked.ok, false);
    assert.match(checked.ok ? "" : checked.error, /nem lehet rövidebb/);
  });

  it("the switches are booleans, not truthy values", () => {
    for (const value of ["true", 1, 0, null, undefined]) {
      assert.equal(refused({ offerEnabled: value }).ok, false, String(value));
      assert.equal(
        refused({ contactRequestEnabled: value }).ok,
        false,
        String(value),
      );
    }
  });

  it("the contact request cannot be switched on without a recipient, and the recipient must look like an address", () => {
    assert.equal(refused({ contactRequestEnabled: true }).ok, false);
    assert.equal(
      refused({ contactRequestEnabled: true, contactRecipientEmail: "   " }).ok,
      false,
    );
    assert.equal(
      refused({
        contactRequestEnabled: true,
        contactRecipientEmail: "ugyfel@acropora.hu",
      }).ok,
      true,
    );
    for (const value of [
      "nem cim",
      "a@b",
      "a b@c.hu",
      "@c.hu",
      "a@@c.hu",
      42,
      {},
    ]) {
      assert.equal(
        refused({ contactRecipientEmail: value }).ok,
        false,
        JSON.stringify(value),
      );
    }
    assert.equal(
      refused({ contactRecipientEmail: `${"a".repeat(250)}@c.hu` }).ok,
      false,
      "over 254 characters",
    );
  });

  it("the recipient is trimmed, and an empty one is stored as null", () => {
    const trimmed = refused({ contactRecipientEmail: "  info@acropora.hu " });
    assert.equal(
      trimmed.ok && trimmed.value.contactRecipientEmail,
      "info@acropora.hu",
    );
    const empty = refused({ contactRecipientEmail: "" });
    assert.equal(empty.ok && empty.value.contactRecipientEmail, null);
  });

  it("a body that is not an object is refused, and unknown fields do not travel into the value", () => {
    for (const body of [null, undefined, "x", 3, []])
      assert.equal(checkAiChatSettings(body).ok, false);
    const checked = checkAiChatSettings({
      ...valid,
      isAdmin: true,
      updatedById: "x",
    });
    assert.equal(checked.ok, true);
    assert.deepEqual(
      Object.keys(checked.ok ? checked.value : {}).sort(),
      Object.keys(valid).sort(),
    );
  });

  it("every refusal is one Hungarian sentence the form can show as it is", () => {
    for (const bad of [
      { messageRetentionDays: 1 },
      { contactRequestEnabled: true },
      { contactRecipientEmail: "x" },
      { offerEnabled: 1 },
    ]) {
      const checked = refused(bad);
      assert.equal(checked.ok, false);
      const error = checked.ok ? "" : checked.error;
      assert.match(error, /^[A-ZÁÉÍÓÖŐÚÜŰ]/);
      assert.match(error, /\.$/);
    }
  });
});

describe("AI_SETTINGS_MANAGE: who may decide what happens to a customer's chat data", () => {
  it("OWNER and ADMIN have it; the MANAGER does not, and no other role template does", () => {
    assert.equal(
      roleTemplateHasPermission("OWNER", PERMISSIONS.AI_SETTINGS_MANAGE),
      true,
    );
    assert.equal(
      roleTemplateHasPermission("ADMIN", PERMISSIONS.AI_SETTINGS_MANAGE),
      true,
    );
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      if (role === "OWNER" || role === "ADMIN") continue;
      assert.equal(
        roleTemplateHasPermission(
          role as never,
          PERMISSIONS.AI_SETTINGS_MANAGE,
        ),
        false,
        role,
      );
    }
  });
});
