import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decidePriceRetry,
  PRICE_RETRY_AFTER_MS,
  priceRetryProducts,
  recordPriceAttempt,
} from "./medusa-price-sync.js";

/**
 * AZ ELBUKOTT ÁR ÚJRAPRÓBÁLÁSA (329f8a2e). MI PIROSIT: egy friss kudarc vagy
 * egy siker utáni régi kudarc újrapróbál (minden körben ugyanaz a hiba); egy
 * régi kudarc nem próbál újra (a bolt a régi árat tartja); egy soha nem árazott
 * termék esedékes lesz (az a kezdő ár-kör, külön döntés); a rögzítés kudarcnál
 * elmozdítja a `lastSyncedAt`-et, vagy sikernél nem törli a kudarc-jelet.
 */
const MOST = new Date("2026-10-07T16:00:00.000Z");
const ora = (n: number) => new Date(MOST.getTime() - n * 60 * 60 * 1000);

describe("decidePriceRetry", () => {
  it("egy óránál régebbi kudarc újrapróbál, egy friss nem", () => {
    assert.equal(PRICE_RETRY_AFTER_MS, 60 * 60 * 1000);
    assert.equal(
      decidePriceRetry({ syncedAt: ora(5), failedAt: ora(2), now: MOST }),
      true,
    );
    assert.equal(
      decidePriceRetry({ syncedAt: null, failedAt: ora(1), now: MOST }),
      true,
    );
    assert.equal(
      decidePriceRetry({ syncedAt: null, failedAt: ora(0.5), now: MOST }),
      false,
    );
  });

  it("a kudarc utáni siker és a soha nem próbált termék nem próbál újra", () => {
    assert.equal(
      decidePriceRetry({ syncedAt: ora(1), failedAt: ora(3), now: MOST }),
      false,
    );
    assert.equal(
      decidePriceRetry({ syncedAt: null, failedAt: null, now: MOST }),
      false,
    );
    assert.equal(
      decidePriceRetry({ syncedAt: ora(2), failedAt: null, now: MOST }),
      false,
    );
  });
});

describe("priceRetryProducts és recordPriceAttempt", () => {
  it("a ProductPrice sorokból csak a lejárt kudarcot adja, a limitig", async () => {
    const kerdes: unknown[] = [];
    const db = {
      externalReference: {
        findMany: async (args: unknown) => {
          kerdes.push(args);
          return [
            {
              entityId: "regi",
              lastSyncedAt: null,
              metadata: { failedAt: ora(2).toISOString() },
            },
            {
              entityId: "friss",
              lastSyncedAt: null,
              metadata: { failedAt: ora(0.2).toISOString() },
            },
            { entityId: "rendben", lastSyncedAt: ora(1), metadata: {} },
            {
              entityId: "regi-2",
              lastSyncedAt: ora(9),
              metadata: { failedAt: ora(3).toISOString() },
            },
          ];
        },
        upsert: async () => ({}),
      },
    };
    assert.deepEqual(await priceRetryProducts(db, MOST, 10), [
      "regi",
      "regi-2",
    ]);
    assert.deepEqual(await priceRetryProducts(db, MOST, 1), ["regi"]);
    assert.deepEqual(kerdes[0], {
      where: { system: "MEDUSA", entityType: "ProductPrice" },
      select: { entityId: true, lastSyncedAt: true, metadata: true },
    });
  });

  it("kudarcnál a lastSyncedAt nem mozdul, sikernél a kudarc-jel törlődik", async () => {
    const irasok: Record<string, unknown>[] = [];
    const db = {
      externalReference: {
        findMany: async () => [],
        upsert: async (args: unknown) => {
          irasok.push(args as Record<string, unknown>);
          return {};
        },
      },
    };
    await recordPriceAttempt(db, {
      productId: "p",
      medusaProductId: "prod_m",
      startedAt: MOST,
      failure: "tax-inclusive-not-set",
    });
    await recordPriceAttempt(db, {
      productId: "p",
      medusaProductId: "prod_m",
      startedAt: MOST,
      failure: null,
    });
    const [kudarc, siker] = irasok as {
      where: unknown;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }[];
    assert.deepEqual(kudarc!.where, {
      system_entityType_entityId: {
        system: "MEDUSA",
        entityType: "ProductPrice",
        entityId: "p",
      },
    });
    assert.equal("lastSyncedAt" in kudarc!.update, false);
    assert.deepEqual(kudarc!.update.metadata, {
      failedAt: MOST.toISOString(),
      reason: "tax-inclusive-not-set",
    });
    assert.equal(kudarc!.create.lastSyncedAt, null);
    assert.equal(siker!.update.lastSyncedAt, MOST);
    assert.deepEqual(siker!.update.metadata, {});
  });
});
