import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clearLeftoverKinds,
  describeLeftoverKinds,
  liveAnimalProductIds,
  type LeftoverKindService,
} from "./medusa-leftover-kind.js";

/*
  A MEGOSZTOTT SZABALY (kartya 4b30b373). MI PIROSIT: a skip (celpont vagy elo allat besorolas) termeket is torli; a
  parositatlan bolti sort bantja; a fajta nelkuli sort torli; az `only` szukitest figyelmen kivul hagyja; az `apply`
  hamis erteke ellenere ir; az elo allat besorolast nem a harom gyoker reszfajabol olvassa.
*/
const sor = (product_id: string, kind: "FISH" | "CORAL" | null) => ({
  id: `sa_${product_id}`,
  product_id,
  pickup_only: true,
  foxpost_forbidden: false,
  is_heavy: false,
  is_frozen: false,
  locker_unsuitable: false,
  livestock_kind: kind,
});

function szolgaltatas(
  rows: ReturnType<typeof sor>[],
  kotesek: Record<string, string>,
) {
  const torlesek: { shop: string; apply: boolean }[] = [];
  const service = {
    listShopShippingAttributes: async () => rows,
    osProductOfShop: async (shop: string) => kotesek[shop] ?? null,
    clearLeftoverKind: async (row: { product_id: string }, apply: boolean) => {
      torlesek.push({ shop: row.product_id, apply });
      return {
        action: apply ? ("applied" as const) : ("planned" as const),
        medusaProductId: row.product_id,
        flags: "élő állat: hal -> a fajta törlése",
      };
    },
  } as unknown as LeftoverKindService;
  return { service, torlesek };
}

describe("a boltban maradt fajta megosztott szabálya", () => {
  const rows = [
    sor("shop-stale", "FISH"),
    sor("shop-live", "CORAL"),
    sor("shop-orphan", "FISH"),
    sor("shop-none", null),
  ];
  const kotesek = {
    "shop-stale": "os-stale",
    "shop-live": "os-live",
    "shop-none": "os-none",
  };

  it("törli, aminek nincs élő állat besorolása; a besorolt, a párosítatlan és a fajta nélküli sorhoz nem nyúl", async () => {
    const { service, torlesek } = szolgaltatas(rows, kotesek);
    const jelentes = await clearLeftoverKinds(service, {
      skip: (id) => id === "os-live",
      pairing: async () => new Map(),
      apply: true,
    });
    assert.deepEqual(torlesek, [{ shop: "shop-stale", apply: true }]);
    assert.deepEqual(
      jelentes.entries.map((e) => [e.osProductId, e.action]),
      [["os-stale", "applied"]],
    );
    assert.equal(jelentes.rows, 4);
    assert.equal(jelentes.carrying, 3);
    assert.equal(jelentes.unpaired, 1);
  });

  it("apply nélkül csak tervez", async () => {
    const { service, torlesek } = szolgaltatas(rows, kotesek);
    const jelentes = await clearLeftoverKinds(service, {
      skip: () => false,
      pairing: async () => new Map(),
      apply: false,
    });
    assert.deepEqual(
      torlesek.map((t) => t.apply),
      [false, false],
    );
    assert.ok(jelentes.entries.every((e) => e.action === "planned"));
  });

  it("a SKU-pár is megtalálja az OS-terméket, és az only szűkít", async () => {
    const { service, torlesek } = szolgaltatas([sor("shop-sku", "FISH")], {});
    await clearLeftoverKinds(service, {
      skip: () => false,
      pairing: async () => new Map([["os-sku", "shop-sku"]]),
      only: ["os-másik"],
      apply: true,
    });
    assert.deepEqual(torlesek, []);
    await clearLeftoverKinds(service, {
      skip: () => false,
      pairing: async () => new Map([["os-sku", "shop-sku"]]),
      only: ["os-sku"],
      apply: true,
    });
    assert.deepEqual(torlesek, [{ shop: "shop-sku", apply: true }]);
  });

  it("a SKU-párosítást csak akkor kéri, ha van kötés-sor nélküli, fajtát viselő sor, és akkor is egyszer", async () => {
    let kerte = 0;
    const pairing = async () => {
      kerte += 1;
      return new Map<string, string>();
    };
    // nincs fajtát viselő sor: a párosítás sem kell
    await clearLeftoverKinds(szolgaltatas([sor("a", null)], {}).service, {
      skip: () => false,
      pairing,
      apply: true,
    });
    assert.equal(kerte, 0);
    // minden fajtát viselő sornak van kötés-sora: a párosítás sem kell
    await clearLeftoverKinds(
      szolgaltatas([sor("a", "FISH")], { a: "os-a" }).service,
      { skip: () => false, pairing, apply: true },
    );
    assert.equal(kerte, 0);
    // két kötés nélküli sor: egyszer kéri
    await clearLeftoverKinds(
      szolgaltatas([sor("a", "FISH"), sor("b", "CORAL")], {}).service,
      { skip: () => false, pairing, apply: true },
    );
    assert.equal(kerte, 1);
  });

  it("a jelentés kimondja, mit látott és mit tett", () => {
    const szoveg = describeLeftoverKinds(
      {
        rows: 10,
        carrying: 3,
        derivedPickup: 2,
        unpaired: 1,
        entries: [
          {
            osProductId: "os-1",
            medusaProductId: "prod_1",
            flags: "x",
            action: "applied",
          },
        ],
      },
      true,
    );
    assert.match(szoveg, /os-1: most állítottuk be -> prod_1 \(x\)/);
    assert.match(
      szoveg,
      /a bolt 10 szállítási-jellemző sort adott, 3-n áll fajta, 1 törölve, 1 OS-termék nélkül/,
    );
    assert.match(
      szoveg,
      /Az OS által jelölt, származtatott bolti átvétel: 2 sor\./,
    );
    const nulla = describeLeftoverKinds(
      { rows: 1, carrying: 0, derivedPickup: 0, unpaired: 0, entries: [] },
      true,
    );
    assert.doesNotMatch(nulla, /származtatott/);
  });
});

describe("az élő állat besorolású termékek", () => {
  it("a három gyökér részfájába tartozó besorolás bármelyik sora számít, a többi nem", async () => {
    const lekerdezesek: unknown[] = [];
    const ids = await liveAnimalProductIds({
      category: {
        findMany: async () => [
          { id: "gy1", name: "Korallok", parentId: null },
          { id: "gy1a", name: "SPS", parentId: "gy1" },
          { id: "mu1", name: "Technika", parentId: null },
        ],
      },
      productCategory: {
        findMany: async (args: unknown) => {
          lekerdezesek.push(args);
          return [
            { productId: "os-a", categoryId: "gy1a" },
            { productId: "os-b", categoryId: "gy1" },
          ];
        },
      },
    });
    assert.deepEqual([...ids].sort(), ["os-a", "os-b"]);
    const kerdes = lekerdezesek[0] as {
      where: { categoryId: { in: string[] } };
    };
    assert.deepEqual([...kerdes.where.categoryId.in].sort(), ["gy1", "gy1a"]);
  });

  it("élő állat kategória nélkül üres halmaz, és nem kérdez rá a besorolásokra", async () => {
    let hivas = 0;
    const ids = await liveAnimalProductIds({
      category: {
        findMany: async () => [{ id: "mu1", name: "Technika", parentId: null }],
      },
      productCategory: {
        findMany: async () => {
          hivas += 1;
          return [];
        },
      },
    });
    assert.equal(ids.size, 0);
    assert.equal(hivas, 0);
  });
});

/*
  A SZARMAZTATOTT ATVETEL LEVETELE A MEGOSZTOTT SZABALYBAN (kartya c603774e). MI PIROSIT: kapcsolo (`pickup`) nelkul is nyul az
  atvetelhez; a kezi (jelolo nelkuli) sort is leveszi; a profil-sorral megtartott termeket (`keep`) vagy a celpontot (`skip`)
  leveszi; a fajta-kapcsolo kikapcsolva (`kind: false`) is torli a fajtat; egy sor, amin fajta ES jelolt atvetel is all, ket
  iras lesz egy helyett; a parositatlan jelolt sor nem szamit torlesnek; a kozben megvaltozott sor torleskent szamolodik.
*/
describe("a boltban maradt származtatott átvétel megosztott szabálya", () => {
  const atvetel = (
    product_id: string,
    derived: boolean | undefined,
    kind: "FISH" | null = null,
    pickup = true,
  ) => ({
    ...sor(product_id, kind),
    pickup_only: pickup,
    ...(derived === undefined ? {} : { pickup_only_derived: derived }),
  });

  function figyelo(
    rows: ReturnType<typeof atvetel>[],
    kotesek: Record<string, string>,
    action: "applied" | "unchanged" = "applied",
  ) {
    const hivasok: { shop: string; clear: unknown }[] = [];
    const service = {
      listShopShippingAttributes: async () => rows,
      osProductOfShop: async (shop: string) => kotesek[shop] ?? null,
      clearLeftoverKind: async (
        row: { product_id: string },
        _apply: boolean,
        clear: unknown,
      ) => {
        hivasok.push({ shop: row.product_id, clear });
        return { action, medusaProductId: row.product_id, flags: "x" };
      },
    } as unknown as LeftoverKindService;
    return { service, hivasok };
  }
  const rows = [
    atvetel("jelolt", true),
    atvetel("kezi", false),
    atvetel("regi", undefined),
    atvetel("ki", true, null, false),
    atvetel("profilos", true),
    atvetel("celpont", true),
  ];
  const kotesek = {
    jelolt: "os-jelolt",
    kezi: "os-kezi",
    regi: "os-regi",
    ki: "os-ki",
    profilos: "os-profilos",
    celpont: "os-celpont",
  };
  const keres = {
    pairing: async () => new Map<string, string>(),
    apply: true,
    kind: false,
  };

  it("kapcsoló nélkül nem nyúl az átvételhez; kapcsolóval csak a jelölt, el nem tartott, nem célpont sort veszi le", async () => {
    // kapcsoló nélkül a jelölt sor nem is jelölt: a párosítatlan jelölt sor nem kér SKU-párosítást (bolti listaolvasás), és nem számít párosítatlannak
    let parositast = 0;
    const ki = figyelo([...rows, atvetel("arva", true)], kotesek);
    const kiJelentes = await clearLeftoverKinds(ki.service, {
      ...keres,
      skip: () => false,
      pairing: async () => {
        parositast += 1;
        return new Map<string, string>();
      },
    });
    assert.deepEqual(ki.hivasok, []);
    assert.equal(parositast, 0);
    assert.equal(kiJelentes.unpaired, 0);

    const be = figyelo(rows, kotesek);
    const jelentes = await clearLeftoverKinds(be.service, {
      ...keres,
      skip: (id) => id === "os-celpont",
      pickup: { keep: (id) => id === "os-profilos" },
    });
    assert.deepEqual(be.hivasok, [
      { shop: "jelolt", clear: { kind: false, pickup: true } },
    ]);
    assert.equal(jelentes.derivedPickup, 3);
    assert.equal(jelentes.entries.length, 1);
  });

  it("egy soron fajta és jelölt átvétel is áll: EGY írás, mindkettővel; a fajta-kapcsoló nélkül csak az átvétel", async () => {
    const mind = [atvetel("mindketto", true, "FISH")];
    const egyutt = figyelo(mind, { mindketto: "os-m" });
    await clearLeftoverKinds(egyutt.service, {
      ...keres,
      kind: true,
      skip: () => false,
      pickup: { keep: () => false },
    });
    assert.deepEqual(egyutt.hivasok, [
      { shop: "mindketto", clear: { kind: true, pickup: true } },
    ]);
    const csakAtvetel = figyelo(mind, { mindketto: "os-m" });
    await clearLeftoverKinds(csakAtvetel.service, {
      ...keres,
      kind: false,
      skip: () => false,
      pickup: { keep: () => false },
    });
    assert.deepEqual(csakAtvetel.hivasok, [
      { shop: "mindketto", clear: { kind: false, pickup: true } },
    ]);
  });

  it("a párosítatlan jelölt sort megszámolja és nem bántja; a közben megváltozott sor nem számít törlésnek", async () => {
    const parositatlan = figyelo([atvetel("arva", true)], {});
    const jelentes = await clearLeftoverKinds(parositatlan.service, {
      ...keres,
      skip: () => false,
      pickup: { keep: () => false },
    });
    assert.deepEqual(parositatlan.hivasok, []);
    assert.equal(jelentes.unpaired, 1);

    const valtozott = figyelo([atvetel("a", true)], { a: "os-a" }, "unchanged");
    const masodik = await clearLeftoverKinds(valtozott.service, {
      ...keres,
      skip: () => false,
      pickup: { keep: () => false },
    });
    assert.equal(masodik.entries[0]?.action, "unchanged");
    const szoveg = describeLeftoverKinds(masodik, true);
    assert.match(szoveg, /közben megváltozott, nem nyúltunk hozzá/);
    assert.match(szoveg, /0 törölve/);
  });
});
