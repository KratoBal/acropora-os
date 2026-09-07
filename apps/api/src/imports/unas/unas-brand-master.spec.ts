import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import {
  describeBrandMasterPlan,
  parseBrandMaster,
  planBrandMaster,
  type BrandMasterRow,
} from "./unas-brand-master.js";
import {
  planBrandBackfill,
  type BrandBackfillRow,
} from "./unas-brand-backfill.js";
import { BRAND_MASTER_PATH } from "./unas-brand-master.cli.js";

const sor = (
  kanonikus: string,
  alias = "",
  jelolo = "",
  forras = "BRAND",
): BrandMasterRow => ({
  kanonikus,
  alias,
  ketertelmu: "",
  forras,
  jelolo,
  megjegyzes: "",
});

describe("a márka-törzs betöltőjének terve", () => {
  it("létrehozza a jelöletlen sort, az aliasaival együtt", () => {
    const plan = planBrandMaster(
      [sor("Aqua Medic", "Aqua Medic"), sor("Aqua Medic", "AquaMedic")],
      [],
    );

    assert.deepEqual(plan.create, [
      {
        name: "Aqua Medic",
        aliases: ["Aqua Medic", "AquaMedic"],
        forras: "BRAND",
        jelolo: "",
      },
    ]);
  });

  /**
   * A NEGYEDIK JELOLO SZANDEKOSAN MAS: a marka LETEZESEBEN biztosak vagyunk,
   * csak a nev ALAKJABAN nem. Ha ezt osszemosnank a masik harommal, egy valodi
   * marka maradna ki -- 19 termekkel.
   */
  it("a kanonikus_meretlen sor LÉTREJÖN, nem esik ki", () => {
    const plan = planBrandMaster(
      [sor("Oase", "OASE", "kanonikus_meretlen")],
      [],
    );

    assert.equal(plan.create.length, 1);
    assert.equal(plan.create[0]!.jelolo, "kanonikus_meretlen");
    assert.deepEqual(plan.skipped, []);
  });

  it("a nem_onallo és az ellenorizendo sorból NEM lesz márka", () => {
    const plan = planBrandMaster(
      [
        sor("biOrb", "biOrb", "nem_onallo"),
        sor("Octo", "Octo", "ellenorizendo"),
      ],
      [],
    );

    assert.deepEqual(plan.create, []);
    assert.deepEqual(
      plan.skipped.map((s) => s.jelolo),
      ["nem_onallo", "ellenorizendo"],
    );
  });

  it("a ketertelmu_alias sorból tiltó bejegyzés lesz, nem márka", () => {
    const plan = planBrandMaster(
      [sor("", "Jebao/Jecod", "ketertelmu_ertek")],
      [],
    );

    assert.deepEqual(plan.create, []);
    assert.deepEqual(plan.blockedValues, ["Jebao/Jecod"]);
  });

  /**
   * A MASODIK FUTAS SZOTLAN. Ha ez nem allna, nem betolto lenne, hanem egyszer
   * hasznalhato parancs -- es akkor a neve is hazudna.
   */
  it("ami már áll, azt nem hozza létre újra", () => {
    const plan = planBrandMaster([sor("Triton", "Triton")], ["triton"]);

    assert.deepEqual(plan.create, []);
    assert.deepEqual(plan.alreadyThere, ["Triton"]);
  });
});

describe("a betöltő-bemenet értelmezése", () => {
  const FEJLEC = "kanonikus\talias\tketertelmu\tforras\tjelolo\tmegjegyzes\n";

  it("a hat oszloptól eltérő sor HIBA, nem figyelmeztetés", () => {
    const { rows, errors } = parseBrandMaster(
      FEJLEC + "Triton\tTriton\t\tBRAND\t\t\n" + "Rossz\tsor\tcsak\tnegy\n",
    );

    assert.equal(rows.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /4 oszlop/);
  });

  /**
   * AZ URES KANONIKUS CSAK TILTO SORNAL FOGADHATO EL. Enelkul egy elgepelt sor
   * CSENDBEN tiltott ertekke valna -- a tiltas nem lehet elgepeles
   * mellektermeke.
   */
  it("üres kanonikus név csak tiltó jelölővel fogadható el", () => {
    const jo = parseBrandMaster(
      FEJLEC + "\tJebao/Jecod\tigen\tBRAND\tketertelmu_ertek\t\n",
    );
    assert.deepEqual(jo.errors, []);
    assert.equal(jo.rows.length, 1);

    const rossz = parseBrandMaster(FEJLEC + "\tValami\t\tBRAND\t\t\n");
    assert.equal(rossz.rows.length, 0);
    assert.match(rossz.errors[0]!, /üres kanonikus/);
  });

  it("a # sorokat és az üres sorokat kihagyja", () => {
    const { rows, errors } = parseBrandMaster(
      "# fejlec-komment\n\n" + FEJLEC + "Triton\tTRITON\t\tGYARTO\t\tmegj\n",
    );

    assert.deepEqual(errors, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.alias, "TRITON");
  });
});

/**
 * A REPOBAN ALLO VALODI FAJL, ES AMIT RAJTA ALLITUNK.
 *
 * Ez nem egy kitalált fixture: a parancs EZT a fajlt fogja olvasni. Ha valaki
 * ujragenerálja a torzsbol es kozben elcsuszik egy oszlop, itt derul ki, nem
 * futas kozben.
 */
describe("a repóban álló betöltő-bemenet", () => {
  const { rows, errors } = parseBrandMaster(
    readFileSync(BRAND_MASTER_PATH, "utf8"),
  );

  it("értelmezhető, hibátlan sorokkal", () => {
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 181);
  });

  /**
   * A SZAMOT A v2-BOL SZAMOLTAM UJRA, nem vettem at a v1-bol: 124 kulonbozo
   * kanonikus minusz 9 kihagyando (nem_onallo vagy ellenorizendo) = 115.
   * Ugyanaz a szam, mint a v1-nel -- a szerkezet valtozott, az eredmeny nem.
   */
  it("a terv 115 márkát hozna létre, és 9 márka nem lesz", () => {
    const plan = planBrandMaster(rows, []);

    assert.equal(plan.create.length, 115);
    assert.equal(plan.skipped.length, 9);
    assert.deepEqual(plan.blockedValues, ["Jebao/Jecod"]);
    assert.deepEqual(plan.mixedMarkers, []);
  });

  /**
   * A KET TILTO FORRAS KULON MERHETO -- ES EZ AZ ALLITAS AZ, AMI EZT
   * BIZONYITJA: a `Jebao/Jecod` NINCS a szotar halmazaiban, tehat ha a
   * visszatoltes visszautasitja, azt CSAK a fajl-alapu tiltas okozhatta.
   */
  it("a fájl tiltása önmagában megállítja a visszatöltést", () => {
    const termek: BrandBackfillRow[] = [
      { productId: "p1", brandValue: "Jebao/Jecod", currentBrandId: null },
    ];

    const szotarNelkul = planBrandBackfill(termek, [], []);
    assert.deepEqual(szotarNelkul.refused, []);
    assert.equal(szotarNelkul.createBrands.length, 1);

    const fajllal = planBrandBackfill(termek, [], ["Jebao/Jecod"]);
    assert.equal(fajllal.createBrands.length, 0);
    assert.equal(fajllal.refused.length, 1);
    assert.match(fajllal.refused[0]!.reason, /betöltő-bemenet/);
  });

  it("a terv szövege kiírja a forrás-eloszlást és a mérés határát", () => {
    const szoveg = describeBrandMasterPlan(planBrandMaster(rows, []));

    assert.match(szoveg, /GYARTO/);
    assert.match(szoveg, /AMIT EZ A SZÁM NEM MOND MEG/);
  });
});
