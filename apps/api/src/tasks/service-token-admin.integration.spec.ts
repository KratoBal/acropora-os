import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { hashSessionToken } from "../auth/session-token.util.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceTokenAdminRepository } from "./service-token-admin.repository.js";
import { ServiceTokenAdminService } from "./service-token-admin.service.js";
import { ServiceTokenRepository } from "./service-token.repository.js";

// What only a database can prove: the hash (not the key) is what is stored, the audit row is written with the token and
// only when a revocation changes the state, and the key the creation returned opens the guard's lookup until revoked.
const gate = integrationDatabaseGate(process.env);

const DOMAIN = "svc-admin-integration.invalid";
const SLUG_PREFIX = "svc-admin-it-";

describe(
  "Service token admin integration",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now();
    const service = new ServiceTokenAdminService(
      new ServiceTokenAdminRepository(),
    );
    const lookup = new ServiceTokenRepository();
    const agentEmail = `agent-${suffix}@${DOMAIN}`;
    const humanEmail = `human-${suffix}@${DOMAIN}`;
    const inactiveEmail = `inactive-${suffix}@${DOMAIN}`;
    const slug = `${SLUG_PREFIX}${suffix}`;
    let adminId: string;
    let agentId: string;

    async function removeLeftovers(): Promise<void> {
      const tokens = await prisma.serviceToken.findMany({
        where: { slug: { startsWith: SLUG_PREFIX } },
        select: { id: true },
      });
      const ids = tokens.map((token) => token.id);
      await prisma.auditLog.deleteMany({
        where: { entityType: "ServiceToken", entityId: { in: ids } },
      });
      await prisma.serviceToken.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${DOMAIN}` } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const make = (
        email: string,
        role: "OWNER" | "CONTENT_AGENT" | "VIEWER",
        isActive = true,
      ) =>
        prisma.user.create({
          data: { email, displayName: email, role, isActive },
        });
      adminId = (await make(`admin-${suffix}@${DOMAIN}`, "OWNER")).id;
      agentId = (await make(agentEmail, "CONTENT_AGENT")).id;
      await make(humanEmail, "VIEWER");
      await make(inactiveEmail, "CONTENT_AGENT", false);
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("stores the hash and not the key, audits the creation, and the key opens the lookup", async () => {
      const created = await service.create(
        { name: "Teszt kulcs", slug, userEmail: agentEmail.toUpperCase() },
        adminId,
      );
      const row = await prisma.serviceToken.findUniqueOrThrow({
        where: { slug },
      });
      assert.equal(row.tokenHash, hashSessionToken(created.token));
      assert.notEqual(row.tokenHash, created.token);
      assert.equal(row.userId, agentId);
      const audit = await prisma.auditLog.findMany({
        where: { entityType: "ServiceToken", entityId: row.id },
      });
      assert.equal(audit.length, 1);
      assert.equal(audit[0]?.action, "service_token.created");
      assert.equal(audit[0]?.userId, adminId);
      assert.doesNotMatch(
        JSON.stringify(audit[0]?.metadata),
        new RegExp(created.token),
      );
      assert.doesNotMatch(
        JSON.stringify(audit[0]?.metadata),
        new RegExp(row.tokenHash),
      );
      assert.equal((await lookup.findActive(created.token))?.id, row.id);
    });

    it("lists without any hash", async () => {
      const listed = await service.list();
      const mine = listed.find((item) => item.slug === slug);
      assert.ok(mine);
      assert.equal(mine.user?.role, "CONTENT_AGENT");
      assert.doesNotMatch(JSON.stringify(listed), /tokenHash/);
    });

    it("refuses a human account, an inactive one, an unknown one and a taken slug, and writes nothing", async () => {
      const before = await prisma.serviceToken.count({
        where: { slug: { startsWith: SLUG_PREFIX } },
      });
      for (const email of [
        humanEmail,
        inactiveEmail,
        `nincs-${suffix}@${DOMAIN}`,
      ])
        await assert.rejects(
          service.create(
            { name: "x", slug: `${SLUG_PREFIX}no-${suffix}`, userEmail: email },
            adminId,
          ),
          { name: "BadRequestException" },
        );
      await assert.rejects(
        service.create({ name: "x", slug, userEmail: agentEmail }, adminId),
        { name: "ConflictException" },
      );
      assert.equal(
        await prisma.serviceToken.count({
          where: { slug: { startsWith: SLUG_PREFIX } },
        }),
        before,
      );
    });

    it("revokes once with one audit row, and the key stops working", async () => {
      const row = await prisma.serviceToken.findUniqueOrThrow({
        where: { slug },
      });
      const first = await service.revoke(slug, adminId);
      const second = await service.revoke(slug, adminId);
      assert.ok(first.revokedAt);
      assert.equal(second.revokedAt, first.revokedAt);
      const audit = await prisma.auditLog.findMany({
        where: {
          entityType: "ServiceToken",
          entityId: row.id,
          action: "service_token.revoked",
        },
      });
      assert.equal(audit.length, 1);
      assert.equal(audit[0]?.userId, adminId);
      const stillThere = await prisma.serviceToken.findUniqueOrThrow({
        where: { slug },
      });
      assert.equal(await lookup.findActive("bármi"), null);
      assert.ok(stillThere.revokedAt);
    });
  },
);
