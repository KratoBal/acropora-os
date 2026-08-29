import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";
import { AuthService } from "./auth.service.js";
import { AuthUserResolver } from "./auth-user-resolver.js";
import type { SessionRepository, StoredSession } from "./session.repository.js";
import { hashSessionToken } from "./session-token.util.js";

const internalOwner: AuthenticatedUser = {
  id: "internal-owner-id",
  email: "owner@acropora.local",
  displayName: "Acropora Tulajdonos",
  role: "OWNER",
  customerId: null,
  supplierId: null,
};

/**
 * A fake, in-memory stand-in for the real (Postgres-backed)
 * SessionRepository, used only inside this unit-test double — production
 * AuthService no longer owns any session storage itself, in-memory or
 * otherwise; it always delegates to whatever SessionRepository it is
 * given. Real, DB-backed behaviour (including "resolvable from a brand
 * new instance") is covered by auth.service.integration.spec.ts and
 * session.repository.integration.spec.ts against a real database.
 */
function createFakeSessionRepository(): SessionRepository & {
  readonly size: number;
} {
  const store = new Map<string, StoredSession>();
  let counter = 0;

  return {
    get size() {
      return store.size;
    },
    async create(userId: string, token: string, ttlMs: number) {
      const stored: StoredSession = {
        id: `fake-session-${++counter}`,
        userId,
        expiresAt: new Date(Date.now() + ttlMs),
      };
      store.set(hashSessionToken(token), stored);
      return stored;
    },
    async findActive(token: string) {
      const hashed = hashSessionToken(token);
      const stored = store.get(hashed);
      if (!stored) return null;
      if (stored.expiresAt.getTime() <= Date.now()) {
        store.delete(hashed);
        return null;
      }
      return stored;
    },
    async deleteByToken(token: string) {
      store.delete(hashSessionToken(token));
    },
  } as unknown as SessionRepository & { readonly size: number };
}

describe("AuthService user resolution", () => {
  it("stores the resolved internal User.id in a development session", async () => {
    const resolver = {
      resolveDevelopmentIdentity: async () => internalOwner,
      resolveById: async () => internalOwner,
    } as unknown as AuthUserResolver;
    const session = await new AuthService(
      resolver,
      createFakeSessionRepository(),
    ).loginWithDevelopmentUser(internalOwner.email);
    assert.equal(session.user.id, "internal-owner-id");
    assert.notEqual(session.user.id, "dev-owner");
    assert.equal(session.token?.startsWith("dev_"), true);
  });

  it("returns a controlled auth error when the internal User disappears", async () => {
    const resolver = {
      resolveDevelopmentIdentity: async () => internalOwner,
      resolveById: async () => {
        throw new UnauthorizedException("missing internal user");
      },
    } as unknown as AuthUserResolver;
    const service = new AuthService(resolver, createFakeSessionRepository());
    const session = await service.loginWithDevelopmentUser(internalOwner.email);
    await assert.rejects(
      () => service.resolveToken(session.token!),
      UnauthorizedException,
    );
  });

  it("issues a real session for loginWithPassword, delegating credential checks to the resolver", async () => {
    let receivedArgs: [string, string] | undefined;
    const resolver = {
      resolveByEmailAndPassword: async (email: string, password: string) => {
        receivedArgs = [email, password];
        return internalOwner;
      },
      resolveById: async () => internalOwner,
    } as unknown as AuthUserResolver;
    const service = new AuthService(resolver, createFakeSessionRepository());
    const session = await service.loginWithPassword(
      internalOwner.email,
      "correct horse battery staple",
    );
    assert.deepEqual(receivedArgs, [
      internalOwner.email,
      "correct horse battery staple",
    ]);
    assert.equal(session.user.id, internalOwner.id);
    assert.ok(session.token);
    assert.equal(session.token?.startsWith("dev_"), false);
    // The session this issues must be resolvable the same way a
    // development session is — same underlying SessionRepository, same
    // contract — even though production storage is now the database
    // rather than a shared map.
    assert.deepEqual(await service.resolveToken(session.token!), internalOwner);
  });

  it("propagates a bad-credentials rejection from the resolver without issuing a session", async () => {
    const sessions = createFakeSessionRepository();
    const resolver = {
      resolveByEmailAndPassword: async () => {
        throw new UnauthorizedException("Hibás e-mail cím vagy jelszó.");
      },
    } as unknown as AuthUserResolver;
    const service = new AuthService(resolver, sessions);
    await assert.rejects(
      service.loginWithPassword(internalOwner.email, "wrong"),
      UnauthorizedException,
    );
    // No session was ever written for the failed attempt.
    assert.equal(sessions.size, 0);
  });

  it("keeps development login disabled in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    let resolverCalled = false;
    const resolver = {
      resolveDevelopmentIdentity: async () => {
        resolverCalled = true;
        return internalOwner;
      },
      resolveById: async () => internalOwner,
    } as unknown as AuthUserResolver;
    try {
      await assert.rejects(
        () =>
          new AuthService(
            resolver,
            createFakeSessionRepository(),
          ).loginWithDevelopmentUser(internalOwner.email),
        ForbiddenException,
      );
      assert.equal(resolverCalled, false);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("rejects an unknown or already-invalidated token with UnauthorizedException", async () => {
    const resolver = {} as unknown as AuthUserResolver;
    const service = new AuthService(resolver, createFakeSessionRepository());
    await assert.rejects(
      () => service.resolveToken("never-issued-token"),
      UnauthorizedException,
    );
  });

  it("rejects an expired session and does not resolve it against the user resolver", async () => {
    let resolveByIdCalled = false;
    const resolver = {
      resolveByEmailAndPassword: async () => internalOwner,
      resolveById: async () => {
        resolveByIdCalled = true;
        return internalOwner;
      },
    } as unknown as AuthUserResolver;
    const sessions = createFakeSessionRepository();
    const service = new AuthService(resolver, sessions);
    // TTL is baked into AuthService as a constant (8h); simulate expiry by
    // creating the session directly through the fake repository with a
    // negative TTL, exactly like SessionRepository.findActive would see an
    // already-expired row.
    const stored = await sessions.create(internalOwner.id, "expired-token", -1);
    void stored;
    await assert.rejects(
      () => service.resolveToken("expired-token"),
      UnauthorizedException,
    );
    assert.equal(resolveByIdCalled, false);
  });

  it("logout invalidates the session so a later resolveToken call rejects", async () => {
    const resolver = {
      resolveByEmailAndPassword: async () => internalOwner,
      resolveById: async () => internalOwner,
    } as unknown as AuthUserResolver;
    const service = new AuthService(resolver, createFakeSessionRepository());
    const session = await service.loginWithPassword(
      internalOwner.email,
      "correct horse battery staple",
    );
    await service.resolveToken(session.token!); // sanity check: valid before logout

    await service.logout(session.token!);

    await assert.rejects(
      () => service.resolveToken(session.token!),
      UnauthorizedException,
    );
  });
});
