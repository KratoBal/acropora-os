import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Prisma } from "@acropora/database";

import {
  arKepAlakja,
  kellUjArSor,
  kezdoSorIdopontja,
  type ArKep,
} from "./unas-ar-tortenet.js";

const KEP = (reszlet: Partial<ArKep> = {}): ArKep => ({
  currency: "HUF",
  netPrice: "1000",
  grossPrice: "1270",
  saleNetPrice: null,
  saleGrossPrice: null,
  ...reszlet,
});

describe("mikor keletkezik uj ar-tortenet sor", () => {
  it("ha meg egy sor sincs, MINDIG kell -- ez a kezdo sor", () => {
    assert.equal(kellUjArSor(null, KEP()), true);
  });

  it("valtozatlan ar-kepnel NEM kell uj sor", () => {
    assert.equal(kellUjArSor(KEP(), KEP()), false);
  });

  /**
   * A LENYEG. A `Decimal` objektumkent jon az adatbazisbol, es a `===` rajta
   * MINDIG hamis. Egy ilyen osszehasonlitas nem hibazna, csak MINDEN
   * szinkronon uj sort irna -- a tortenet a szinkron gyakorisagat rogzitene,
   * nem az ar valtozasat.
   */
  it("ket kulonbozo peldany UGYANAZZAL az ertekkel nem valtozas", () => {
    const elozo = KEP({ netPrice: { toString: () => "1000" } });
    const mostani = KEP({ netPrice: { toString: () => "1000" } });

    assert.notEqual(elozo.netPrice, mostani.netPrice);
    assert.equal(kellUjArSor(elozo, mostani), false);
  });

  it("barmelyik ar-mezo valtozasa uj sort keletkeztet", () => {
    for (const mezo of [
      "netPrice",
      "grossPrice",
      "saleNetPrice",
      "saleGrossPrice",
    ] as const) {
      assert.equal(
        kellUjArSor(KEP(), KEP({ [mezo]: "9999" })),
        true,
        `a ${mezo} valtozasa nem keletkeztetett sort`,
      );
    }
  });

  it("a penznem valtozasa is uj sor", () => {
    assert.equal(kellUjArSor(KEP(), KEP({ currency: "EUR" })), true);
  });

  /**
   * A HIANYZO AR NEM NULLA FORINT. A ketto kulonbozo allitas: az egyik azt
   * mondja, hogy a forras nem adott erteket, a masik azt, hogy ingyen van.
   */
  it("az ertek megjelenese es eltunese is valtozas", () => {
    assert.equal(
      kellUjArSor(
        KEP({ saleGrossPrice: null }),
        KEP({ saleGrossPrice: "990" }),
      ),
      true,
    );
    assert.equal(
      kellUjArSor(
        KEP({ saleGrossPrice: "990" }),
        KEP({ saleGrossPrice: null }),
      ),
      true,
    );
  });

  it("a nulla ES a hianyzo ertek NEM ugyanaz", () => {
    assert.notEqual(
      arKepAlakja(KEP({ saleGrossPrice: null })),
      arKepAlakja(KEP({ saleGrossPrice: "0" })),
    );
  });

  /**
   * ISMERT POZITIV KONTROLL AZ ALAKRA: ket kulonbozo ar-kep alakja is
   * kulonbozik. Enelkul egy mindig ugyanazt ado `arKepAlakja` minden fenti
   * "nem kell uj sor" allitast kielegitene.
   */
  it("kulonbozo ar-kepek alakja is kulonbozik", () => {
    assert.notEqual(arKepAlakja(KEP()), arKepAlakja(KEP({ grossPrice: "1" })));
  });
});

/**
 * A BEKOTES ES A KET FELTETEL, AMI A KARTYAN ALL.
 *
 * Forras-olvaso allitasok: a szinkron torzse ebben a repoban nem fut le
 * tesztben (ugyanaz az idioma, mint a vetitesnel).
 */
describe("az ar-tortenet bekotese", () => {
  const SYNC = "src/imports/unas/unas-product-sync.repository.ts";
  const CLI = "src/imports/unas/unas-kezdo-ar-sorok.cli.ts";

  /**
   * A SORREND A LENYEG: a tortenet-sor a tukor FELULIRASA ELE kerul. Ha moge
   * kerulne, az az ar irodna le, amit epp most cserelunk le -- egy nappal
   * elcsuszott tortenet, ami sosem hibazik.
   */
  it("a tortenet-sor a snapshot upsert ELE kerul", async () => {
    const forras = await readFile(SYNC, "utf-8");

    const tortenet = forras.indexOf("transaction.productPriceHistory.create");
    const tukor = forras.indexOf("transaction.unasProductSnapshot.upsert");

    assert.equal(tortenet > 0, true);
    assert.equal(tukor > 0, true);
    assert.equal(tortenet < tukor, true);
  });

  it("a szinkron a valtozas-szabalyt hasznalja, nem sajat osszehasonlitast", async () => {
    const forras = await readFile(SYNC, "utf-8");

    assert.equal(forras.includes("kellUjArSor(utolsoArSor, arKep)"), true);
    assert.equal(
      forras.includes('source: utolsoArSor ? "UNAS_SYNC" : "INITIAL"'),
      true,
    );
  });

  /**
   * A MASODIK FELTETEL A KARTYAROL: INDULASKOR MINDEN termeknek kell kezdo sor,
   * nem csak azoknak, amik atmennek a szinkronon. Ezt kulon parancs adja, es a
   * lekerdezese a "meg egy sora sincs" halmazra szol.
   */
  it("a kezdo sorokat kulon parancs adja, a sor nelkuli termekekre", async () => {
    const forras = await readFile(CLI, "utf-8");

    assert.equal(forras.includes("priceHistory: { none: {} }"), true);
    assert.equal(forras.includes('source: "INITIAL"'), true);
    /* A tukor ideje, ha van -- nem egysegesen "most". */
    assert.equal(forras.includes("kezdoSorIdopontja(tukor, most)"), true);
  });

  /**
   * A HAROM SZAM, ES MIERT NEM KETTO.
   *
   * "N kezdo sor keletkezett" onmagaban nem mondja meg, hasznalhato-e a
   * tortenet elso pontja. Egy URES aru sor azt allitja, hogy AKKOR nem
   * ismertunk arat -- nem azt, hogy ingyen volt. Ha az a szam nagy, az elso
   * pont hianyjelzes, nem kiindulas, es ezt a felvetelkor kell tudni.
   *
   * A `tukorNelkul` KULON all, es szandekosan: egy termeknek lehet UNAS-tukre
   * ar NELKUL is. Egy kozos szam a ket esetet osszemosna, es mas a teendo --
   * ott nem az ar hianyzik, hanem a tukor.
   */
  it("a kezdo-sor parancs HAROM szamot ir ki, kulon szamlalokkal", async () => {
    const forras = await readFile(CLI, "utf-8");

    assert.equal(forras.includes("let uresArral = 0;"), true);
    assert.equal(forras.includes("let tukorNelkul = 0;"), true);
    assert.equal(forras.includes("if (nincsAr) uresArral += 1;"), true);

    /* Az uresseg a NEGY ar-mezore szol, nem a tukor meglétére. */
    for (const mezo of [
      "netPrice",
      "grossPrice",
      "saleNetPrice",
      "saleGrossPrice",
    ]) {
      assert.equal(
        forras.includes(`tukor?.${mezo} == null`),
        true,
        `az uresseg-vizsgalat nem nezi a ${mezo} mezot`,
      );
    }
  });

  /**
   * AZ URES-ARU SOR MERLEGE FELTETEL NELKUL IROdik KI. Ha `if` moge kerulne, a
   * NULLA eset nema lenne -- es epp a nulla az, ami megnyugtat.
   */
  it("az ures-aru szam akkor is kiirodik, ha nulla", async () => {
    const forras = await readFile(CLI, "utf-8");

    const sor = forras.indexOf("sor ÜRES árakkal áll");
    assert.equal(sor > 0, true);

    const elotte = forras.slice(0, sor);
    const utolsoIf = elotte.lastIndexOf("if (uresArral)");
    assert.equal(utolsoIf, -1);
  });
});

/**
 * A KEZDO SOR IDOPONTJA, ES A MEZO, AMI NEM LETEZETT.
 *
 * === A MERT HIBA ===
 *
 * A CLI a `UnasProductSnapshot.syncedAt` mezot valasztotta ki -- az a semaban
 * NINCS. A parancs ezert soha nem futott le (`Unknown field \`syncedAt\``), es
 * 1864 termek maradt kezdo sor nelkul.
 *
 * KET ORZO HIANYZOTT, ES MIND A KETTOT KIMONDOM:
 *
 * 1. A TIPUSELLENORZES NEM FOGJA MEG. Megmertem: a Prisma tipusai a `select`
 *    blokk ISMERETLEN kulcsait ELFOGADJAK -- egy `NEMLETEZIK: true` ugyanugy
 *    atmegy. Amit VISZONT megfognak: az ismeretlen FELSO SZINTU argumentum
 *    (`whereee` -> TS2561) es a rossz TIPUS egy letezo mezon (`where: { id:
 *    123 }` -> TS2322). A kapu tehat nem vak, csak epp EZT az egy alakot nem
 *    latja.
 *
 * 2. ES EGY ALLITAS ROGZITETTE A HIBAS NEVET. Itt korabban ez allt:
 *    `forras.includes("tukor?.syncedAt ?? most")`. Egy forras-szovegre mero
 *    allitas azt tudja megmondani, hogy a szoveg OTT VAN -- azt nem, hogy a
 *    mezo LETEZIK. Igy a hiba ORZOTTNEK latszott.
 *
 * === KALIBRACIO (2026-09-14, fej 3e8c7f1; alap 2636 lefutott teszt) ===
 *
 *   a CLI megint `syncedAt`-et valaszt (updatedAt HELYETT)   NEM FORDUL LE
 *   ugyanaz, de az `updatedAt` MARAD (igy lefordul)          1 piros, nev szerint
 *   a fuggveny mindig a `most`-ot adja                        1 piros
 *   a fuggveny mindig a tukor erteket adja                    1 piros
 *   a CLI nem a mert fuggvenyt hivja                          NEM FORDUL LE
 *   a mezo-kiolvaso regex elromlik                            a POZITIV KONTROLL sul el
 *
 * AZ ELSO A LEGJOBB HIR: a `kezdoSorIdopontja` TIPUSOS parametere miatt a
 * rossz mezonev MA MAR FORDITASI HIBA. Korabban nem volt az -- a kifejezes a
 * `create` blokkba folyt, es ott semmi nem allitotta meg. A refaktor tehat nem
 * csak olvashatobb lett, hanem KAPUT is csinalt oda, ahol nem volt.
 *
 * ES KET DOLOG A MERESROL, AMIT ERDEMES TUDNI (ezen a suite-on merve):
 *
 * 1. HA EGY `describe` TORZSE DOB, a futas MEGIS zold: `not ok` sor keletkezik
 *    `type: 'suite'` jelzessel, de a `# fail` NULLA MARAD, es a KILEPESI KOD 0.
 *    Sajat magamon mertem: az elso alakom `import.meta.url`-bol szamolta a
 *    forras utjat, az futasidoben a `test-dist` mappara mutat, ott `.ts` nincs,
 *    es a suite ENOENT-tel elszallt -- a `npm test` pedig SIKERT jelentett.
 *
 * 2. AMI EZT MEGIS ELARULJA: a LEFUTOTT TESZTEK SZAMA. A hibas suite tesztjei
 *    nem futnak le, tehat a szam CSOKKEN (itt 2636 -> 2633). A `# fail` nem
 *    mozdul, a `# tests` igen. Ezert all a kalibracios lapon a szam, es nem a
 *    pirosak darabszama.
 */
describe("a kezdo sor idopontja", () => {
  it("a tukor updatedAt erteket veszi, ha van", () => {
    const mikor = new Date("2026-09-01T10:00:00.000Z");
    const most = new Date("2026-09-14T21:00:00.000Z");
    assert.equal(
      kezdoSorIdopontja({ updatedAt: mikor }, most).toISOString(),
      mikor.toISOString(),
    );
  });

  /**
   * ISMERT POZITIV KONTROLL a lenti tagadasokhoz: tukor NELKUL a futas ideje
   * all a helyen. Enelkul a fenti allitast egy olyan valtozat is kielegitene,
   * ami MINDIG az elso argumentumot adja vissza.
   */
  it("tukor nelkul a futas ideje all a helyen", () => {
    const most = new Date("2026-09-14T21:00:00.000Z");
    assert.equal(kezdoSorIdopontja(null, most), most);
    assert.equal(kezdoSorIdopontja(undefined, most), most);
    assert.equal(kezdoSorIdopontja({ updatedAt: null }, most), most);
  });
});

/**
 * A KIVALASZTOTT MEZOK LETEZNEK-E -- A GENERALT SEMA SZERINT.
 *
 * EZ AZ AZ ORZO, AMI HIANYZOTT. Nem a szoveget meri, hanem a NEVEKET veti ossze
 * a Prisma GENERALT mezo-felsorolasaval (`ScalarFieldEnum`), ami a semabol
 * keletkezik. Egy nem letezo mezonev igy nev szerint pirosodik -- akkor is, ha a
 * tipusellenorzes atengedi.
 */
describe("a CLI a tukorbol csak letezo mezoket valaszt ki", () => {
  const forras = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "unas-kezdo-ar-sorok.cli.ts"),
    "utf8",
  );

  /** A `unasSnapshot: { select: { ... } }` blokk kulcsai. */
  const kivalasztott = (() => {
    const blokk = forras.match(
      /unasSnapshot:\s*\{\s*select:\s*\{([\s\S]*?)\}\s*,?\s*\}/,
    );
    assert.ok(blokk, "a tukor select blokkja nem talalhato a forrasban");
    return [
      ...(blokk[1] ?? "").matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm),
    ].map((m) => m[1] as string);
  })();

  /** ISMERT POZITIV KONTROLL: talaltunk EGYALTALAN mezoket. */
  it("a select blokk mezoi kiolvashatok", () => {
    assert.ok(
      kivalasztott.length >= 5,
      `kiolvasott mezok: ${kivalasztott.length}`,
    );
    assert.ok(kivalasztott.includes("netPrice"));
  });

  it("minden kivalasztott mezo szerepel a generalt sema-felsorolasban", () => {
    const letezo = new Set(
      Object.keys(Prisma.UnasProductSnapshotScalarFieldEnum),
    );
    const hianyzo = kivalasztott.filter((mezo) => !letezo.has(mezo));
    assert.deepEqual(hianyzo, []);
  });

  /**
   * ES A MASIK IRANY: a felsorolas TENYLEG megfog egy nem letezo nevet. Enelkul
   * a fenti allitas akkor is zold lenne, ha a halmaz mindent tartalmazna.
   */
  it("a felsorolas egy nem letezo nevet elutasit", () => {
    const letezo = new Set(
      Object.keys(Prisma.UnasProductSnapshotScalarFieldEnum),
    );
    assert.equal(letezo.has("syncedAt"), false);
    assert.equal(letezo.has("updatedAt"), true);
  });
});
