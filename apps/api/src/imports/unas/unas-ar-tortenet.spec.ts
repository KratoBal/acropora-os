import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { arKepAlakja, kellUjArSor, type ArKep } from "./unas-ar-tortenet.js";

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
    assert.equal(forras.includes("tukor?.syncedAt ?? most"), true);
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
