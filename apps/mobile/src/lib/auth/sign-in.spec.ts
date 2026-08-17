import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { signIn } from "./sign-in";
import type { AuthenticatedUser, LoginResult, StoredSession } from "./types";

const testUser: AuthenticatedUser = {
  id: "user-1",
  email: "owner@acropora.hu",
  displayName: "Teszt Owner",
  role: "OWNER",
};

const validResult: LoginResult = {
  token: "issued-token-value",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: testUser,
};

class FakeUnauthorizedError extends Error {
  status = 401;
  constructor() {
    // A message that would be a serious leak if it ever reached the UI.
    super("password mismatch for owner@acropora.hu");
  }
}

describe("signIn", () => {
  it("a successful login stores the token and the user", async () => {
    let savedSession: StoredSession | undefined;
    const outcome = await signIn(
      {
        loginWithPassword: async () => validResult,
        saveSession: async (session) => {
          savedSession = session;
        },
        invalidateToken: async () => {
          throw new Error("must not be called on the success path");
        },
      },
      testUser.email,
      "correct horse battery staple",
    );

    assert.deepEqual(outcome, {
      type: "success",
      user: testUser,
      expiresAt: validResult.expiresAt,
    });
    assert.deepEqual(savedSession, {
      token: validResult.token,
      expiresAt: validResult.expiresAt,
    });
  });

  it("a failed login (invalid credentials) never calls saveSession", async () => {
    let saveSessionCalled = false;
    const outcome = await signIn(
      {
        loginWithPassword: async () => {
          throw new FakeUnauthorizedError();
        },
        saveSession: async () => {
          saveSessionCalled = true;
        },
        invalidateToken: async () => undefined,
      },
      testUser.email,
      "wrong password",
    );

    assert.equal(outcome.type, "invalid-credentials");
    assert.equal(saveSessionCalled, false);
  });

  it("the invalid-credentials message never reveals whether the e-mail or the password was wrong, nor echoes the raw server error", async () => {
    const outcome = await signIn(
      {
        loginWithPassword: async () => {
          throw new FakeUnauthorizedError();
        },
        saveSession: async () => undefined,
        invalidateToken: async () => undefined,
      },
      testUser.email,
      "wrong password",
    );

    assert.equal(outcome.type, "invalid-credentials");
    if (outcome.type === "invalid-credentials") {
      assert.equal(outcome.message.includes("password mismatch"), false);
      assert.equal(outcome.message.toLowerCase().includes("email"), false);
      assert.equal(outcome.message, "Hibás e-mail cím vagy jelszó.");
    }
  });

  it("a network failure during login is reported distinctly from invalid credentials", async () => {
    const outcome = await signIn(
      {
        loginWithPassword: async () => {
          throw new Error("fetch failed"); // no .status — mirrors a raw network error
        },
        saveSession: async () => undefined,
        invalidateToken: async () => undefined,
      },
      testUser.email,
      "correct horse battery staple",
    );

    assert.equal(outcome.type, "network-error");
    assert.notEqual(outcome.type, "invalid-credentials");
  });

  it("does not send a stale token: the deps only expose loginWithPassword, saveSession and invalidateToken — no ambient auth state", async () => {
    // Structural guarantee: signIn never reads or forwards any prior
    // token; loginWithPassword is called with only email/password.
    let receivedArgs: unknown[] = [];
    await signIn(
      {
        loginWithPassword: async (email, password) => {
          receivedArgs = [email, password];
          return validResult;
        },
        saveSession: async () => undefined,
        invalidateToken: async () => undefined,
      },
      testUser.email,
      "correct horse battery staple",
    );
    assert.deepEqual(receivedArgs, [
      testUser.email,
      "correct horse battery staple",
    ]);
  });

  it("if saving the token locally fails, the server session is invalidated and no half-authenticated state is returned", async () => {
    let invalidatedToken: string | undefined;
    const outcome = await signIn(
      {
        loginWithPassword: async () => validResult,
        saveSession: async () => {
          throw new Error("SecureStore write failed");
        },
        invalidateToken: async (token) => {
          invalidatedToken = token;
        },
      },
      testUser.email,
      "correct horse battery staple",
    );

    assert.equal(outcome.type, "error");
    assert.equal(invalidatedToken, validResult.token);
  });

  it("a malformed server response is rejected before any storage write", async () => {
    let saveSessionCalled = false;
    const outcome = await signIn(
      {
        loginWithPassword: async () =>
          ({
            token: "",
            expiresAt: "",
            user: undefined,
          }) as unknown as LoginResult,
        saveSession: async () => {
          saveSessionCalled = true;
        },
        invalidateToken: async () => undefined,
      },
      testUser.email,
      "correct horse battery staple",
    );

    assert.equal(outcome.type, "error");
    assert.equal(saveSessionCalled, false);
  });
});
