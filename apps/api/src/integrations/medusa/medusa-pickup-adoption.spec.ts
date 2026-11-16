import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adoptPickup,
  describePickupAdoption,
  describeUnmarkedPickup,
  listUnmarkedPickup,
  parseReviewedIds,
  type PickupAdoptionService,
  type UnmarkedPickupReport,
} from "./medusa-pickup-adoption.js";

/*
  A MULTBELI MARADEK LISTAJA ES ATNEZETT ATVETELE (kartya c603774e). MI PIROSIT: a lista a jelolt vagy a hamis atvetelu sort is
  felsorolja; egy besorolas (live / profile / none / unpaired) rossz; a regi bolt (nincs jelolo mezo) listat ad; a profil-sorral
  kimondott vagy a parositatlan sor adoptalhato; a fajlban nem szereplo sort jelol; egy elgepelt azonosito csendben marad; a
  kozben megvaltozott sor jelolesnek szamit; az `apply` nelkuli futas ir.
*/
const sor = (product_id: string, pickup_only: boolean, derived?: boolean) => ({
  id: `sa_${product_id}`,
  product_id,
  pickup_only,
  ...(derived === undefined ? {} : { pickup_only_derived: derived }),
  foxpost_forbidden: false,
  is_heavy: false,
  is_frozen: false,
  locker_unsuitable: false,
  livestock_kind: null,
});

const kotesek: Record<string, string> = {
  "shop-none": "os-none",
  "shop-live": "os-live",
  "shop-profile": "os-profile",
  "shop-marked": "os-marked",
  "shop-off": "os-off",
};

function lista(rows: ReturnType<typeof sor>[]) {
  let parositas = 0;
  const service = {
    listShopShippingAttributes: async () => rows,
    osProductOfShop: async (shop: string) => kotesek[shop] ?? null,
  } as unknown as Pick<
    PickupAdoptionService,
    "listShopShippingAttributes" | "osProductOfShop"
  >;
  const options = {
    pairing: async () => {
      parositas += 1;
      return new Map<string, string>([["os-sku", "shop-sku"]]);
    },
    live: new Set(["os-live"]),
    profilePickup: new Set(["os-profile"]),
    names: async (ids: string[]) =>
      new Map(ids.map((id) => [id, `név ${id}`] as const)),
  };
  return { service, options, parositasok: () => parositas };
}

describe("a jelölő nélküli átvételek listája", () => {
  const rows = [
    sor("shop-none", true, false),
    sor("shop-live", true, false),
    sor("shop-profile", true, false),
    sor("shop-marked", true, true),
    sor("shop-off", false, false),
    sor("shop-sku", true, false),
    sor("shop-arva", true, false),
  ];

  it("csak az igaz, jelölő nélküli sort sorolja fel, és besorolja: none, live, profile, unpaired", async () => {
    const f = lista(rows);
    const report = await listUnmarkedPickup(f.service, f.options);
    assert.equal(report.rows, 7);
    assert.equal(report.marked, 1);
    assert.deepEqual(
      report.unmarked.map((e) => [e.shopProductId, e.osProductId, e.verdict]),
      [
        ["shop-none", "os-none", "none"],
        // a SKU-pár is megtalálja az OS-terméket (és nem az egyik sem az élő állat, sem a profil: none)
        ["shop-sku", "os-sku", "none"],
        ["shop-live", "os-live", "live"],
        ["shop-profile", "os-profile", "profile"],
        ["shop-arva", null, "unpaired"],
      ],
    );
    assert.equal(report.unmarked[0]?.name, "név os-none");
    assert.equal(report.unmarked[4]?.name, null);
  });

  it("a SKU-párosítást csak akkor kéri, ha van kötés-sor nélküli sor, és akkor is egyszer", async () => {
    const csakKotott = lista([sor("shop-none", true, false)]);
    await listUnmarkedPickup(csakKotott.service, csakKotott.options);
    assert.equal(csakKotott.parositasok(), 0);
    const ketArva = lista([
      sor("shop-x", true, false),
      sor("shop-y", true, false),
    ]);
    await listUnmarkedPickup(ketArva.service, ketArva.options);
    assert.equal(ketArva.parositasok(), 1);
  });

  it("a régi bolt (egyetlen sorban sincs jelölő mező) nem ad listát, és ezt kimondja", async () => {
    const f = lista([sor("shop-none", true), sor("shop-live", true)]);
    const report = await listUnmarkedPickup(f.service, f.options);
    assert.equal(report.markKnown, false);
    assert.deepEqual(report.unmarked, []);
    assert.match(describeUnmarkedPickup(report), /nincs jelölő mező/);
  });

  it("a szöveg: összesítő besorolásonként, majd soronként OS-azonosító | bolti azonosító | besorolás | név", async () => {
    const f = lista(rows);
    const szoveg = describeUnmarkedPickup(
      await listUnmarkedPickup(f.service, f.options),
    );
    assert.match(
      szoveg,
      /Csak bolti átvétel jelölő nélkül: 5 sor \(a bolt 7 szállítási-jellemző sort adott, 1 már jelölt\)/,
    );
    assert.match(szoveg, /none \(.*\): 2\n/);
    assert.match(szoveg, /unpaired \(.*\): 1\n/);
    assert.match(szoveg, /^os-none \| shop-none \| none \| név os-none$/m);
    assert.match(szoveg, /^- \| shop-arva \| unpaired \| -$/m);
  });
});

describe("az átnézett fájl", () => {
  it("soronként az első szó az azonosító; az üres és a # kezdetű sor nem számít; a lista sora is jó", () => {
    const ids = parseReviewedIds(
      "# átnézve\n\nos-a\n  os-b  \nos-c | shop-c | none | Név\r\nos-a\n",
    );
    assert.deepEqual([...ids], ["os-a", "os-b", "os-c"]);
  });
});

describe("az átnézett átvétel adoptálása", () => {
  const report: UnmarkedPickupReport = {
    rows: 5,
    markKnown: true,
    marked: 0,
    unmarked: [
      {
        shopProductId: "shop-none",
        osProductId: "os-none",
        verdict: "none",
        name: null,
      },
      {
        shopProductId: "shop-live",
        osProductId: "os-live",
        verdict: "live",
        name: null,
      },
      {
        shopProductId: "shop-profile",
        osProductId: "os-profile",
        verdict: "profile",
        name: null,
      },
      {
        shopProductId: "shop-arva",
        osProductId: null,
        verdict: "unpaired",
        name: null,
      },
    ],
  };
  const fake = (action: "applied" | "unchanged" = "applied") => {
    const hivasok: { shop: string; apply: boolean }[] = [];
    const service = {
      adoptPickupMark: async (row: { product_id: string }, apply: boolean) => {
        hivasok.push({ shop: row.product_id, apply });
        return {
          action: apply ? action : ("planned" as const),
          medusaProductId: row.product_id,
        };
      },
    } as unknown as Pick<PickupAdoptionService, "adoptPickupMark">;
    return { service, hivasok };
  };

  it("csak a fájlban felsorolt none és live sort jelöli; a nem felsoroltat, a profile-t és a párosítatlant nem", async () => {
    const f = fake();
    const result = await adoptPickup(
      f.service,
      report,
      new Set(["os-none", "os-profile"]),
      true,
    );
    assert.deepEqual(f.hivasok, [{ shop: "shop-none", apply: true }]);
    assert.deepEqual(
      result.adopted.map((a) => a.osProductId),
      ["os-none"],
    );
    assert.deepEqual(result.refused, [
      { id: "os-profile", reason: "profile: ezt nem lehet adoptálni" },
    ]);
    const live = await adoptPickup(
      fake().service,
      report,
      new Set(["os-live"]),
      true,
    );
    assert.deepEqual(
      live.adopted.map((a) => a.osProductId),
      ["os-live"],
    );
  });

  it("az elgépelt vagy nem szereplő azonosítót megnevezi, és semmit nem jelöl érte", async () => {
    const f = fake();
    const result = await adoptPickup(
      f.service,
      report,
      new Set(["os-elirt"]),
      true,
    );
    assert.deepEqual(f.hivasok, []);
    assert.equal(result.refused[0]?.id, "os-elirt");
    assert.match(result.refused[0]!.reason, /elgépelt azonosító/);
  });

  it("apply nélkül csak tervez; a közben megváltozott sor nem számít jelölésnek", async () => {
    const terv = fake();
    const result = await adoptPickup(
      terv.service,
      report,
      new Set(["os-none"]),
      false,
    );
    assert.deepEqual(terv.hivasok, [{ shop: "shop-none", apply: false }]);
    assert.equal(result.adopted[0]?.action, "planned");
    assert.match(describePickupAdoption(result, false), /os-none: JELÖLNÉNK/);

    const valtozott = await adoptPickup(
      fake("unchanged").service,
      report,
      new Set(["os-none"]),
      true,
    );
    const szoveg = describePickupAdoption(valtozott, true);
    assert.match(szoveg, /közben megváltozott, nem nyúltunk hozzá/);
    assert.match(szoveg, /0 jelölve/);
  });
});
