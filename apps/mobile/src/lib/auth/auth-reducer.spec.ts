import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { authReducer, initialAuthState } from "./auth-reducer";
import type { AuthenticatedUser } from "./types";

const testUser: AuthenticatedUser = {
  id: "user-1",
  email: "owner@acropora.hu",
  displayName: "Teszt Owner",
  role: "OWNER",
};

describe("authReducer", () => {
  it("starts in the restoring status with no user", () => {
    assert.equal(initialAuthState.status, "restoring");
    assert.equal(initialAuthState.user, null);
  });

  it("RESTORE_AUTHENTICATED moves to authenticated with the resolved user", () => {
    const state = authReducer(initialAuthState, {
      type: "RESTORE_AUTHENTICATED",
      user: testUser,
      expiresAt: "2026-08-10T00:00:00.000Z",
    });
    assert.equal(state.status, "authenticated");
    assert.deepEqual(state.user, testUser);
    assert.equal(state.expiresAt, "2026-08-10T00:00:00.000Z");
  });

  it("RESTORE_UNAUTHENTICATED clears any prior user and lands on unauthenticated", () => {
    const authenticated = authReducer(initialAuthState, {
      type: "RESTORE_AUTHENTICATED",
      user: testUser,
      expiresAt: "2026-08-10T00:00:00.000Z",
    });
    const state = authReducer(authenticated, {
      type: "RESTORE_UNAUTHENTICATED",
    });
    assert.equal(state.status, "unauthenticated");
    assert.equal(state.user, null);
  });

  it("RESTORE_NETWORK_ERROR stays in restoring and sets the retryable flag without touching user state", () => {
    const state = authReducer(initialAuthState, {
      type: "RESTORE_NETWORK_ERROR",
    });
    assert.equal(state.status, "restoring");
    assert.equal(state.restoreNetworkError, true);
  });

  it("RESTORE_RETRY resets the network-error flag and re-enters restoring", () => {
    const withError = authReducer(initialAuthState, {
      type: "RESTORE_NETWORK_ERROR",
    });
    const state = authReducer(withError, { type: "RESTORE_RETRY" });
    assert.equal(state.status, "restoring");
    assert.equal(state.restoreNetworkError, false);
  });

  it("SIGN_IN_START moves to signingIn and clears any previous sign-in error", () => {
    const withPriorError = authReducer(initialAuthState, {
      type: "SIGN_IN_ERROR",
      message: "Hibás e-mail cím vagy jelszó.",
    });
    const state = authReducer(withPriorError, { type: "SIGN_IN_START" });
    assert.equal(state.status, "signingIn");
    assert.equal(state.signInError, null);
  });

  it("SIGN_IN_SUCCESS moves to authenticated with the returned user", () => {
    const state = authReducer(
      { ...initialAuthState, status: "signingIn" },
      {
        type: "SIGN_IN_SUCCESS",
        user: testUser,
        expiresAt: "2026-08-10T00:00:00.000Z",
      },
    );
    assert.equal(state.status, "authenticated");
    assert.deepEqual(state.user, testUser);
  });

  it("SIGN_IN_ERROR returns to unauthenticated carrying only the generic message", () => {
    const state = authReducer(
      { ...initialAuthState, status: "signingIn" },
      { type: "SIGN_IN_ERROR", message: "Hibás e-mail cím vagy jelszó." },
    );
    assert.equal(state.status, "unauthenticated");
    assert.equal(state.user, null);
    assert.equal(state.signInError, "Hibás e-mail cím vagy jelszó.");
  });

  it("SIGN_OUT_START moves to signingOut without discarding the current user yet", () => {
    const authenticated = authReducer(initialAuthState, {
      type: "RESTORE_AUTHENTICATED",
      user: testUser,
      expiresAt: "2026-08-10T00:00:00.000Z",
    });
    const state = authReducer(authenticated, { type: "SIGN_OUT_START" });
    assert.equal(state.status, "signingOut");
    assert.deepEqual(state.user, testUser);
  });

  it("SIGN_OUT_DONE lands on a clean unauthenticated state", () => {
    const authenticated = authReducer(initialAuthState, {
      type: "RESTORE_AUTHENTICATED",
      user: testUser,
      expiresAt: "2026-08-10T00:00:00.000Z",
    });
    const signingOut = authReducer(authenticated, { type: "SIGN_OUT_START" });
    const state = authReducer(signingOut, { type: "SIGN_OUT_DONE" });
    assert.deepEqual(state, { ...initialAuthState, status: "unauthenticated" });
  });

  it("RESTORE_LOCKED is its own state, not a logged-out one", () => {
    const state = authReducer(initialAuthState, { type: "RESTORE_LOCKED" });
    assert.equal(state.status, "locked");
    assert.notEqual(state.status, "unauthenticated");
    assert.equal(state.user, null);
    assert.equal(state.signInError, null);
  });

  it("RESTORE_RETRY from locked goes back to restoring, so the prompt runs again", () => {
    const locked = authReducer(initialAuthState, { type: "RESTORE_LOCKED" });
    const state = authReducer(locked, { type: "RESTORE_RETRY" });
    assert.equal(state.status, "restoring");
  });

  it("signing in with the password from a locked state lands authenticated", () => {
    const locked = authReducer(initialAuthState, { type: "RESTORE_LOCKED" });
    const signingIn = authReducer(locked, { type: "SIGN_IN_START" });
    const state = authReducer(signingIn, {
      type: "SIGN_IN_SUCCESS",
      user: testUser,
      expiresAt: "2026-08-10T00:00:00.000Z",
    });
    assert.equal(state.status, "authenticated");
    assert.deepEqual(state.user, testUser);
  });
});
