import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";
import { AuthService } from "./auth.service.js";
import { AuthUserResolver } from "./auth-user-resolver.js";

const internalOwner: AuthenticatedUser = {
  id: "internal-owner-id",
  email: "owner@acropora.local",
  displayName: "Acropora Tulajdonos",
  role: "OWNER",
};

describe("AuthService user resolution", () => {
  it("stores the resolved internal User.id in a development session", async () => {
    const resolver = {
      resolveDevelopmentIdentity: async () => internalOwner,
      resolveExistingIdentity: async () => internalOwner,
    } as unknown as AuthUserResolver;
    const session = await new AuthService(resolver).loginWithDevelopmentUser(
      internalOwner.email,
    );
    assert.equal(session.user.id, "internal-owner-id");
    assert.notEqual(session.user.id, "dev-owner");
  });
  it("returns a controlled auth error when the internal User disappears", async () => {
    const resolver = {
      resolveDevelopmentIdentity: async () => internalOwner,
      resolveExistingIdentity: async () => {
        throw new UnauthorizedException("missing internal user");
      },
    } as unknown as AuthUserResolver;
    const service = new AuthService(resolver);
    const session = await service.loginWithDevelopmentUser(internalOwner.email);
    await assert.rejects(
      () => service.resolveToken(session.token!),
      UnauthorizedException,
    );
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
      resolveExistingIdentity: async () => internalOwner,
    } as unknown as AuthUserResolver;
    try {
      await assert.rejects(
        () =>
          new AuthService(resolver).loginWithDevelopmentUser(
            internalOwner.email,
          ),
        ForbiddenException,
      );
      assert.equal(resolverCalled, false);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
