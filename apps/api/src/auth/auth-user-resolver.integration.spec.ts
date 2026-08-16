import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { AuthUserResolver } from "./auth-user-resolver.js";
import { hashPassword } from "../users/password.util.js";

// Exercises AuthUserResolver.resolveByEmailAndPassword against a real
// database, matching the established RUN_DB_INTEGRATION convention used
// elsewhere (e.g. unas-connection.repository.integration.spec.ts) rather
// than mocking `@acropora/database`'s module-level `prisma` singleton,
// which this resolver imports directly (not via constructor injection).
const runIntegration = process.env.RUN_DB_INTEGRATION === "1";

describe(
  "AuthUserResolver.resolveByEmailAndPassword integration",
  { skip: !runIntegration },
  () => {
    const resolver = new AuthUserResolver();
    const suffix = Date.now();
    const activeEmail = `auth-resolver-active-${suffix}@example.invalid`;
    const inactiveEmail = `auth-resolver-inactive-${suffix}@example.invalid`;
    const noPasswordEmail = `auth-resolver-nopassword-${suffix}@example.invalid`;
    const password = "correct horse battery staple";
    const createdIds: string[] = [];

    before(async () => {
      const [active, inactive, noPassword] = await Promise.all([
        prisma.user.create({
          data: {
            email: activeEmail,
            displayName: "Integration Active User",
            role: "ADMIN",
            isActive: true,
            passwordHash: await hashPassword(password),
            passwordUpdatedAt: new Date(),
          },
        }),
        prisma.user.create({
          data: {
            email: inactiveEmail,
            displayName: "Integration Inactive User",
            role: "ADMIN",
            isActive: false,
            passwordHash: await hashPassword(password),
            passwordUpdatedAt: new Date(),
          },
        }),
        prisma.user.create({
          data: {
            email: noPasswordEmail,
            displayName: "Integration No-Password User",
            role: "ADMIN",
            isActive: true,
          },
        }),
      ]);
      createdIds.push(active.id, inactive.id, noPassword.id);
    });

    after(async () => {
      await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    });

    it("resolves an active user with the correct password", async () => {
      const user = await resolver.resolveByEmailAndPassword(
        activeEmail,
        password,
      );
      assert.equal(user.email, activeEmail);
      assert.equal(user.displayName, "Integration Active User");
    });

    it("is case-insensitive on the e-mail address", async () => {
      const user = await resolver.resolveByEmailAndPassword(
        activeEmail.toUpperCase(),
        password,
      );
      assert.equal(user.email, activeEmail);
    });

    it("rejects the wrong password", async () => {
      await assert.rejects(
        resolver.resolveByEmailAndPassword(activeEmail, "wrong password"),
        UnauthorizedException,
      );
    });

    it("rejects an unknown e-mail address", async () => {
      await assert.rejects(
        resolver.resolveByEmailAndPassword(
          `nobody-${suffix}@example.invalid`,
          password,
        ),
        UnauthorizedException,
      );
    });

    it("rejects a user that has never had a password set", async () => {
      await assert.rejects(
        resolver.resolveByEmailAndPassword(noPasswordEmail, password),
        UnauthorizedException,
      );
    });

    it("rejects an inactive user even with the correct password", async () => {
      await assert.rejects(
        resolver.resolveByEmailAndPassword(inactiveEmail, password),
        UnauthorizedException,
      );
    });
  },
);
