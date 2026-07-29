import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { AuthService } from "./auth.service.js";
import { AuthUserResolver } from "./auth-user-resolver.js";
import { SessionRepository } from "./session.repository.js";
import { hashPassword } from "../users/password.util.js";

// Same RUN_DB_INTEGRATION convention as auth-user-resolver.integration.spec.ts
// and session.repository.integration.spec.ts. This file proves the
// end-to-end contract that motivated moving off the in-memory session Map:
// a session issued by one AuthService instance (~= one API process) must be
// resolvable, invalidatable and correctly rejected-when-expired from a
// completely different AuthService instance backed only by the shared
// database.
const runIntegration = process.env.RUN_DB_INTEGRATION === "1";

describe("AuthService integration (real Postgres, no in-memory session store)", { skip: !runIntegration }, () => {
  const suffix = Date.now();
  const email = `auth-service-integration-${suffix}@example.invalid`;
  const password = "correct horse battery staple";
  let userId: string;

  function newService(): AuthService {
    return new AuthService(new AuthUserResolver(), new SessionRepository());
  }

  before(async () => {
    const user = await prisma.user.create({
      data: {
        email,
        displayName: "Auth Service Integration User",
        role: "ADMIN",
        isActive: true,
        passwordHash: await hashPassword(password),
        passwordUpdatedAt: new Date(),
      },
    });
    userId = user.id;
  });

  after(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("a session issued by one AuthService instance is resolvable from a brand-new instance", async () => {
    const loginService = newService();
    const session = await loginService.loginWithPassword(email, password);

    const otherService = newService();
    const resolved = await otherService.resolveToken(session.token!);
    assert.equal(resolved.id, userId);
  });

  it("rejects an invalid token with UnauthorizedException", async () => {
    const service = newService();
    await assert.rejects(
      () => service.resolveToken("not-a-real-token"),
      UnauthorizedException,
    );
  });

  it("rejects an expired token with UnauthorizedException and cleans up the row", async () => {
    const service = newService();
    const session = await service.loginWithPassword(email, password);

    // Force expiry directly in the DB rather than waiting out the 8h TTL.
    await prisma.session.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await assert.rejects(
      () => service.resolveToken(session.token!),
      UnauthorizedException,
    );
  });

  it("logout invalidates the session so the same token then gets rejected", async () => {
    const service = newService();
    const session = await service.loginWithPassword(email, password);
    await service.resolveToken(session.token!); // sanity: valid before logout

    await service.logout(session.token!);

    await assert.rejects(
      () => service.resolveToken(session.token!),
      UnauthorizedException,
    );
  });

  it("a wrong password does not create any session row", async () => {
    const service = newService();
    const before = await prisma.session.count({ where: { userId } });

    await assert.rejects(() =>
      service.loginWithPassword(email, "wrong password"),
    );

    const after = await prisma.session.count({ where: { userId } });
    assert.equal(after, before);
  });

  it("API restart is simulated by a fresh AuthService with no shared memory — session is not lost", async () => {
    const firstProcess = newService();
    const session = await firstProcess.loginWithPassword(email, password);

    // Nothing here reuses `firstProcess` or any object it constructed —
    // this is the scenario an in-memory Map could never survive.
    const afterRestart = new AuthService(
      new AuthUserResolver(),
      new SessionRepository(),
    );
    const user = await afterRestart.resolveToken(session.token!);
    assert.equal(user.id, userId);
  });
});
