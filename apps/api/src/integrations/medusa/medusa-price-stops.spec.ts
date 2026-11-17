import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { MedusaPriceStopsController } from "./medusa-price-stops.controller.js";
import {
  MedusaPriceStopsService,
  PRICE_STOPS_LIMIT,
  type PriceStopsDatabase,
} from "./medusa-price-stops.service.js";
import {
  recordPriceAttempt,
  storedPriceStops,
  type PriceSyncDatabase,
} from "./medusa-price-sync.js";

/*
  THE STORED PRICE STOPS LIST (task t-20261117-arstop-lista; acrobot 55208). WHAT TURNS RED: a row without a stored failure listed, or a stored failure
  missed; the shape `recordPriceAttempt` writes not read back (the list is tested on ITS OWN output, not on a hand-made shape); a person's data state
  not marked as one, or a run failure marked as one; a product that is gone breaking the list; the order (a person first, then the newest);
  the cut at the limit without the flag; any write on the service or the controller; any permission but the status read right.
*/
type Row = { entityId: string; lastSyncedAt: Date | null; metadata: unknown };

/** A fake price reference table that keeps what `recordPriceAttempt` upserts, so the list is read from the writer's own output. */
function tableWrittenBy() {
  const rows = new Map<string, Row>();
  const db: PriceSyncDatabase = {
    externalReference: {
      findMany: async () => [...rows.values()],
      upsert: async (args: unknown) => {
        const a = args as {
          where: { system_entityType_entityId: { entityId: string } };
          create: {
            entityId: string;
            lastSyncedAt: Date | null;
            metadata?: unknown;
          };
          update: { lastSyncedAt?: Date; metadata?: unknown };
        };
        const id = a.where.system_entityType_entityId.entityId;
        const before = rows.get(id);
        rows.set(
          id,
          before
            ? {
                ...before,
                ...(a.update.lastSyncedAt
                  ? { lastSyncedAt: a.update.lastSyncedAt }
                  : {}),
                metadata: a.update.metadata,
              }
            : {
                entityId: id,
                lastSyncedAt: a.create.lastSyncedAt,
                metadata: a.create.metadata,
              },
        );
        return {};
      },
    },
  };
  return { rows, db };
}

const at = (iso: string) => new Date(iso);

describe("storedPriceStops reads what recordPriceAttempt writes", () => {
  it("lists a failed product with its reasons and kinds, and leaves a later success out", async () => {
    const { db } = tableWrittenBy();
    await recordPriceAttempt(db, {
      productId: "p1",
      medusaProductId: "m1",
      startedAt: at("2026-11-17T17:44:00Z"),
      failure:
        "SKU-1: MEGÁLLT (own-price-missing) üres; SKU-2: MEGÁLLT (price-not-whole-forint) 12,5",
    });
    await recordPriceAttempt(db, {
      productId: "p2",
      medusaProductId: "m2",
      startedAt: at("2026-11-17T17:44:00Z"),
      failure: null,
    });
    // p3 failed first, then succeeded: the stored failure is cleared by the writer
    await recordPriceAttempt(db, {
      productId: "p3",
      medusaProductId: "m3",
      startedAt: at("2026-11-17T16:00:00Z"),
      failure: "SKU-3: MEGÁLLT (own-price-missing) x",
    });
    await recordPriceAttempt(db, {
      productId: "p3",
      medusaProductId: "m3",
      startedAt: at("2026-11-17T17:00:00Z"),
      failure: null,
    });
    const stops = await storedPriceStops(db);
    assert.deepEqual(stops, [
      {
        productId: "p1",
        failedAt: "2026-11-17T17:44:00.000Z",
        reasons: [
          "SKU-1: MEGÁLLT (own-price-missing) üres",
          "SKU-2: MEGÁLLT (price-not-whole-forint) 12,5",
        ],
        kinds: ["own-price-missing", "price-not-whole-forint"],
        reasonCut: false,
      },
    ]);
  });

  it("a stored reason cut at 300 characters marks the cut and reads the unreadable last kind as truncated, not as a run failure called other", async () => {
    const { db } = tableWrittenBy();
    // the first message is 288 characters, the separator 2: the 300-character cut lands inside the SECOND message ("SKU-2: MEG")
    const first = "SKU-1: MEGÁLLT (own-price-missing) " + "x".repeat(253);
    await recordPriceAttempt(db, {
      productId: "cut",
      medusaProductId: "m",
      startedAt: at("2026-11-17T17:44:00Z"),
      failure: `${first}; SKU-2: MEGÁLLT (price-not-whole-forint) y`,
    });
    const [stop] = await storedPriceStops(db);
    assert.equal(stop!.reasonCut, true);
    assert.deepEqual(stop!.kinds, ["own-price-missing", "truncated"]);
  });

  it("lists a kind once when several variants of one product stopped for the same reason", async () => {
    const rows: Row[] = [
      {
        entityId: "two",
        lastSyncedAt: null,
        metadata: {
          failedAt: "2026-11-17T10:00:00.000Z",
          reason:
            "A: MEGÁLLT (own-price-missing) x; B: MEGÁLLT (own-price-missing) y",
        },
      },
    ];
    const stops = await storedPriceStops({
      externalReference: {
        findMany: async () => rows,
        upsert: async () => ({}),
      },
    });
    assert.deepEqual(stops[0]!.kinds, ["own-price-missing"]);
    assert.equal(stops[0]!.reasons.length, 2);
  });

  it("ignores rows without a usable failedAt, and orders the newest first", async () => {
    const rows: Row[] = [
      {
        entityId: "old",
        lastSyncedAt: null,
        metadata: {
          failedAt: "2026-11-16T10:00:00.000Z",
          reason: "A: MEGÁLLT (ambiguous-price) x",
        },
      },
      {
        entityId: "new",
        lastSyncedAt: null,
        metadata: {
          failedAt: "2026-11-17T10:00:00.000Z",
          reason: "B: MEGÁLLT (own-price-missing) y",
        },
      },
      { entityId: "empty", lastSyncedAt: new Date(), metadata: {} },
      { entityId: "null", lastSyncedAt: null, metadata: null },
      {
        entityId: "bad-date",
        lastSyncedAt: null,
        metadata: { failedAt: "nem datum", reason: "C" },
      },
      {
        entityId: "no-reason",
        lastSyncedAt: null,
        metadata: { failedAt: "2026-11-15T10:00:00.000Z" },
      },
    ];
    const stops = await storedPriceStops({
      externalReference: {
        findMany: async () => rows,
        upsert: async () => ({}),
      },
    });
    assert.deepEqual(
      stops.map((s) => s.productId),
      ["new", "old", "no-reason"],
    );
    assert.deepEqual(stops[2]!.reasons, []);
  });
});

function serviceOver(
  stored: Row[],
  products: { id: string; name: string; variants: { sku: string }[] }[],
) {
  const calls: string[] = [];
  const db: PriceStopsDatabase = {
    externalReference: {
      findMany: async () => {
        calls.push("reference.findMany");
        return stored;
      },
      upsert: async () => {
        throw new Error("a write on the read-only list");
      },
    },
    product: {
      findMany: async (args: unknown) => {
        calls.push("product.findMany");
        const ids = (args as { where: { id: { in: string[] } } }).where.id.in;
        return products.filter((p) => ids.includes(p.id));
      },
    },
  };
  return { service: new MedusaPriceStopsService(db), calls };
}

const stopRow = (
  id: string,
  reason: string,
  failedAt = "2026-11-17T10:00:00.000Z",
): Row => ({
  entityId: id,
  lastSyncedAt: null,
  metadata: { failedAt, reason },
});

describe("the list the endpoint serves", () => {
  it("gives the name from the product row and the SKUs from its variants, marks what a person has to do, and puts a person's work first", async () => {
    const { service } = serviceOver(
      [
        stopRow(
          "run",
          "SKU-R: MEGÁLLT (medusa-write-failed) 500",
          "2026-11-17T12:00:00.000Z",
        ),
        stopRow(
          "human",
          "SKU-H: MEGÁLLT (own-price-missing) üres",
          "2026-11-17T09:00:00.000Z",
        ),
        stopRow(
          "mixed",
          "SKU-M: MEGÁLLT (price-not-whole-forint) 1,5; SKU-M: MEGÁLLT (medusa-read-failed) x",
          "2026-11-17T08:00:00.000Z",
        ),
      ],
      [
        { id: "run", name: "Futási", variants: [{ sku: "SKU-R" }] },
        { id: "human", name: "Emberi", variants: [{ sku: "SKU-H" }] },
        {
          id: "mixed",
          name: "Vegyes",
          variants: [{ sku: "SKU-M1" }, { sku: "SKU-M2" }],
        },
      ],
    );
    const view = await service.list();
    assert.deepEqual(
      [view.total, view.needingPerson, view.truncated],
      [3, 2, false],
    );
    // a person's work first (human, mixed), the run failure last although it is the newest
    assert.deepEqual(
      view.stops.map((s) => s.skus.join("+")),
      ["SKU-H", "SKU-M1+SKU-M2", "SKU-R"],
    );
    assert.deepEqual(view.stops[0]!.kinds, [
      { kind: "own-price-missing", needsPerson: true },
    ]);
    assert.deepEqual(view.stops[1]!.kinds, [
      { kind: "price-not-whole-forint", needsPerson: true },
      { kind: "medusa-read-failed", needsPerson: false },
    ]);
    assert.deepEqual(view.stops[2]!.kinds, [
      { kind: "medusa-write-failed", needsPerson: false },
    ]);
    assert.equal(view.stops[0]!.name, "Emberi");
  });

  it("asks for the products of the shown page only: the in list is at most the limit long, however many stops are stored, and the person's work is in it", async () => {
    const asked: number[] = [];
    const stored = Array.from({ length: 1200 }, (_, i) =>
      i === 0
        ? stopRow(
            "p0",
            "H: MEGÁLLT (own-price-missing) y",
            "2026-11-16T00:00:00.000Z",
          )
        : stopRow(
            `p${i}`,
            "R: MEGÁLLT (medusa-write-failed) z",
            `2026-11-17T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
          ),
    );
    const db: PriceStopsDatabase = {
      externalReference: {
        findMany: async () => stored,
        upsert: async () => ({}),
      },
      product: {
        findMany: async (args: unknown) => {
          const ids = (args as { where: { id: { in: string[] } } }).where.id.in;
          asked.push(ids.length);
          assert.ok(
            ids.includes("p0"),
            "the one human data state is the OLDEST row and is among the asked ids: only the person-first order keeps it in the page",
          );
          return [];
        },
      },
    };
    const view = await new MedusaPriceStopsService(db).list();
    assert.deepEqual(asked, [PRICE_STOPS_LIMIT]);
    assert.deepEqual(
      [view.total, view.needingPerson, view.truncated, view.stops.length],
      [1200, 1, true, PRICE_STOPS_LIMIT],
    );
  });

  it("a reference whose product is gone is listed with no skus and a null name, not dropped and not an error", async () => {
    const { service } = serviceOver(
      [stopRow("gone", "X: MEGÁLLT (own-price-missing) y")],
      [],
    );
    const view = await service.list();
    assert.deepEqual(
      [view.stops[0]!.skus, view.stops[0]!.name, view.total],
      [[], null, 1],
    );
  });

  it("an empty table is an empty list, and the product table is not even asked", async () => {
    const { service, calls } = serviceOver([], []);
    const view = await service.list();
    assert.deepEqual(view, {
      total: 0,
      needingPerson: 0,
      truncated: false,
      stops: [],
    });
    assert.deepEqual(calls, ["reference.findMany"]);
  });

  it("cuts at the limit and says so, keeping a person's work first", async () => {
    const stored = Array.from({ length: PRICE_STOPS_LIMIT + 1 }, (_, i) =>
      stopRow(
        `p${i}`,
        i === PRICE_STOPS_LIMIT
          ? "L: MEGÁLLT (own-price-missing) y"
          : "R: MEGÁLLT (medusa-write-failed) z",
        `2026-11-17T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
      ),
    );
    const { service } = serviceOver(stored, []);
    const view = await service.list();
    assert.deepEqual(
      [view.total, view.stops.length, view.truncated],
      [PRICE_STOPS_LIMIT + 1, PRICE_STOPS_LIMIT, true],
    );
    // the one human data state is the OLDEST row by index, and still first: the cut takes run failures
    assert.equal(view.stops[0]!.productId, `p${PRICE_STOPS_LIMIT}`);
  });
});

describe("the endpoint is read-only and behind the status right", () => {
  it("asks for INVENTORY_VIEW, and has only a GET; the service and the controller hold no write call", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        MedusaPriceStopsController.prototype.list,
      ),
      [PERMISSIONS.INVENTORY_VIEW],
    );
    const controller = readFileSync(
      "src/integrations/medusa/medusa-price-stops.controller.ts",
      "utf8",
    );
    assert.match(controller, /@Get\(\)/); // control: the file is the one we read
    assert.doesNotMatch(controller, /@(Post|Put|Patch|Delete)\(/);
    const service = readFileSync(
      "src/integrations/medusa/medusa-price-stops.service.ts",
      "utf8",
    );
    assert.match(service, /findMany/); // control
    assert.doesNotMatch(
      service,
      /\.(upsert|create|createMany|update|updateMany|delete|deleteMany)\(/,
    );
  });
});
