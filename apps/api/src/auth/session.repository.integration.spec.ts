import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import {
  SessionRepository,
  SLIDING_EXTEND_DEBOUNCE_MS,
} from "./session.repository.js";
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

  /**
   * NO SEPARATE LEFTOVER COUNT HERE, AND THAT IS A DECISION, NOT AN OVERSIGHT.
   *
   * This suite creates exactly ONE row of its own (a `User`; the `Session`
   * rows are written by the repository under test), and the cleanup removes it
   * with `delete` BY ID, not `deleteMany`. The two are not the same: a
   * `deleteMany` succeeds on zero rows and says nothing, while `delete` THROWS
   * when the row is not there (P2025). The cleanup IS the assertion, and its
   * failure is red now rather than a silent hook.
   *
   * `Session.userId` is `Cascade`, so deleting the user takes the sessions with
   * it - the `deleteMany` above is a shortcut, not a guard. A separate counter
   * would state the same single fact twice, and if the two forms ever drifted,
   * the second one would be the one keeping quiet about it.
   */
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
    const found = await reader.findActive(token, 60_000);
    assert.ok(found);
    assert.equal(found?.session.userId, userId);
  });

  it("treats an expired session as not found and deletes the row", async () => {
    const repository = new SessionRepository();
    const token = `expired-${suffix}`;
    const created = await repository.create(userId, token, -1000); // already expired

    // A ttlMs itt nem szamit: a lejarat-ellenorzes MEGELOZI a csuszo
    // hosszabbitas logikajat, tehat egy mar lejart sor a ttlMs erteketol
    // fuggetlenul torlodik.
    const found = await repository.findActive(token, 60_000);
    assert.equal(found, null);

    const row = await prisma.session.findUnique({ where: { id: created.id } });
    assert.equal(row, null);
  });

  it("deleteByToken invalidates the session", async () => {
    const repository = new SessionRepository();
    const token = `logout-${suffix}`;
    await repository.create(userId, token, 60_000);

    await repository.deleteByToken(token);

    const found = await repository.findActive(token, 60_000);
    assert.equal(found, null);
  });

  /**
   * A CSUSZO LEJARAT KET IRANYA -- Balazs kerese (2026-09-24 08:15, mobil
   * szal). A "mikor hosszabbitottunk utoljara" erteket a sor SAJAT,
   * MEGLEVO `expiresAt` mezojebol es a hivo altal adott `ttlMs`-bol
   * szamoljuk vissza (`expiresAt - ttlMs`), ezert ezt a ket allitast a
   * VALODI adatbazis ellen kell futtatni: csak ott derul ki, hogy a
   * `prisma.session.update` tenyleg megtortent-e (vagy tenyleg NEM
   * tortent-e meg), nem csak a visszaadott ertek alapjan.
   */
  it("slides the expiry forward when the implied last extension is older than the debounce window", async () => {
    const repository = new SessionRepository();
    const token = `slide-due-${suffix}`;
    const ttlMs = 60 * 60 * 1000; // 1 ora, tetszoleges de realisztikus
    const created = await repository.create(userId, token, ttlMs);
    // A sort ugy allitjuk be, mintha az utolso hosszabbitasa
    // (debounce + 1s)-al ezelott tortent volna -- ez mar TUL van a
    // debounce-on, tehat hosszabbitania kell.
    const staleExpiresAt = new Date(
      Date.now() - (SLIDING_EXTEND_DEBOUNCE_MS + 1000) + ttlMs,
    );
    await prisma.session.update({
      where: { id: created.id },
      data: { expiresAt: staleExpiresAt },
    });

    const before = Date.now();
    const found = await repository.findActive(token, ttlMs);
    assert.ok(found);
    assert.equal(found.extended, true);
    const expiresInMs = found.session.expiresAt.getTime() - before;
    assert.ok(
      Math.abs(expiresInMs - ttlMs) < 5_000,
      `vart kb. ${ttlMs}ms, kaptam ${expiresInMs}ms`,
    );

    // A VALODI soron is meg kell jelennie -- ez a bizonyitek, hogy irtunk,
    // nem csak a fuggveny visszateresi erteket ellenoriztuk.
    const row = await prisma.session.findUniqueOrThrow({
      where: { id: created.id },
    });
    assert.ok(
      Math.abs(row.expiresAt.getTime() - (before + ttlMs)) < 5_000,
      `a sor lejarata nem frissult a vart kornyeken: ${row.expiresAt.toISOString()}`,
    );
  });

  it("does NOT slide (or write) within the debounce window", async () => {
    const repository = new SessionRepository();
    const token = `slide-fresh-${suffix}`;
    const ttlMs = 60 * 60 * 1000;
    // Friss letrehozas -- az "utolso hosszabbitas" a debounce-on BELUL van.
    const created = await repository.create(userId, token, ttlMs);

    const found = await repository.findActive(token, ttlMs);
    assert.ok(found);
    assert.equal(found.extended, false);
    assert.equal(
      found.session.expiresAt.getTime(),
      created.expiresAt.getTime(),
      "a lejaratnak VALTOZATLANNAK kell maradnia a debounce-on belul",
    );
  });

  it("deleteByToken on an unknown token is a no-op, not an error", async () => {
    const repository = new SessionRepository();
    await assert.doesNotReject(() =>
      repository.deleteByToken("never-issued-token"),
    );
  });
});
