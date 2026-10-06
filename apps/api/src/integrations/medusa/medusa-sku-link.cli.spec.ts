import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MedusaProductLinkConflictError } from "./medusa-product-link.repository.js";
import {
  linkOutcome,
  runSkuLinkCli,
  type SkuLinkCliDatabase,
} from "./medusa-sku-link.cli.js";
import type { ShopSkuProduct } from "./medusa-sku-pairing.js";

/**
 * AZ ÖSSZEKÖTŐ PARANCS. MI PIROSÍT: ha `--apply` nélkül ír; ha egy meglévő
 * kötést felülír vagy újraír; ha a kötés ideje nem a futás kezdete; ha az
 * external_id feltétellé válik; ha üres oldal mellett "nincs pár" eredményt ad.
 */
const NOW = new Date("2026-10-07T01:30:00Z");

function fakes(input: {
  variants?: { sku: string; productId: string }[];
  links?: { entityId: string; externalId: string }[];
  shop?: ShopSkuProduct[];
  linkError?: Error;
}) {
  const ki: string[] = [];
  const written: { os: string; shop: string; at: Date }[] = [];
  const database = {
    productVariant: {
      findMany: async () =>
        input.variants ?? [
          { sku: "A", productId: "os-1" },
          { sku: "B", productId: "os-2" },
          { sku: "C", productId: "os-3" },
        ],
    },
    unasProductSnapshot: { findMany: async () => [] },
    externalReference: { findMany: async () => input.links ?? [] },
  } as unknown as SkuLinkCliDatabase;
  const shopProducts = input.shop ?? [
    { id: "sh-1", external_id: "os-1", variants: [{ sku: "A" }] },
    { id: "sh-2", external_id: "cmtm-old", variants: [{ sku: "B" }] },
    { id: "sh-3", external_id: null, variants: [{ sku: "C" }] },
    { id: "sh-4", external_id: "cmtm-x", variants: [{ sku: "ZZZ" }] },
  ];
  const deps = {
    shop: {
      listProductSkus: async (offset: number, limit: number) => ({
        products: shopProducts.slice(offset, offset + limit),
        count: shopProducts.length,
      }),
    },
    links: {
      link: async (os: string, shop: string, at: Date) => {
        if (input.linkError) throw input.linkError;
        written.push({ os, shop, at });
        return {} as never;
      },
    },
    now: () => NOW,
  };
  const out = {
    stdout: (v: string) => ki.push(v),
    stderr: (v: string) => ki.push("ERR:" + v),
  };
  const run = (args: string[]) =>
    runSkuLinkCli(args, out, undefined as never, database, deps);
  return { run, ki: () => ki.join(""), written };
}

describe("runSkuLinkCli", () => {
  it("--apply nélkül nem ír, és okonként számol", async () => {
    const f = fakes({});
    assert.equal(await f.run([]), 0);
    assert.deepEqual(f.written, []);
    const ki = f.ki();
    assert.match(ki, /kötnénk: 3/);
    assert.match(ki, /az SKU nem ismert az OS-ben: 1/);
    assert.match(ki, /sh-4 \(sku: ZZZ\): az SKU nem ismert/);
    assert.match(ki, /semmit nem írt/);
  });

  it("--apply a futás kezdetével köt, csak az új párokat", async () => {
    const f = fakes({
      links: [{ entityId: "os-1", externalId: "sh-1" }],
    });
    assert.equal(await f.run(["--apply"]), 0);
    assert.deepEqual(f.written, [
      { os: "os-2", shop: "sh-2", at: NOW },
      { os: "os-3", shop: "sh-3", at: NOW },
    ]);
    const ki = f.ki();
    assert.match(ki, /most kötve: 2/);
    assert.match(ki, /már így volt kötve: 1/);
  });

  it("meglévő, máshova mutató kötést nem ír felül, hanem kiírja", async () => {
    const f = fakes({
      links: [{ entityId: "os-2", externalId: "sh-99" }],
    });
    await f.run(["--apply"]);
    assert.ok(!f.written.some((w) => w.os === "os-2"));
    assert.match(
      f.ki(),
      /sh-2 -> os-2: ütközik egy meglévő kötéssel \(az OS termék kötése: sh-99/,
    );
  });

  it("az external_id nem feltétel, csak eltérésként számolva", async () => {
    const f = fakes({});
    await f.run([]);
    assert.match(
      f.ki(),
      /1 egyezik az OS termékkel, 1 régi OS-állapoté, 1 üres/,
    );
  });

  it("írás közbeni ütközés ütközésként számít, nem hibaként", async () => {
    const f = fakes({
      linkError: new MedusaProductLinkConflictError("os-1", "sh-1", {
        productId: "os-1",
        medusaProductId: "sh-9",
      } as never),
    });
    assert.equal(await f.run(["--apply"]), 0);
    assert.match(f.ki(), /ütközik egy meglévő kötéssel: 3/);
  });

  it("üres oldal mellett megáll, és nem mond párosítási eredményt", async () => {
    const f = fakes({ variants: [] });
    assert.equal(await f.run(["--apply"]), 1);
    assert.deepEqual(f.written, []);
    assert.match(f.ki(), /0 OS változat, 4 bolti termék/);
  });

  it("ismeretlen argumentumot nem nyel le", async () => {
    const f = fakes({});
    assert.equal(await f.run(["--aply"]), 1);
    assert.deepEqual(f.written, []);
  });
});

describe("linkOutcome", () => {
  const pair = {
    kind: "pair" as const,
    shopProductId: "sh-1",
    osProductId: "os-1",
    externalId: null,
  };
  it("a bolti termék már más OS termékhez kötve: ütközés", () => {
    assert.equal(
      linkOutcome(pair, new Map(), new Map([["sh-1", "os-9"]])),
      "conflict",
    );
  });
  it("mindkét irányban ugyanaz: már kötve", () => {
    assert.equal(
      linkOutcome(
        pair,
        new Map([["os-1", "sh-1"]]),
        new Map([["sh-1", "os-1"]]),
      ),
      "already-linked",
    );
  });
});
