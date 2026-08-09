import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveRequestToken } from "./request-auth";

describe("resolveRequestToken", () => {
  it("never attaches a stored token when skipAuth is set — the login request itself", () => {
    const token = resolveRequestToken({
      skipAuth: true,
      storedToken: "stale-or-possibly-invalid-old-token",
    });
    assert.equal(token, null);
  });

  it("uses the stored token for a normal authenticated request", () => {
    const token = resolveRequestToken({ storedToken: "current-token" });
    assert.equal(token, "current-token");
  });

  it("returns null when there is no stored token and auth is not skipped", () => {
    const token = resolveRequestToken({ storedToken: null });
    assert.equal(token, null);
  });

  it("prefers an explicit authToken override over both the stored token and skipAuth", () => {
    const token = resolveRequestToken({
      authToken: "explicit-token",
      skipAuth: true,
      storedToken: "stored-token",
    });
    assert.equal(token, "explicit-token");
  });
});
