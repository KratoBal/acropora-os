import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertValidUnasLoginExpiry,
  UNAS_TOKEN_EXPIRY_TOLERANCE_MS,
  UNAS_TOKEN_MIN_REMAINING_MS,
  UNAS_TOKEN_TTL_MS,
} from "./unas-login-expiry.js";

const NOW_MS = 2_000_000_000_000;
const secondsAfter = (milliseconds: number) => (NOW_MS + milliseconds) / 1000;

describe("UNAS login expiry policy", () => {
  it("accepts the documented window including its boundaries", () => {
    assert.doesNotThrow(() =>
      assertValidUnasLoginExpiry(
        secondsAfter(UNAS_TOKEN_MIN_REMAINING_MS),
        NOW_MS,
      ),
    );
    assert.doesNotThrow(() =>
      assertValidUnasLoginExpiry(
        secondsAfter(UNAS_TOKEN_TTL_MS + UNAS_TOKEN_EXPIRY_TOLERANCE_MS),
        NOW_MS,
      ),
    );
  });

  it("rejects expired, zero, too-short and implausibly distant expiry", () => {
    for (const expireTime of [
      0,
      NOW_MS / 1000,
      secondsAfter(UNAS_TOKEN_MIN_REMAINING_MS - 1000),
      secondsAfter(UNAS_TOKEN_TTL_MS + UNAS_TOKEN_EXPIRY_TOLERANCE_MS + 1000),
    ])
      assert.throws(
        () => assertValidUnasLoginExpiry(expireTime, NOW_MS),
        /RESPONSE_SHAPE_INVALID/,
      );
  });
});
