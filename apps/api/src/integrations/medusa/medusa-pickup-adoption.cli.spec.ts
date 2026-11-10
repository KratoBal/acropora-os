import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runPickupAdoptionCli,
  type PickupAdoptionCliDatabase,
} from "./medusa-pickup-adoption.cli.js";
import type { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";

/*
  A PARANCS (kartya c603774e). MI PIROSIT: a lista ir; az --apply az --adopt nelkul elindul; az --adopt fajl nelkul vagy ures
  fajllal fut; az --apply nelkuli adopt ir; a lista nem nezi meg az elo allat besorolast es a profil-sort (minden sor none lenne);
  a parancs a regi boltra sikert jelent.
*/
const sorok = [
  {
    id: "sa_1",
    product_id: "shop-none",
    pickup_only: true,
    pickup_only_derived: false,
  },
  {
    id: "sa_2",
    product_id: "shop-live",
    pickup_only: true,
    pickup_only_derived: false,
  },
  {
    id: "sa_3",
    product_id: "shop-profile",
    pickup_only: true,
    pickup_only_derived: false,
  },
];

function kornyezet(regiBolt = false) {
  const jelolesek: string[] = [];
  const service = {
    listShopShippingAttributes: async () =>
      regiBolt
        ? sorok.map(({ pickup_only_derived: _ignored, ...rest }) => rest)
        : sorok,
    osProductOfShop: async (shop: string) =>
      ({
        "shop-none": "os-none",
        "shop-live": "os-live",
        "shop-profile": "os-profile",
      })[shop] ?? null,
    adoptPickupMark: async (row: { product_id: string }, apply: boolean) => {
      if (apply) jelolesek.push(row.product_id);
      return {
        action: apply ? "applied" : "planned",
        medusaProductId: row.product_id,
      };
    },
    listShopSkus: async () => ({ products: [], count: 0 }),
  } as unknown as MedusaShippingAttributesService;
  const database = {
    category: {
      findMany: async () => [
        { id: "c-root", name: "Halak", parentId: null },
        { id: "c-sub", name: "Tengeri halak", parentId: "c-root" },
      ],
    },
    productCategory: {
      findMany: async () => [{ productId: "os-live", categoryId: "c-sub" }],
    },
    productShippingProfile: {
      findMany: async () => [{ productId: "os-profile" }],
    },
    productVariant: { findMany: async () => [] },
    unasProductSnapshot: { findMany: async () => [] },
    product: {
      findMany: async () => [
        { id: "os-none", name: "Maradék termék" },
        { id: "os-live", name: "Élő termék" },
        { id: "os-profile", name: "Profilos termék" },
      ],
    },
  } as unknown as PickupAdoptionCliDatabase;
  const kimenet = { out: "", err: "" };
  const out = {
    stdout: (v: string) => (kimenet.out += v),
    stderr: (v: string) => (kimenet.err += v),
  };
  const run = (args: string[], fajl = "os-none\n") =>
    runPickupAdoptionCli(
      args,
      out,
      undefined,
      database,
      service as never,
      async () => fajl,
    );
  return { run, kimenet, jelolesek };
}

describe("a múltbeli átvétel parancsa", () => {
  it("argumentum nélkül csak listáz: besorolva (none, live, profile), és nem ír", async () => {
    const k = kornyezet();
    assert.equal(await k.run([]), 0);
    assert.match(
      k.kimenet.out,
      /^os-none \| shop-none \| none \| Maradék termék$/m,
    );
    assert.match(
      k.kimenet.out,
      /^os-live \| shop-live \| live \| Élő termék$/m,
    );
    assert.match(
      k.kimenet.out,
      /^os-profile \| shop-profile \| profile \| Profilos termék$/m,
    );
    assert.deepEqual(k.jelolesek, []);
  });

  it("az --apply az --adopt nélkül, az --adopt fájl nélkül, és az üres fájl: hibával áll meg, és nem ír", async () => {
    for (const [args, fajl] of [
      [["--apply"], "os-none\n"],
      [["--adopt"], "os-none\n"],
      [["--adopt", "--apply"], "os-none\n"],
      [["--adopt", "f.txt", "--apply"], "# semmi\n\n"],
    ] as const) {
      const k = kornyezet();
      assert.equal(await k.run([...args], fajl), 2, args.join(" "));
      assert.deepEqual(k.jelolesek, []);
      assert.equal(k.kimenet.out, "");
    }
  });

  it("az --adopt <fájl> --apply nélkül csak tervez; --apply-jal a fájlban felsoroltat jelöli, a többit nem", async () => {
    const terv = kornyezet();
    assert.equal(await terv.run(["--adopt", "f.txt"]), 0);
    assert.match(terv.kimenet.out, /os-none: JELÖLNÉNK/);
    assert.match(terv.kimenet.out, /Ez a futás semmit nem írt/);
    assert.deepEqual(terv.jelolesek, []);

    const ir = kornyezet();
    assert.equal(await ir.run(["--adopt", "f.txt", "--apply"]), 0);
    assert.deepEqual(ir.jelolesek, ["shop-none"]);
  });

  it("egy nem adoptálható vagy elgépelt azonosító hibakóddal jelez, és a többit jelöli", async () => {
    const k = kornyezet();
    assert.equal(
      await k.run(
        ["--adopt", "f.txt", "--apply"],
        "os-none\nos-profile\nos-elirt\n",
      ),
      1,
    );
    assert.deepEqual(k.jelolesek, ["shop-none"]);
    assert.match(k.kimenet.out, /os-profile: NEM adoptáltuk/);
    assert.match(k.kimenet.out, /os-elirt: NEM adoptáltuk/);
  });

  it("a régi bolton (nincs jelölő mező) a lista kimondja ezt, az adopt hibával áll meg, és nem ír", async () => {
    const k = kornyezet(true);
    assert.equal(await k.run([]), 0);
    assert.match(k.kimenet.out, /nincs jelölő mező/);
    const ir = kornyezet(true);
    assert.equal(await ir.run(["--adopt", "f.txt", "--apply"]), 1);
    assert.deepEqual(ir.jelolesek, []);
  });
});
