import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

import { ReefClubAuthController } from "./reefclub-auth.controller.js";
import { ReefClubRegisterDto } from "./reefclub-auth.dto.js";
import {
  PRIVACY_VERSION_CHANGED,
  REEFCLUB_PRIVACY_NOTICE_VERSION,
} from "./reefclub-consent.js";

/**
 * THE REGISTRATION'S PRIVACY-NOTICE VERSION IS THE SERVER'S (card 33780bcb), the
 * same rule as the sharing consent: only the server's own current version is
 * accepted, and the page reads it from a public route. What must fail: a
 * registration carrying a version the user never saw; the check running after
 * the always-202 answer (it would then say something about the address); the
 * public route answering another value than the constant.
 */
async function problems(body: Record<string, unknown>) {
  const dto = plainToInstance(ReefClubRegisterDto, body);
  return (await validate(dto)).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );
}

const valid = {
  email: "uj@example.test",
  password: "hosszu-jelszo-1",
  consentVersion: REEFCLUB_PRIVACY_NOTICE_VERSION,
};

describe("the registration DTO", () => {
  it("accepts the server's current version", async () => {
    assert.deepEqual(await problems(valid), []);
  });

  it("refuses any other version with the one 'text changed' message, before the always-202 answer", async () => {
    assert.deepEqual(
      await problems({ ...valid, consentVersion: "regi-verzio" }),
      [PRIVACY_VERSION_CHANGED],
    );
    // still shaped like a version, still not the server's: refused
    assert.deepEqual(
      await problems({ ...valid, consentVersion: "adatkezeles-2025-01-01" }),
      [PRIVACY_VERSION_CHANGED],
    );
  });

  it("the check is the same for a new and an existing address: it looks at the version only", async () => {
    const a = await problems({
      ...valid,
      email: "uj@example.test",
      consentVersion: "x1",
    });
    const b = await problems({
      ...valid,
      email: "van@example.test",
      consentVersion: "x1",
    });
    assert.deepEqual(a, b);
  });
});

describe("the public route", () => {
  it("answers the server's constant", () => {
    const answer = ReefClubAuthController.prototype.privacyConsent.call(null);
    assert.deepEqual(answer, { version: REEFCLUB_PRIVACY_NOTICE_VERSION });
  });

  it("the version names itself a draft, until the real notice replaces it", () => {
    assert.match(REEFCLUB_PRIVACY_NOTICE_VERSION, /tervezet/);
  });
});
