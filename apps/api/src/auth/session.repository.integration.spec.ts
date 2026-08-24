import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { SessionRepository } from "./session.repository.js";
import { hashSessionToken } from "./session-token.util.js";
import { integrationDatabaseGate } from "../common/integration-database.js";

// Exercises SessionRepository against a real database, matching the
// established RUN_DB_INTEGRATION convention used elsewhere (e.g.
// auth-user-resolver.integration.spec.ts) — this is exactly the piece that
// replaced the old in-memory `Map<string, Session>`, so it is the one that
// most needs proving against a real Postgres instance rather than a mock.
// This suite writes and deletes rows, so it runs only against a database named
// for testing; see integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);
const runIntegration = gate.mode !== "skip";

describe("SessionRepository integration", { skip: !runIntegration }, () => {
  const suffix = Date.now();
  const email = `session-repo-${suffix}@example.invalid`;
  let userId: string;

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: "Session Repo Integration User",
        role: "ADMIN",
        isActive: true,
      },
    });
    userId = user.id;
  });

  after(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("stores only the SHA-256 hash of the token, never the raw token", async () => {
    const repository = new SessionRepository();
    const token = "raw-test-token-should-never-be-persisted";
    const created = await repository.create(userId, token, 60_000);

    const row = await prisma.session.findUniqueOrThrow({
      where: { id: created.id },
    });
    assert.equal(row.tokenHash, hashSessionToken(token));
    assert.notEqual(row.tokenHash, token);
  });

  it("resolves a session created by one instance from a brand-new instance — not in-memory", async () => {
    const writer = new SessionRepository();
    const token = `cross-instance-${suffix}`;
    await writer.create(userId, token, 60_000);

    // A brand-new instance, sharing nothing but the database connection,
    // must still resolve it — this is exactly the guarantee the old
    // in-memory Map could not provide across API restarts or replicas.
    const reader = new SessionRepository();
    const found = await reader.findActive(token);
    assert.ok(found);
    assert.equal(found?.userId, userId);
  });

  it("treats an expired session as not found and deletes the row", async () => {
    const repository = new SessionRepository();
    const token = `expired-${suffix}`;
    const created = await repository.create(userId, token, -1000); // already expired

    const found = await repository.findActive(token);
    assert.equal(found, null);

    const row = await prisma.session.findUnique({ where: { id: created.id } });
    assert.equal(row, null);
  });

  it("deleteByToken invalidates the session", async () => {
    const repository = new SessionRepository();
    const token = `logout-${suffix}`;
    await repository.create(userId, token, 60_000);

    await repository.deleteByToken(token);

    const found = await repository.findActive(token);
    assert.equal(found, null);
  });

  it("deleteByToken on an unknown token is a no-op, not an error", async () => {
    const repository = new SessionRepository();
    await assert.doesNotReject(() =>
      repository.deleteByToken("never-issued-token"),
    );
  });
});
