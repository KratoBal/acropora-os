import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type {
  MedusaPriceRow,
  MedusaVariantPriceRow,
} from "./medusa-admin.client.js";
import {
  auditProducts,
  auditVariantPrices,
  formatAuditLine,
  parseAuditArguments,
  priceRowKind,
  type PriceAuditDeps,
} from "./medusa-price-audit.js";

/**
 * A KETTOS FORINT AR OLVASO MERESE (task t-20261116-ket-forint-ar). MI PIROSIT: egy arlistas, szabalyos vagy mennyisegi sor
 * egyszerunek szamit (akkor a javaslat a torlendo listara teszi); az ismeretlen alaku sor (a valasz nem hozta a jeleket) egyszeru;
 * egyenlo osszegnel nem a regebbi marad; elteroknel nem az OS arral egyezo marad; ha egyik sem egyezik, mégis javasol; a nem forint sor
 * a forint sorok koze szamit; az olvashatatlan termek csendben kiesik; a parancs irni is tud (az olvaso fuggosegben tobb metodus
 * van, vagy a forras irast hiv).
 */
const row = (
  id: string,
  amount: number,
  extra: Partial<MedusaPriceRow> = {},
): MedusaPriceRow => ({
  id,
  currency_code: "huf",
  amount,
  price_list_id: null,
  rules_count: 0,
  min_quantity: null,
  max_quantity: null,
  ...extra,
});

describe("priceRowKind", () => {
  it("egyszeru, ha a jelek ismertek es egyik sem all; nem egyszeru a harom jel barmelyikere; ismeretlen, ha egyik jel sincs a valaszban", () => {
    assert.equal(priceRowKind(row("p", 1)), "plain");
    assert.equal(
      priceRowKind(row("p", 1, { price_list_id: "pl_1" })),
      "non-plain",
    );
    assert.equal(priceRowKind(row("p", 1, { rules_count: 2 })), "non-plain");
    assert.equal(priceRowKind(row("p", 1, { min_quantity: 5 })), "non-plain");
    assert.equal(priceRowKind(row("p", 1, { max_quantity: 9 })), "non-plain");
    assert.equal(
      priceRowKind({ id: "p", currency_code: "huf", amount: 1 }),
      "unknown",
    );
  });
});

describe("auditVariantPrices", () => {
  it("nincs sor: none; egy sor: single (nincs javaslat)", () => {
    assert.equal(
      auditVariantPrices({ rows: [], osAmount: 100 }).verdict,
      "none",
    );
    const egy = auditVariantPrices({
      rows: [row("price_A", 100)],
      osAmount: 100,
    });
    assert.equal(egy.verdict, "single");
    assert.equal(egy.keepId, null);
    assert.deepEqual(egy.deleteIds, []);
  });

  it("egyenlo osszegu egyszeru sorok: a REGEBBI azonositoju marad (az ULID szoveges sorrendje), a tobbi torlendo", () => {
    const eredmeny = auditVariantPrices({
      rows: [row("price_01M1YGHW2N", 9700), row("price_01M1YGHW2H", 9700)],
      osAmount: 9700,
    });
    assert.equal(eredmeny.verdict, "duplicates-equal");
    assert.equal(eredmeny.keepId, "price_01M1YGHW2H");
    assert.deepEqual(eredmeny.deleteIds, ["price_01M1YGHW2N"]);
  });

  it("elteroek: az marad, amelyik az OS arral egyezik, a masik torlendo (a sorrend nem szamit)", () => {
    const eredmeny = auditVariantPrices({
      rows: [row("price_B", 9000), row("price_A", 9700)],
      osAmount: 9000,
    });
    assert.equal(eredmeny.verdict, "duplicates-pick-os");
    assert.equal(eredmeny.keepId, "price_B");
    assert.deepEqual(eredmeny.deleteIds, ["price_A"]);
    assert.deepEqual(
      eredmeny.hufRows.map((r) => [r.id, r.matchesOs]),
      [
        ["price_B", true],
        ["price_A", false],
      ],
    );
  });

  it("tobb egyezo kozul a regebbi marad, a nem egyezo is torlendo", () => {
    const eredmeny = auditVariantPrices({
      rows: [row("price_C", 100), row("price_A", 100), row("price_B", 90)],
      osAmount: 100,
    });
    // az osszegek nem mind egyenlok, ket sor egyezik az OS arral
    assert.equal(eredmeny.verdict, "duplicates-pick-os");
    assert.equal(eredmeny.keepId, "price_A");
    assert.deepEqual(eredmeny.deleteIds.sort(), ["price_B", "price_C"]);
  });

  it("egyik sem egyezik az OS arral, vagy az OS ar nem ismert: NEM javasol semmit", () => {
    const nemEgyezik = auditVariantPrices({
      rows: [row("price_A", 100), row("price_B", 200)],
      osAmount: 300,
    });
    assert.equal(nemEgyezik.verdict, "duplicates-no-os-match");
    assert.equal(nemEgyezik.keepId, null);
    assert.deepEqual(nemEgyezik.deleteIds, []);

    const ismeretlen = auditVariantPrices({
      rows: [row("price_A", 100), row("price_B", 200)],
      osAmount: null,
    });
    assert.equal(ismeretlen.verdict, "duplicates-no-os-match");
    assert.equal(ismeretlen.keepId, null);
  });

  it("nem egyszeru vagy ismeretlen alaku sor mellett NEM javasol (barmilyen osszeg mellett sem)", () => {
    const nemEgyszeru = auditVariantPrices({
      rows: [row("price_A", 100), row("price_B", 100, { min_quantity: 5 })],
      osAmount: 100,
    });
    assert.equal(nemEgyszeru.verdict, "non-plain-row");
    assert.equal(nemEgyszeru.keepId, null);
    assert.deepEqual(nemEgyszeru.deleteIds, []);

    const ismeretlen = auditVariantPrices({
      rows: [
        row("price_A", 100),
        { id: "price_B", currency_code: "huf", amount: 100 },
      ],
      osAmount: 100,
    });
    assert.equal(ismeretlen.verdict, "unknown-row-shape");
    assert.equal(ismeretlen.keepId, null);
  });

  /*
    AZ AKCIÓS ÁRLISTA SORA (kártya 54bb3779). MI PIROSÍT: az árlistás sor második forint sornak számít (az alapár mellett
    nem `single`), vagy a javítás törlendő listájára kerül, vagy a jelentés nem mondja meg, hogy volt ilyen sor.
  */
  it("az árlistás sor nem forint sor a vizsgálatban: az alapár mellett single, két egyenlő alapárnál a törlendő listán nincs rajta, és a számában látszik", () => {
    const egy = auditVariantPrices({
      rows: [
        row("price_A", 100),
        row("price_S", 80, { price_list_id: "pl_1" }),
      ],
      osAmount: 100,
    });
    assert.equal(egy.verdict, "single");
    assert.equal(egy.hufRows.length, 1);
    assert.equal(egy.priceListRows, 1);
    assert.equal(egy.foreignRows, 0);

    const ketto = auditVariantPrices({
      rows: [
        row("price_B", 100),
        row("price_A", 100),
        row("price_S", 80, { price_list_id: "pl_1" }),
      ],
      osAmount: 100,
    });
    assert.equal(ketto.verdict, "duplicates-equal");
    assert.deepEqual(ketto.deleteIds, ["price_B"]);
    assert.ok(!ketto.deleteIds.includes("price_S"));
    assert.match(
      formatAuditLine("cms_1", "variant_1", "SKU-1", ketto),
      / huf=2 lists=1 rows=\[/,
    );
  });

  it("a nem forint sor nem szamit a forint sorok koze (csak a szamaban latszik): egy forint + egy euro sor = single", () => {
    const eredmeny = auditVariantPrices({
      rows: [row("price_A", 100), row("price_E", 5, { currency_code: "eur" })],
      osAmount: 100,
    });
    assert.equal(eredmeny.verdict, "single");
    assert.equal(eredmeny.hufRows.length, 1);
    assert.equal(eredmeny.foreignRows, 1);
  });
});

describe("formatAuditLine", () => {
  it("egy sor: termek, valtozat, cikkszam, a sorok (azonosito:osszeg:fajta), az OS ar, az itelet, a javaslat", () => {
    const eredmeny = auditVariantPrices({
      rows: [row("price_B", 9700), row("price_A", 9700)],
      osAmount: 9700,
    });
    assert.equal(
      formatAuditLine("cms_1", "variant_1", "SKU-1", eredmeny),
      "cms_1 variant_1 sku=SKU-1 huf=2 rows=[price_B:9700:plain,price_A:9700:plain] os=9700 verdict=duplicates-equal keep=price_A delete=price_B",
    );
    const egy = auditVariantPrices({
      rows: [row("price_A", 5)],
      osAmount: null,
    });
    assert.equal(
      formatAuditLine("cms_2", "variant_2", "S2", egy),
      "cms_2 variant_2 sku=S2 huf=1 rows=[price_A:5:plain] os=- verdict=single keep=- delete=-",
    );
  });
});

describe("parseAuditArguments", () => {
  it("elutasitja az --forget-link-et es a sku: alakot, elfogadja a --all-t, a tobbit tovabbadja", () => {
    assert.equal(parseAuditArguments(["p1", "--forget-link"]).kind, "error");
    assert.equal(parseAuditArguments(["sku:ABC"]).kind, "error");
    const ok = parseAuditArguments(["p1", "p2", "--all"]);
    assert.deepEqual(ok, { kind: "ok", all: true, batchArgs: ["p1", "p2"] });
    assert.deepEqual(parseAuditArguments(["--limit", "5"]), {
      kind: "ok",
      all: false,
      batchArgs: ["--limit", "5"],
    });
  });
});

describe("auditProducts", () => {
  const valtozat = (
    id: string,
    sku: string,
    prices?: MedusaPriceRow[],
  ): MedusaVariantPriceRow =>
    ({ id, sku, deleted_at: null, ...(prices ? { prices } : {}) }) as never;

  const kesz = (
    termekek: Record<
      string,
      {
        targets?: { sku: string; osAmount: number | null }[];
        errors?: string[];
        medusa?: string | null;
        rows?: MedusaVariantPriceRow[];
        truncated?: boolean;
        throws?: boolean;
      }
    >,
  ) => {
    const hivasok: string[] = [];
    const deps: PriceAuditDeps = {
      resolve: async (id) => ({
        targets: (termekek[id]?.targets ?? []).map((t) => ({
          osProductId: id,
          ...t,
        })),
        errors: termekek[id]?.errors ?? [],
      }),
      findMedusaProductId: async (id) =>
        termekek[id]?.medusa === undefined ? `m_${id}` : termekek[id]!.medusa!,
      reader: {
        listVariantPrices: async (medusaId) => {
          hivasok.push(medusaId);
          const t = termekek[medusaId.slice(2)]!;
          if (t.throws) throw new TypeError("titkos");
          return { rows: t.rows ?? [], truncated: t.truncated ?? false };
        },
      },
      matchVariant: (rows, sku) => {
        const v = rows.find((r) => r.sku === sku);
        return v
          ? { variant: v }
          : { error: `nincs ${sku} cikkszámú változat.` };
      },
    };
    const sorok: string[] = [];
    return {
      deps,
      hivasok,
      sorok,
      out: { stdout: (v: string) => sorok.push(v), stderr: () => undefined },
    };
  };

  it("alapbol csak a javitando valtozatok sora jelenik meg, --all-lal mind; az osszesites mindig", async () => {
    const t = {
      p1: {
        targets: [{ sku: "A", osAmount: 100 }],
        rows: [valtozat("v1", "A", [row("price_1", 100), row("price_2", 100)])],
      },
      p2: {
        targets: [{ sku: "B", osAmount: 50 }],
        rows: [valtozat("v2", "B", [row("price_3", 50)])],
      },
    };
    const alap = kesz(t);
    const osszes = await auditProducts(["p1", "p2"], alap.deps, alap.out);
    assert.equal(alap.sorok.filter((s) => !s.startsWith("#")).length, 1);
    assert.match(
      alap.sorok[0]!,
      /^p1 v1 sku=A huf=2 .* verdict=duplicates-equal keep=price_1 delete=price_2\n$/,
    );
    assert.deepEqual(osszes, {
      variants: 2,
      byVerdict: { "duplicates-equal": 1, single: 1 },
      unreadable: 0,
    });
    assert.match(
      alap.sorok.at(-1)!,
      /^# összesítés: 2 változat, olvashatatlan 0, duplicates-equal 1, single 1\n$/,
    );

    const mind = kesz(t);
    await auditProducts(["p1", "p2"], mind.deps, mind.out, { all: true });
    assert.equal(mind.sorok.filter((s) => !s.startsWith("#")).length, 2);
  });

  it("az olvashatatlan termek nem esik ki csendben: # sor es szamlalo (nincs kotes, olvasasi hiba, csonkolt lista, nincs valtozat, hianyzo arak, felold-hiba)", async () => {
    const k = kesz({
      nincsKotes: { targets: [{ sku: "A", osAmount: 1 }], medusa: null },
      hiba: { targets: [{ sku: "A", osAmount: 1 }], throws: true },
      csonka: { targets: [{ sku: "A", osAmount: 1 }], truncated: true },
      nincsValtozat: { targets: [{ sku: "ZZ", osAmount: 1 }], rows: [] },
      nincsAr: {
        targets: [{ sku: "A", osAmount: 1 }],
        rows: [valtozat("v", "A")],
      },
      felold: { errors: ["a változat ára nem küldhető"] },
    });
    const osszes = await auditProducts(
      ["nincsKotes", "hiba", "csonka", "nincsValtozat", "nincsAr", "felold"],
      k.deps,
      k.out,
    );

    assert.equal(osszes.unreadable, 6);
    assert.equal(osszes.variants, 0);
    assert.equal(k.sorok.filter((s) => s.startsWith("# ")).length, 7);
    // a hibauzenet szovege nem kerul a kimenetre (csak a hiba tipusa)
    assert.ok(!k.sorok.join("").includes("titkos"));
  });

  it("az olvaso fuggoseg KIZAROLAG az ar-sorok olvasasat hivja, termekenkent egyszer", async () => {
    const k = kesz({
      p1: {
        targets: [
          { sku: "A", osAmount: 1 },
          { sku: "B", osAmount: 1 },
        ],
        rows: [
          valtozat("v1", "A", [row("price_1", 1)]),
          valtozat("v2", "B", [row("price_2", 1)]),
        ],
      },
    });
    await auditProducts(["p1"], k.deps, k.out);

    assert.deepEqual(k.hivasok, ["m_p1"]);
    assert.deepEqual(Object.keys(k.deps.reader), ["listVariantPrices"]);
  });
});

describe("a parancs forrasa nem ir", () => {
  it("a ket uj fajlban nincs iro hivas (a Medusa kliensen sem, az adatbazison sem)", () => {
    const tiltott = [
      "setVariantPrices",
      "createProduct",
      "updateProduct",
      "deleteProduct",
      "\\.create\\(",
      "\\.update\\(",
      "\\.upsert\\(",
      "\\.delete\\(",
      "\\.deleteMany\\(",
      "\\$executeRaw",
      "externalReference",
    ];
    for (const [fajl, nev] of [
      ["src/integrations/medusa/medusa-price-audit.ts", "auditProducts"],
      ["src/integrations/medusa/medusa-price-audit.cli.ts", "runPriceAuditCli"],
    ] as const) {
      const eredeti = readFileSync(fajl, "utf8");
      // KONTROLL A KERESESRE: egy rossz utvonal vagy ures olvasas nulla talalattal zold lenne
      assert.ok(eredeti.includes(nev), `${fajl}: nem a vart fajlt olvastam`);
      const szoveg = eredeti
        // a megjegyzesek elmondhatjak, hogy a parancs nem ir: csak a kodot nezzuk
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const minta of tiltott)
        assert.ok(
          !new RegExp(minta).test(szoveg),
          `${fajl}: tiltott minta: ${minta}`,
        );
    }
  });
});
