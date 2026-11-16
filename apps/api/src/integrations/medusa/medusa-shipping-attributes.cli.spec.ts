import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runShippingAttributesCli,
  type ShippingAttributesCliDatabase,
} from "./medusa-shipping-attributes.cli.js";
import type { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";

const PROFIL = {
  productId: "prod-os-1",
  pickupOnly: true,
  foxpostForbidden: false,
  isHeavy: true,
  isFrozen: false,
};

type ShopRow = {
  id: string | null;
  product_id: string;
  pickup_only: boolean;
  foxpost_forbidden: boolean;
  is_heavy: boolean;
  is_frozen: boolean;
  locker_unsuitable: boolean;
  livestock_kind: "FISH" | "INVERTEBRATE" | "CORAL" | null;
};

const boltSor = (
  product_id: string,
  livestock_kind: ShopRow["livestock_kind"],
): ShopRow => ({
  id: `sa_${product_id}`,
  product_id,
  pickup_only: true,
  foxpost_forbidden: false,
  is_heavy: false,
  is_frozen: false,
  locker_unsuitable: false,
  livestock_kind,
});

const FA = [
  { id: "gy1", name: "Korallok", parentId: null },
  { id: "gy1a", name: "SPS", parentId: "gy1" },
  { id: "gy2", name: "Halak", parentId: null },
  { id: "mu1", name: "Technika", parentId: null },
];

function fakes(
  sorok = [PROFIL],
  besorolasok: { productId: string; categoryId: string }[] = [],
  unas: { productId: string; rawPayload: unknown }[] = [],
  valtozatok: { sku: string; productId: string }[] = [],
  bolt: { id: string; variants: { sku: string | null }[] }[] = [],
  /** a bolt szallitasi-jellemzo sorai (a boltban maradt fajta keresesehez) */
  boltSorok: ShopRow[] = [],
  /** bolti termek -> OS-termek a kotes-sor szerint */
  kotesek: Record<string, string> = {},
) {
  const torlesek: { shop: string; apply: boolean }[] = [];
  const ki: string[] = [];
  const hivasok: {
    id: string;
    apply: boolean;
    derived: boolean;
    bySku?: string | null;
    kind?: string;
  }[] = [];
  const lekerdezes: unknown[] = [];

  const out = {
    stdout: (v: string) => ki.push(v),
    stderr: (v: string) => ki.push("ERR:" + v),
  };
  const database = {
    category: { findMany: async () => FA },
    productCategory: { findMany: async () => besorolasok },
    unasProductSnapshot: { findMany: async () => unas },
    productVariant: { findMany: async () => valtozatok },
    productShippingProfile: {
      findMany: async (args: unknown) => {
        lekerdezes.push(args);
        return sorok;
      },
    },
  } as unknown as ShippingAttributesCliDatabase;

  const service = {
    listShopSkus: async (offset: number, limit: number) => ({
      products: bolt.slice(offset, offset + limit),
      count: bolt.length,
    }),
    listShopShippingAttributes: async () => boltSorok,
    osProductOfShop: async (shop: string) => kotesek[shop] ?? null,
    clearLeftoverKind: async (row: { product_id: string }, apply: boolean) => {
      torlesek.push({ shop: row.product_id, apply });
      return {
        action: apply ? ("applied" as const) : ("planned" as const),
        medusaProductId: row.product_id,
        flags: "élő állat: hal -> a fajta törlése",
      };
    },
    project: async (
      id: string,
      _profil: unknown,
      apply: boolean,
      derived = false,
      bySku: string | null = null,
      kind: string | null = null,
    ) => {
      hivasok.push({
        id,
        apply,
        derived,
        ...(bySku ? { bySku } : {}),
        ...(kind ? { kind } : {}),
      });
      return apply
        ? ({
            action: "applied",
            medusaProductId: "prod_medusa_1",
            flags: "csak bolti átvétel",
          } as const)
        : ({
            action: "planned",
            medusaProductId: "prod_medusa_1",
            flags: "csak bolti átvétel",
          } as const);
    },
  } as unknown as MedusaShippingAttributesService;

  return {
    out,
    database,
    service,
    torlesek,
    hivasok,
    lekerdezes,
    szoveg: () => ki.join(""),
  };
}

/**
 * A PROBA-ALAK KAPUJA. Ugyanaz a mérce, mint a marka-visszatoltesnel: a
 * bizonyitek NEM a kimenet szovege (egy parancs, ami kiirja, hogy "terv", es
 * kozben ir, ugyanezt a sort adna), hanem az, hogy az iras-kapcsolo HAMISKENT
 * ment at a szolgaltatasnak.
 */
describe("a szállítási jellemzők parancsa", () => {
  it("--apply nélkül tervet ír, és a szolgáltatás NEM ír", async () => {
    const f = fakes();

    const kod = await runShippingAttributesCli(
      [],
      f.out,
      undefined,
      f.database,
      f.service,
    );

    assert.equal(kod, 0);
    assert.deepEqual(f.hivasok, [
      { id: "prod-os-1", apply: false, derived: false },
    ]);
    assert.match(f.szoveg(), /KIKÜLDENÉNK/);
    assert.match(f.szoveg(), /Ez a futás semmit nem írt/);
  });

  it("--apply mellett az írás-kapcsoló igazként megy tovább", async () => {
    const f = fakes();

    await runShippingAttributesCli(
      ["--apply"],
      f.out,
      undefined,
      f.database,
      f.service,
    );

    assert.deepEqual(f.hivasok, [
      { id: "prod-os-1", apply: true, derived: false },
    ]);
    assert.match(f.szoveg(), /most állítottuk be/);
    assert.doesNotMatch(f.szoveg(), /semmit nem írt/);
  });

  /**
   * A HALMAZT AZ ADAT HATAROZZA MEG, NEM A HIVO: azok a termekek, amelyeknek
   * VAN profil-soruk. Egy azonosito-lista ugyanezert lenne rossz alapertelmezes
   * -- a hivonak kellene tudnia, kit vizsgaltak meg, es az a tudas az
   * adatbazisban all.
   */
  it("azonosító nélkül MINDEN profillal rendelkező termék a halmaz", async () => {
    const f = fakes();

    await runShippingAttributesCli([], f.out, undefined, f.database, f.service);

    assert.deepEqual(
      (f.lekerdezes[0] as { where: unknown }).where,
      {},
      "szűrés nélkül kell kérdezni, ha nincs megadva azonosító",
    );
  });

  it("megadott azonosítókra szűkít", async () => {
    const f = fakes();

    await runShippingAttributesCli(
      ["prod-os-1", "prod-os-2"],
      f.out,
      undefined,
      f.database,
      f.service,
    );

    assert.deepEqual((f.lekerdezes[0] as { where: unknown }).where, {
      productId: { in: ["prod-os-1", "prod-os-2"] },
    });
  });

  /**
   * A NULLA NEM HIBA, DE NEM IS NEMA. Egy ures kimenet ugyanugy nezne ki, mint
   * egy elhasalt lekerdezes -- ezert a parancs kimondja, MIT kerdezett.
   */
  /**
   * AZ ELO ALLAT AG AKKOR IS CEL, HA NINCS PROFIL-SORA -- es ez ma az EGYETLEN
   * forras, ami adatot ad: nulla profil-sor all az adatbazisban (acrobot merese,
   * 2026-09-07), mikozben 206 elo allat termek van.
   */
  it("az élő állat ág alatti termék profil nélkül is cél", async () => {
    const f = fakes([], [{ productId: "prod-elo-1", categoryId: "gy1a" }]);

    await runShippingAttributesCli([], f.out, undefined, f.database, f.service);

    assert.deepEqual(f.hivasok, [
      { id: "prod-elo-1", apply: false, derived: true, kind: "CORAL" },
    ]);
    assert.match(f.szoveg(), /1 élő állat besorolás alapján/);
  });

  /**
   * V2.6: A FAJTA TERMEKENKENT SZAMOLODIK. MI PIROSIT: ha a fajta az elso
   * termekrol a tobbire is atragad; ha a ket gyoker alatt allo termek fajtat kap.
   */
  it("a fajta termékenként számolódik, két gyökér alatt álló termék fajtája null", async () => {
    const f = fakes(
      [],
      [
        { productId: "prod-koral", categoryId: "gy1a" },
        { productId: "prod-hal", categoryId: "gy2" },
        { productId: "prod-ketto", categoryId: "gy1" },
        { productId: "prod-ketto", categoryId: "gy2" },
      ],
    );

    await runShippingAttributesCli([], f.out, undefined, f.database, f.service);

    assert.deepEqual(
      f.hivasok.map((h) => [h.id, h.kind ?? null]),
      [
        ["prod-hal", "FISH"],
        ["prod-ketto", null],
        ["prod-koral", "CORAL"],
      ],
    );
  });

  it("profil nélkül megmondja, hogy nincs mit átvinni", async () => {
    const f = fakes([]);

    const kod = await runShippingAttributesCli(
      ["--apply"],
      f.out,
      undefined,
      f.database,
      f.service,
    );

    assert.equal(kod, 0);
    assert.deepEqual(f.hivasok, []);
    assert.match(f.szoveg(), /nincs mit átvinni/);
  });

  /*
  A UNAS FELULIRASA HARMADIK FORRAS (kartya 2a7f2313). MI PIROSIT: ha a UNAS
  szerinti termek nem kerul a celok koze; ha felulirja a KEZZEL kitoltott
  profilt; ha egy felulirás nelkuli UNAS-termek is cel lesz.
*/
  /*
    A JELZOK FORRASA AZ OS-SOR (a82ed229, az eles feltolto utan, 2026-11-05). MI PIROSIT: ha egy sor nelkuli
    UNAS-termek a nyers adatabol megis cella valik; ha a sor nelkuli UNAS-termek csendben kimarad (a FIGYELEM
    sor nelkul); ha a UNAS a kezi sort felulirja.
  */
  describe("a UNAS-adat nem forrás, csak jelzés", () => {
    const csakFoxpost = {
      ShippingMethods: {
        Denied: {
          Method: [
            { Name: "GLS házhozszállítás" },
            { Name: "Átvétel a GLS csomagponton" },
          ],
        },
      },
    };

    it("a sor nélküli UNAS-termék nem cél, de a kimenet megszámolja", async () => {
      const f = fakes(
        [],
        [],
        [
          { productId: "unas-1", rawPayload: csakFoxpost },
          { productId: "unas-2", rawPayload: {} },
        ],
      );
      await runShippingAttributesCli(
        [],
        f.out,
        undefined,
        f.database,
        f.service,
      );
      assert.deepEqual(f.hivasok, []);
      assert.match(
        f.szoveg(),
        /FIGYELEM: 2 UNAS-terméknek nincs szállítási-jellemző sora/,
      );
    });

    it("a sorral bíró UNAS-termék nem számít a figyelmeztetésbe", async () => {
      const f = fakes(
        [PROFIL],
        [],
        [{ productId: PROFIL.productId, rawPayload: csakFoxpost }],
      );
      await runShippingAttributesCli(
        [],
        f.out,
        undefined,
        f.database,
        f.service,
      );
      assert.doesNotMatch(f.szoveg(), /FIGYELEM/);
    });

    it("a kézzel kitöltött profil erősebb a UNAS-nál", async () => {
      const latott: unknown[] = [];
      const f = fakes(
        [PROFIL],
        [],
        [{ productId: PROFIL.productId, rawPayload: csakFoxpost }],
      );
      const service = {
        listShopSkus: async () => ({ products: [], count: 0 }),
        listShopShippingAttributes: async () => [],
        osProductOfShop: async () => null,
        project: async (_id: string, profil: unknown) => {
          latott.push(profil);
          return {
            action: "planned",
            medusaProductId: "m",
            flags: "x",
          } as const;
        },
      } as unknown as MedusaShippingAttributesService;
      await runShippingAttributesCli([], f.out, undefined, f.database, service);
      assert.deepEqual(latott, [PROFIL]);
    });
  });

  /*
  A SKU-PAROSITAS (kartya 2a7f2313, mert 2026-10-06: a teszt bolt 1492
  termekebol 1491 egyertelmu, kotes-sor egyiknek sincs). MI PIROSIT: ha a
  ketertelmu (ket OS termek) vagy a ket-bolti-egy-OS part is parositja; ha a
  UNAS cikkszamot nem nezi; ha a talalt bolti azonosito nem jut el a
  vetitesig.
*/
  describe("a SKU-párosítás", () => {
    const csakFoxpost = {
      Sku: "FOX-1",
      ShippingMethods: {
        Denied: {
          Method: [
            { Name: "GLS házhozszállítás" },
            { Name: "Átvétel a GLS csomagponton" },
          ],
        },
      },
    };

    it("csak az egyértelmű párt adja át, a kétértelműt és a párnélkülit megszámolja", async () => {
      // os-1 is a target through its OS row; its UNAS mirror still gives the article number for the pairing
      const f = fakes(
        [{ ...PROFIL, productId: "os-1" }],
        [],
        [{ productId: "os-1", rawPayload: csakFoxpost }],
        [
          { sku: "AMB-1", productId: "os-2" },
          { sku: "AMB-1X", productId: "os-3" },
          { sku: "KET", productId: "os-4" },
        ],
        [
          { id: "shop-1", variants: [{ sku: "fox-1" }] },
          { id: "shop-amb", variants: [{ sku: "AMB-1" }, { sku: "AMB-1X" }] },
          { id: "shop-k1", variants: [{ sku: "KET" }] },
          { id: "shop-k2", variants: [{ sku: "KET" }] },
          { id: "shop-none", variants: [{ sku: "SEHOL" }] },
        ],
      );
      await runShippingAttributesCli(
        [],
        f.out,
        undefined,
        f.database,
        f.service,
      );
      assert.match(
        f.szoveg(),
        /SKU-párosítás: 1 egyértelmű, 3 kétértelmű, 1 pár nélkül \(a bolt 5 termékéből\)/,
      );
      assert.deepEqual(
        f.hivasok.map((h) => [h.id, h.bySku]),
        [["os-1", "shop-1"]],
      );
    });
  });

  /*
  A BOLTBAN MARADT ELO ALLAT FAJTA (kartya 4b30b373). MI PIROSIT: egy bolti sor, amin fajta all, es amelynek OS-termeke
  mar nem celpont, de a fajtaja marad; egy celpont termek (a fo kor mar kezelte) amit ujra torolne; egy nem parosithato
  bolti sor, amihez nyulna; egy fajta nelkuli sor, amit torolne; az --apply nelkul irna; az explicit azonositokra szukitest
  figyelmen kivul hagyna.
  */
  describe("a boltban maradt fajta", () => {
    const sorok = [
      boltSor("shop-stale", "FISH"), // OS-termeke nem celpont: torlendo
      boltSor("shop-target", "CORAL"), // OS-termeke celpont (profil-sora van): a fo kor kezeli
      boltSor("shop-orphan", "FISH"), // nincs OS-termek
      boltSor("shop-nokind", null), // nincs fajta
    ];
    const kotesek = {
      "shop-stale": "os-stale",
      "shop-target": "prod-os-1",
      "shop-nokind": "os-nokind",
    };

    it("a nem celpont termek fajtajat torli, a tobbihez nem nyul, es megszamolja, mit latott", async () => {
      const f = fakes([PROFIL], [], [], [], [], sorok, kotesek);
      await runShippingAttributesCli(
        [],
        f.out,
        undefined,
        f.database,
        f.service,
      );
      assert.deepEqual(f.torlesek, [{ shop: "shop-stale", apply: false }]);
      assert.match(f.szoveg(), /os-stale: KIKÜLDENÉNK -> shop-stale/);
      assert.match(
        f.szoveg(),
        /a bolt 4 szállítási-jellemző sort adott, 3-n áll fajta, 1 törlendő, 1 OS-termék nélkül/,
      );
    });

    it("--apply nelkul nem ir (apply=false), --apply-jal igen", async () => {
      const probaF = fakes([PROFIL], [], [], [], [], sorok, kotesek);
      await runShippingAttributesCli(
        [],
        probaF.out,
        undefined,
        probaF.database,
        probaF.service,
      );
      assert.equal(probaF.torlesek[0]?.apply, false);
      const igaziF = fakes([PROFIL], [], [], [], [], sorok, kotesek);
      await runShippingAttributesCli(
        ["--apply"],
        igaziF.out,
        undefined,
        igaziF.database,
        igaziF.service,
      );
      assert.deepEqual(igaziF.torlesek, [{ shop: "shop-stale", apply: true }]);
      assert.match(
        igaziF.szoveg(),
        /os-stale: most állítottuk be -> shop-stale/,
      );
      assert.match(igaziF.szoveg(), /1 törölve/);
    });

    it("explicit azonositoknal csak a megadott OS-termekre szukit", async () => {
      const f = fakes([PROFIL], [], [], [], [], sorok, {
        ...kotesek,
        "shop-other": "os-other",
      });
      await runShippingAttributesCli(
        ["os-other"],
        f.out,
        undefined,
        f.database,
        f.service,
      );
      assert.deepEqual(f.torlesek, []);
    });

    it("a SKU-parositas is megtalalja az OS-termeket, ha nincs kotes-sor", async () => {
      const f = fakes(
        [PROFIL],
        [],
        [],
        [{ sku: "STALE-1", productId: "os-stale-sku" }],
        [{ id: "shop-sku", variants: [{ sku: "STALE-1" }] }],
        [boltSor("shop-sku", "INVERTEBRATE")],
        {},
      );
      await runShippingAttributesCli(
        [],
        f.out,
        undefined,
        f.database,
        f.service,
      );
      assert.deepEqual(f.torlesek, [{ shop: "shop-sku", apply: false }]);
    });

    it("fajta nelkuli boltban nem torol semmit, es ezt ki is mondja", async () => {
      const f = fakes([PROFIL], [], [], [], [], [boltSor("shop-a", null)], {
        "shop-a": "os-a",
      });
      await runShippingAttributesCli(
        [],
        f.out,
        undefined,
        f.database,
        f.service,
      );
      assert.deepEqual(f.torlesek, []);
      assert.match(
        f.szoveg(),
        /1 szállítási-jellemző sort adott, 0-n áll fajta, 0 törlendő/,
      );
    });
  });
});
