import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unlockOutcomeFromResult } from "./biometric-outcome";

describe("unlockOutcomeFromResult", () => {
  it("a confirmed owner unlocks", () => {
    assert.equal(unlockOutcomeFromResult({ success: true }), "unlocked");
  });

  describe("an attempt that ran and failed is worth offering again", () => {
    for (const error of [
      "user_cancel",
      "authentication_failed",
      "timeout",
      "lockout",
      "system_cancel",
      "app_cancel",
      "user_fallback",
      "unable_to_process",
      "unknown",
    ]) {
      it(`${error} is a rejection, not an absence`, () => {
        assert.equal(
          unlockOutcomeFromResult({ success: false, error }),
          "rejected",
        );
      });
    }
  });

  describe("a device with nothing to offer must not be asked again", () => {
    for (const error of [
      "not_available",
      "not_enrolled",
      "passcode_not_set",
      "no_space",
      "invalid_context",
    ]) {
      it(`${error} means there is nothing to try`, () => {
        assert.equal(
          unlockOutcomeFromResult({ success: false, error }),
          "unavailable",
        );
      });
    }
  });

  it("an error nobody has seen before is treated as a rejection", () => {
    // Erring towards "rejected" only ever offers a retry that may not
    // help. Erring the other way would hide the retry from someone whose
    // face simply did not match.
    assert.equal(
      unlockOutcomeFromResult({ success: false, error: "brand_new_error" }),
      "rejected",
    );
  });
});
