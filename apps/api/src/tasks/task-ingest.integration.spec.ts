import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { hashSessionToken } from "../auth/session-token.util.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceTokenGuard } from "./service-token.guard.js";
import { ServiceTokenRepository } from "./service-token.repository.js";
import { TaskIngestRepository } from "./task-ingest.repository.js";
import { TaskIngestService } from "./task-ingest.service.js";

// The two properties that carry the security argument of this feature are
// both database-level: only the SHA-256 hash of a service token is ever
// stored, and the [source, sourceRef] unique index is what makes a replay
// idempotent. Neither can be proven with a mocked repository.
//
// This suite writes and deletes rows, so it runs only against a database
// named for testing; see integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);

// Every row this suite creates carries this domain or slug prefix, so a run
// that was killed before its cleanup does not poison the next one.
const TEST_EMAIL_DOMAIN = "ingest-integration.invalid";
const TEST_SLUG_PREFIX = "ingest-integration-";

describe("Task ingest integration", { skip: gate.mode === "skip" }, () => {
  const suffix = Date.now();
  const tokens = new ServiceTokenRepository();
  const repository = new TaskIngestRepository();
  const service = new TaskIngestService(repository, tokens);
  const email = `ingest-assignee-${suffix}@${TEST_EMAIL_DOMAIN}`;
  const slug = `${TEST_SLUG_PREFIX}polip-${suffix}`;
  const otherSlug = `${TEST_SLUG_PREFIX}korall-${suffix}`;
  let assigneeId: string;
  let rawToken: string;
  let otherRawToken: string;

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    const user = await prisma.user.create({
      data: {
        email,
        displayName: "Ingest Integration Assignee",
        role: "OWNER",
        isActive: true,
      },
    });
    assigneeId = user.id;
    rawToken = `svc_raw_${suffix}`;
    otherRawToken = `svc_other_${suffix}`;
    await tokens.create({
      name: "Ingest Integration Token",
      slug,
      rawToken,
      dailyLimit: 3,
    });
    await tokens.create({
      name: "Ingest Integration Other Token",
      slug: otherSlug,
      rawToken: otherRawToken,
      dailyLimit: 3,
    });
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await removeLeftovers();
  });

  /**
   * Deletes only rows this suite could have written, matched by the test
   * e-mail domain and slug prefix. Audit rows are removed by the id of the
   * tasks they belong to, never by `action` alone - "every task.ingested row
   * in the database" is not this suite's to delete. Runs before as well as
   * after, so an aborted run cleans up on the next attempt.
   */
  async function removeLeftovers() {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    if (ids.length) {
      const tasks = await prisma.task.findMany({
        where: { assigneeId: { in: ids } },
        select: { id: true },
      });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: tasks.map((task) => task.id) } },
      });
      await prisma.task.deleteMany({ where: { assigneeId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.serviceToken.deleteMany({
      where: { slug: { startsWith: TEST_SLUG_PREFIX } },
    });
  }

  const payload = (reference: string) => ({
    title: "Nyers termékexport",
    description: "Enélkül nem lehet importra kész fájlt adni.",
    assigneeEmail: email,
    reference,
  });

  it("stores only the hash of the token, never the raw value", async () => {
    const row = await prisma.serviceToken.findUniqueOrThrow({
      where: { slug },
    });
    assert.equal(row.tokenHash, hashSessionToken(rawToken));
    assert.notEqual(row.tokenHash, rawToken);
  });

  it("resolves a live token and refuses a revoked one", async () => {
    assert.notEqual(await tokens.findActive(rawToken), null);
    assert.equal(await tokens.findActive("svc_never-issued"), null);

    const throwaway = `svc_throwaway_${suffix}`;
    const throwawaySlug = `${TEST_SLUG_PREFIX}throwaway-${suffix}`;
    await tokens.create({
      name: "Throwaway",
      slug: throwawaySlug,
      rawToken: throwaway,
      dailyLimit: 1,
    });
    assert.notEqual(await tokens.findActive(throwaway), null);
    await tokens.revoke(throwawaySlug);
    assert.equal(await tokens.findActive(throwaway), null);
    await prisma.serviceToken.delete({ where: { slug: throwawaySlug } });
  });

  it("files a task and writes an audit row with no acting user", async () => {
    const token = await tokens.findActive(rawToken);
    assert.ok(token);
    const result = await service.ingest(payload("first"), token);
    assert.equal(result.created, true);

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: result.id },
    });
    assert.equal(task.source, "AGENT");
    assert.equal(task.sourceRef, `${slug}:first`);
    assert.equal(task.createdById, null);
    assert.equal(task.assigneeId, assigneeId);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: result.id, action: "task.ingested" },
    });
    assert.equal(audit.userId, null);
    assert.deepEqual(audit.metadata, {
      serviceToken: slug,
      sourceRef: `${slug}:first`,
    });
  });

  it("is idempotent: the same reference twice yields one task", async () => {
    const token = await tokens.findActive(rawToken);
    assert.ok(token);
    const first = await service.ingest(payload("repeat"), token);
    const second = await service.ingest(payload("repeat"), token);

    assert.equal(first.id, second.id);
    assert.equal(second.created, false);
    assert.equal(
      await prisma.task.count({ where: { sourceRef: `${slug}:repeat` } }),
      1,
    );
  });

  it("keeps two callers' identical references apart", async () => {
    const token = await tokens.findActive(rawToken);
    const other = await tokens.findActive(otherRawToken);
    assert.ok(token);
    assert.ok(other);

    const mine = await service.ingest(payload("shared-name"), token);
    const theirs = await service.ingest(payload("shared-name"), other);

    assert.notEqual(mine.id, theirs.id);
    const theirTask = await prisma.task.findUniqueOrThrow({
      where: { id: theirs.id },
    });
    assert.equal(theirTask.sourceRef, `${otherSlug}:shared-name`);
  });

  it("counts the daily allowance per token and stops at the limit", async () => {
    const token = await tokens.findActive(otherRawToken);
    assert.ok(token);
    // The token has dailyLimit 3 and already filed one above.
    await service.ingest(payload("cap-2"), token);
    await service.ingest(payload("cap-3"), token);

    await assert.rejects(
      () => service.ingest(payload("cap-4"), token),
      (error: unknown) =>
        error instanceof Error && error.message.includes("napi felviteli"),
    );
  });

  it("records the token's last use", async () => {
    const row = await prisma.serviceToken.findUniqueOrThrow({
      where: { slug },
    });
    assert.notEqual(row.lastUsedAt, null);
  });

  it("accepts the raw token through the guard exactly as issued", async () => {
    const guard = new ServiceTokenGuard(tokens);
    const request = { headers: { authorization: `Bearer ${rawToken}` } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as Parameters<ServiceTokenGuard["canActivate"]>[0];

    assert.equal(await guard.canActivate(context), true);
    assert.equal(
      (request as { serviceToken?: { slug: string } }).serviceToken?.slug,
      slug,
    );
  });
});
