import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  shouldExtend,
  SLIDING_EXTEND_DEBOUNCE_MS,
} from "./session.repository.js";

/**
 * A CSUSZTATAS DONTESE, DB NELKUL -- Balazs kerese (2026-09-24 08:15,
 * mobil szal): "ne irjunk adatbazist minden kereskor". Ez a fajl a puszta
 * arithmetikat meri (mikor KELLENE hosszabbitani), a VALODI DB-irast a
 * `session.repository.integration.spec.ts` (Postgres ellen). A ketto
 * egyutt zarja le a kerdest: itt a DONTES helyes, ott a VEGREHAJTAS az.
 */
describe("shouldExtend", () => {
  it("does not extend a session created just now (well within the debounce window)", () => {
    const ttlMs = 60 * 60 * 1000; // 1 ora
    const now = Date.now();
    const expiresAt = new Date(now + ttlMs); // fresh: impliedLastExtensionAt == now
    assert.equal(shouldExtend(expiresAt, ttlMs, now), false);
  });

  it("extends a session whose implied last extension is exactly at the debounce boundary", () => {
    const ttlMs = 60 * 60 * 1000;
    const now = Date.now();
    // impliedLastExtensionAt = now - SLIDING_EXTEND_DEBOUNCE_MS pontosan.
    const expiresAt = new Date(now - SLIDING_EXTEND_DEBOUNCE_MS + ttlMs);
    assert.equal(shouldExtend(expiresAt, ttlMs, now), true);
  });

  it("does not extend one millisecond before the debounce boundary", () => {
    const ttlMs = 60 * 60 * 1000;
    const now = Date.now();
    const expiresAt = new Date(now - SLIDING_EXTEND_DEBOUNCE_MS + 1 + ttlMs);
    assert.equal(shouldExtend(expiresAt, ttlMs, now), false);
  });

  it("extends a session that is well past the debounce window (long-idle-but-not-expired case)", () => {
    const ttlMs = 30 * 24 * 60 * 60 * 1000; // 30 nap, a mobil hossz
    const now = Date.now();
    // A session 29 napja jott letre (meg nem jart le), reg tul a debounce-on.
    const expiresAt = new Date(now + ttlMs - 29 * 24 * 60 * 60 * 1000);
    assert.equal(shouldExtend(expiresAt, ttlMs, now), true);
  });

  it("gives the same answer regardless of ttlMs magnitude — only the implied gap matters", () => {
    const now = Date.now();
    for (const ttlMs of [
      60_000,
      8 * 60 * 60 * 1000,
      30 * 24 * 60 * 60 * 1000,
    ]) {
      const freshExpiresAt = new Date(now + ttlMs);
      assert.equal(
        shouldExtend(freshExpiresAt, ttlMs, now),
        false,
        `ttlMs=${ttlMs}: friss sessionnek NEM kellene hosszabbitania`,
      );
      const staleExpiresAt = new Date(
        now - SLIDING_EXTEND_DEBOUNCE_MS - 1000 + ttlMs,
      );
      assert.equal(
        shouldExtend(staleExpiresAt, ttlMs, now),
        true,
        `ttlMs=${ttlMs}: reg hosszabbitott sessionnek KELLENE hosszabbitania`,
      );
    }
  });
});
