import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

/**
 * THE OS'S OWN ORDER BUSINESS STATUS BELONGS TO UNAS AND POS ORDERS ONLY (ADR-015).
 *
 * A webshop (Medusa) order has ONE business status, the shop's own
 * (`order_business_status` in the commerce repo); the OS reads and changes it
 * through the shop's admin API. `SalesOrder.businessStatus` is the legacy
 * snapshot of orders the OS stores itself, and the two state machines differ
 * (names and allowed steps). They cannot disagree while the two sets of orders
 * stay disjoint, and they stay disjoint exactly as long as the OS never creates
 * a `SalesOrder` for a Medusa order.
 *
 * This guard pins that. Two things are measured, both on the source:
 *
 * 1. every place that creates a SalesOrder is on a short, named list (UNAS sync,
 *    POS, the demo data CLI). A new creation site fails here and has to be
 *    looked at, instead of arriving unnoticed;
 * 2. none of those files creates an order with the MEDUSA channel.
 *
 * It scans the SOURCE tree (`apps/api/src`), reached from the repo root: the
 * compiled spec runs from `test-dist`, which holds no `.ts` files, so a scan
 * relative to the compiled file would find nothing and every check below would
 * be vacuously green.
 */
const REPO = new URL("../../../../../", import.meta.url).pathname;
const SRC = join(REPO, "apps/api/src");

/** The only files that may create a SalesOrder, and the channel each one uses. */
const CREATION_SITES: Readonly<Record<string, string>> = {
  "orders/unas-order-sync/unas-order-sync.repository.ts": "UNAS",
  "pos/pos-sale.repository.ts": "POS",
  "demo-data/demo-data.cli.ts": "POS",
};

/** The shapes that create a SalesOrder: the Prisma call, a nested create, raw SQL. */
const CREATION_PATTERNS: readonly RegExp[] = [
  /\bsalesOrder\.(?:create|createMany|createManyAndReturn|upsert)\s*\(/,
  /\bsalesOrders\s*:\s*\{\s*(?:create|createMany|connectOrCreate)\b/,
  /INSERT\s+INTO\s+"?SalesOrder"?/i,
];

/**
 * A SalesOrder written with the MEDUSA channel: a literal, the enum member, or a
 * literal inside the `channel:` value (a ternary). The value ends at the first
 * comma, so `channel: "POS", system: "MEDUSA"` is not a hit.
 */
const MEDUSA_CHANNEL =
  /\bchannel\s*:\s*[^,\n;{}]{0,60}["']MEDUSA["']|\bSalesChannel\.MEDUSA\b/;

function createsSalesOrder(text: string): boolean {
  return CREATION_PATTERNS.some((pattern) => pattern.test(text));
}

function writesMedusaChannel(text: string): boolean {
  return MEDUSA_CHANNEL.test(text);
}

function productionSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "testing") continue;
      found.push(...productionSources(path));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(path);
    }
  }
  return found;
}

describe("the OS creates a SalesOrder only for UNAS and POS orders, never for a Medusa order (ADR-015)", () => {
  const sources = productionSources(SRC).map((path) => ({
    name: relative(SRC, path).split("\\").join("/"),
    text: readFileSync(path, "utf8"),
  }));
  const creating = sources
    .filter((source) => createsSalesOrder(source.text))
    .map((source) => source.name)
    .sort();

  it("the scan sees the source tree and the three known creation sites (a wrong root would make every check below vacuous)", () => {
    assert.ok(
      sources.length > 500,
      `the scan found only ${sources.length} source files under ${SRC}`,
    );
    assert.deepEqual(creating, Object.keys(CREATION_SITES).sort());
  });

  it("no file outside the named list creates a SalesOrder", () => {
    const unexpected = creating.filter((name) => !(name in CREATION_SITES));
    assert.deepEqual(
      unexpected,
      [],
      `${unexpected.join(", ")} creates a SalesOrder but is not on the list in order-status-source.spec.ts. A webshop (Medusa) order is not a SalesOrder in the OS: its business status lives in the shop (ADR-015). If this is a new UNAS or POS creation path, add it to CREATION_SITES with its channel; if it creates an order for the webshop, it needs a new decision first.`,
    );
  });

  for (const [name, channel] of Object.entries(CREATION_SITES)) {
    it(`${name} creates ${channel} orders and none with the MEDUSA channel`, () => {
      const source = sources.find((candidate) => candidate.name === name);
      assert.ok(source, `${name} is on the list but not in the source tree`);
      assert.ok(
        createsSalesOrder(source.text),
        `${name} is on the list but no longer creates a SalesOrder: remove it from CREATION_SITES`,
      );
      assert.ok(
        source.text.includes(`channel: "${channel}"`),
        `${name} no longer writes channel: "${channel}"`,
      );
      assert.equal(
        writesMedusaChannel(source.text),
        false,
        `${name} writes a SalesOrder with the MEDUSA channel: a Medusa order is not a SalesOrder in the OS (ADR-015)`,
      );
    });
  }

  it("the detector sees a creation and a MEDUSA channel in sample text, and ignores a different channel", () => {
    assert.equal(
      createsSalesOrder("await tx.salesOrder.create({ data })"),
      true,
    );
    assert.equal(
      createsSalesOrder("await tx.salesOrder.upsert({ where })"),
      true,
    );
    assert.equal(
      createsSalesOrder(
        "customer: { update: { salesOrders: { create: [] } } }",
      ),
      true,
    );
    assert.equal(
      createsSalesOrder('INSERT INTO "SalesOrder" (id) VALUES ($1)'),
      true,
    );
    assert.equal(createsSalesOrder("await tx.salesOrder.findMany({})"), false);
    assert.equal(writesMedusaChannel('data: { channel: "MEDUSA" }'), true);
    assert.equal(writesMedusaChannel("channel: SalesChannel.MEDUSA"), true);
    assert.equal(
      writesMedusaChannel('channel: isShop ? "MEDUSA" : "POS",'),
      true,
    );
    assert.equal(writesMedusaChannel('data: { channel: "POS" }'), false);
    assert.equal(
      writesMedusaChannel('{ channel: "POS", system: "MEDUSA" }'),
      false,
    );
    assert.equal(
      writesMedusaChannel(
        'const ref = { system: "MEDUSA", entityType: "Customer" }',
      ),
      false,
    );
  });
});
