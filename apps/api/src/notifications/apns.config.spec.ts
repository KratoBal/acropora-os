import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readApnsConfig } from "./apns.config.js";

const complete = {
  APNS_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
  APNS_KEY_ID: "KEY123",
  APNS_TEAM_ID: "TEAM123",
  APNS_ENVIRONMENT: "production",
};

describe("APNs configuration", () => {
  it("reads a complete set and points at the production host", () => {
    const result = readApnsConfig(complete);

    assert.equal(result.configured, true);
    if (!result.configured) return;
    assert.equal(result.config.host, "api.push.apple.com");
    assert.equal(result.config.keyId, "KEY123");
  });

  it("points at the sandbox host when asked to", () => {
    const result = readApnsConfig({
      ...complete,
      APNS_ENVIRONMENT: "sandbox",
    });

    assert.equal(result.configured, true);
    if (!result.configured) return;
    assert.equal(result.config.host, "api.sandbox.push.apple.com");
  });

  /**
   * A missing key is a development machine, not a fault: the sender says it is
   * off and the assignment carries on. What must never happen is a
   * half-configured sender that looks ready and fails on every send, so the
   * answer names every missing piece at once.
   */
  it("reports what is missing rather than half-starting", () => {
    const result = readApnsConfig({ APNS_KEY_ID: "KEY123" });

    assert.equal(result.configured, false);
    if (result.configured) return;
    assert.deepEqual(result.missing, [
      "APNS_KEY",
      "APNS_TEAM_ID",
      "APNS_ENVIRONMENT",
    ]);
  });

  /**
   * Choosing a default here would be the expensive kind of helpful: a typo in
   * a staging deployment would start sending real notifications to real
   * phones, and nothing would say why.
   */
  it("refuses an environment it does not recognise instead of guessing", () => {
    const result = readApnsConfig({ ...complete, APNS_ENVIRONMENT: "prod" });

    assert.equal(result.configured, false);
    if (result.configured) return;
    assert.deepEqual(result.missing, ["APNS_ENVIRONMENT"]);
  });

  /**
   * A PEM has line breaks, and both Docker and Coolify make those easy to lose
   * on the way in. A key pasted with literal backslash-n is put back together
   * here rather than failing later with an unreadable crypto error.
   */
  it("puts a key's line breaks back when they arrive escaped", () => {
    const result = readApnsConfig({
      ...complete,
      APNS_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    });

    assert.equal(result.configured, true);
    if (!result.configured) return;
    assert.equal(result.config.signingKey.includes("\\n"), false);
    assert.equal(result.config.signingKey.split("\n").length, 3);
  });
});
