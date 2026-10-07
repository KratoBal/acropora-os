import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  decideInventoryDue,
  inventoryDueProducts,
  INVENTORY_RETRY_AFTER_MS,
} from "./medusa-inventory-sync.js";
import {
  MedusaInventoryScheduler,
  medusaInventoryScheduleConfig,
} from "./medusa-inventory.scheduler.js";

/**
 * A KÉSZLET ÜTEMEZETT KIKÜLDÉSE (kártya 54d289d3, 9738d2b5).
 *
 * MI PIROSÍT: ha egy készletváltozás nem tesz esedékessé; ha egy sikeres kiküldés
 * után a termék újra esedékes marad; ha a tartós megállás minden körben újrapróbál;
 * ha a kör vége (és nem a kezdete) rögzülne; ha kapcsoló nélkül elindulna.
 */
const T = (iso: string) => new Date(iso);
const NOW = T("2026-10-07T12:00:00Z");

describe("decideInventoryDue", () => {
  it("soha nem ment ki: esedékes", () => {
    assert.equal(
      decideInventoryDue({
        sourceChangedAt: null,
        syncedAt: null,
        failedAt: null,
        now: NOW,
      }),
      true,
    );
  });

  it("a forrás változott az utolsó kiküldés óta: esedékes; nem változott: nem", () => {
    const syncedAt = T("2026-10-07T10:00:00Z");
    assert.equal(
      decideInventoryDue({
        sourceChangedAt: T("2026-10-07T11:00:00Z"),
        syncedAt,
        failedAt: null,
        now: NOW,
      }),
      true,
    );
    assert.equal(
      decideInventoryDue({
        sourceChangedAt: T("2026-10-07T09:00:00Z"),
        syncedAt,
        failedAt: null,
        now: NOW,
      }),
      false,
    );
  });

  it("kudarc után csak forrás-változásra vagy a visszalépési idő után", () => {
    const failedAt = T("2026-10-07T11:00:00Z");
    assert.equal(
      decideInventoryDue({
        sourceChangedAt: T("2026-10-07T10:00:00Z"),
        syncedAt: null,
        failedAt,
        now: NOW,
      }),
      false,
    );
    assert.equal(
      decideInventoryDue({
        sourceChangedAt: T("2026-10-07T11:30:00Z"),
        syncedAt: null,
        failedAt,
        now: NOW,
      }),
      true,
    );
    assert.equal(
      decideInventoryDue({
        sourceChangedAt: null,
        syncedAt: null,
        failedAt,
        now: new Date(failedAt.getTime() + INVENTORY_RETRY_AFTER_MS),
      }),
      true,
    );
  });

  it("egy régi kudarc egy későbbi siker után nem tesz esedékessé", () => {
    assert.equal(
      decideInventoryDue({
        sourceChangedAt: T("2026-10-06T00:00:00Z"),
        syncedAt: T("2026-10-07T10:00:00Z"),
        failedAt: T("2026-10-06T10:00:00Z"),
        now: NOW,
      }),
      false,
    );
  });
});

function fakeDb(input: {
  linked: string[];
  inventoryRefs?: {
    entityId: string;
    lastSyncedAt: Date | null;
    metadata?: unknown;
  }[];
  stock?: { productId: string; updatedAt: Date }[];
}) {
  const upserts: Record<string, unknown>[] = [];
  const db = {
    externalReference: {
      findMany: async (args: { where: { entityType: string } }) =>
        args.where.entityType === "Product"
          ? input.linked.map((id) => ({
              entityId: id,
              externalId: `prod_${id}`,
              lastSyncedAt: null,
              metadata: null,
            }))
          : (input.inventoryRefs ?? []).map((r) => ({
              externalId: `prod_${r.entityId}`,
              metadata: null,
              ...r,
            })),
      upsert: async (args: Record<string, unknown>) => {
        upserts.push(args);
        return {};
      },
    },
    stockItem: {
      findMany: async () =>
        (input.stock ?? []).map((s) => ({
          updatedAt: s.updatedAt,
          variant: { productId: s.productId },
        })),
    },
    productVariant: { findMany: async () => [] },
    productCategory: { findMany: async () => [] },
    warehouse: {
      findFirst: async () => ({ id: "wh-1", name: "Fő raktár" }),
      create: async () => ({ id: "wh-1", name: "Fő raktár" }),
    },
  };
  return { db, upserts };
}

describe("inventoryDueProducts", () => {
  it("csak a vetített termék, és csak ha a készlete változott", async () => {
    const { db } = fakeDb({
      linked: ["p1", "p2", "p3"],
      inventoryRefs: [
        { entityId: "p1", lastSyncedAt: T("2026-10-07T10:00:00Z") },
        { entityId: "p2", lastSyncedAt: T("2026-10-07T10:00:00Z") },
      ],
      stock: [
        { productId: "p1", updatedAt: T("2026-10-07T11:00:00Z") },
        { productId: "p2", updatedAt: T("2026-10-07T09:00:00Z") },
      ],
    });
    const due = await inventoryDueProducts(db as never, "wh-1", 10, NOW);
    assert.deepEqual(due, [
      { productId: "p1", medusaProductId: "prod_p1" },
      { productId: "p3", medusaProductId: "prod_p3" },
    ]);
  });

  it("a köteg korlátja", async () => {
    const { db } = fakeDb({ linked: ["a", "b", "c"] });
    assert.equal(
      (await inventoryDueProducts(db as never, "wh-1", 2, NOW)).length,
      2,
    );
  });
});

describe("MedusaInventoryScheduler", () => {
  const env = { MEDUSA_INVENTORY_SCHEDULE_ENABLED: "true" };

  it("kapcsoló nélkül ki van kapcsolva", () => {
    assert.equal(medusaInventoryScheduleConfig({}).enabled, false);
    assert.equal(
      medusaInventoryScheduleConfig({ MEDUSA_INVENTORY_SCHEDULE_ENABLED: "1" })
        .enabled,
      false,
    );
    assert.equal(medusaInventoryScheduleConfig(env).enabled, true);
  });

  it("nincs esedékes: nem nyit Medusa-kapcsolatot", async () => {
    const { db } = fakeDb({ linked: [] });
    let created = 0;
    const scheduler = new MedusaInventoryScheduler({
      db: db as never,
      environment: env,
      createService: async () => {
        created += 1;
        return { project: async () => ({ action: "no-change" }) as never };
      },
      logger: {
        log: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });
    assert.equal(await scheduler.runOnce(), "SKIPPED");
    assert.equal(created, 0);
  });

  it("az üres kör is kap sort: az első, utána minden tizenkettedik", async () => {
    const { db } = fakeDb({ linked: [] });
    const logs: string[] = [];
    const scheduler = new MedusaInventoryScheduler({
      db: db as never,
      environment: env,
      createService: async () => ({ project: async () => ({}) as never }),
      logger: {
        log: (m: string) => logs.push(m),
        warn: () => undefined,
        error: () => undefined,
      },
    });
    for (let round = 0; round < 13; round++) await scheduler.runOnce();
    assert.deepEqual(logs, [
      "Medusa inventory run: SKIPPED (0 esedékes termék, 1. üres kör egymás után)",
      "Medusa inventory run: SKIPPED (0 esedékes termék, 12. üres kör egymás után)",
    ]);
  });

  it("siker a kör KEZDETÉVEL rögzül, kudarc az okkal", async () => {
    const { db, upserts } = fakeDb({ linked: ["ok", "rossz"] });
    const logs: string[] = [];
    const dbWithVariants = {
      ...db,
      productVariant: {
        findMany: async (args: {
          where: { productId?: string | { in: string[] } };
        }) => {
          const where = args.where.productId;
          if (typeof where === "string")
            return [
              { id: `v-${where}`, sku: `SKU-${where}`, productId: where },
            ];
          return [];
        },
      },
      product: {
        findMany: async (args: { where: { id: { in: string[] } } }) =>
          args.where.id.in.map((id) => ({ id, catalogAuthority: "ACROPORA" })),
      },
      category: { findMany: async () => [] },
      stockItem: {
        findMany: async (args: { where: { variantId?: unknown } }) =>
          args.where.variantId
            ? [
                {
                  variantId: "v-ok",
                  onHand: new Prisma.Decimal(3),
                  reserved: new Prisma.Decimal(0),
                },
              ]
            : [],
      },
    };
    let tick = NOW.getTime();
    const scheduler = new MedusaInventoryScheduler({
      db: dbWithVariants as never,
      environment: env,
      now: () => new Date((tick += 60_000)),
      createService: async () => ({
        project: async (stock: { sku: string }) =>
          (stock.sku === "SKU-ok"
            ? { action: "updated", report: { variantId: "variant_ok" } }
            : {
                action: "stopped",
                reason: "variant-not-found",
                details: "",
              }) as never,
      }),
      logger: {
        log: (m: string) => logs.push(m),
        warn: () => undefined,
        error: () => undefined,
      },
    });
    assert.equal(await scheduler.runOnce(), "FAILED");
    // a sor azt is megmondja, mi változott, és miért állt meg, ami megállt
    assert.match(
      logs.join("\n"),
      /1 kiment, 1 megállt \(2 esedékes termék\); változat: 0 létrehozva, 1 frissítve, 0 változatlan, 1 megállt; első okok: SKU-rossz: variant-not-found/,
    );
    const started = new Date(NOW.getTime() + 60_000);
    const byId = Object.fromEntries(
      upserts.map((u) => [
        (u.where as { system_entityType_entityId: { entityId: string } })
          .system_entityType_entityId.entityId,
        u,
      ]),
    );
    assert.deepEqual(
      (byId.ok!.update as { lastSyncedAt: Date }).lastSyncedAt,
      started,
    );
    assert.match(
      JSON.stringify((byId.rossz!.update as { metadata: unknown }).metadata),
      /variant-not-found/,
    );
    assert.equal(
      "lastSyncedAt" in (byId.rossz!.update as Record<string, unknown>),
      false,
    );
  });
});
