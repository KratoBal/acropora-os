import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runBrandBackfillCli,
  type CliOutput,
} from "./unas-brand-backfill.cli.js";
import type {
  BrandBackfillPlan,
  BrandBackfillRow,
  ExistingBrand,
} from "./unas-brand-backfill.js";

/**
 * A PROBA-ALAK KAPUJA, ES AMIT EGY ALLITASNAK BIZONYITANIA KELL.
 *
 * A tiszta modul specje azt meri, hogy a TERV helyes. Amit NEM mer -- es a
 * szeletnek epp ez a fele --, hogy az `--apply` nelkuli futas TENYLEG nem ir.
 *
 * ES A MERCE NEM A KIMENET SZOVEGE: egy parancs, ami kiirja, hogy "terv", es
 * kozben ir, ugyanezt a sort adna. A bizonyitek az, hogy a VEGREHAJTO
 * FUGGVENYT nem hivtuk meg -- vagyis nem tortent semmi.
 *
 * A HIVAS-LISTA EGESZET allitjuk, nem csak az `apply` hianyat: igy egy
 * BARMILYEN uj mellekhatas-hivas is kiderul, nem csak az, amire gondoltunk.
 *
 * AMIT EZ AZ ALLITAS NEM BIZONYIT, es kimondva: azt, hogy a torzs sehol nem ir
 * KOZVETLENUL (a varraton kivul). Ez a seam szintjen a legtobb, amit merni
 * lehet; a kozvetlen irast a kod atolvasasa zarja ki, nem ez a teszt.
 */
function cliWith(sorok: BrandBackfillRow[] = [], markak: ExistingBrand[] = []) {
  const hivasok: string[] = [];
  const ki: string[] = [];
  const out: CliOutput = {
    stdout: (value) => ki.push(value),
    stderr: (value) => ki.push("ERR:" + value),
  };
  const deps = {
    rows: async () => {
      hivasok.push("rows");
      return sorok;
    },
    brands: async () => {
      hivasok.push("brands");
      return markak;
    },
    actorExists: async (actorId: string) => {
      hivasok.push("actorExists");
      return actorId === LETEZO_FELHASZNALO;
    },
    apply: async (plan: BrandBackfillPlan, actorId: string) => {
      hivasok.push("apply:" + actorId);
      return {
        created: plan.createBrands.length,
        assigned: plan.assign.length,
      };
    },
  };
  return { out, deps, hivasok, szoveg: () => ki.join("") };
}

const LETEZO_FELHASZNALO = "user-1";

const SOR: BrandBackfillRow = {
  productId: "p1",
  brandValue: "Triton",
  currentBrandId: null,
};

describe("a márka-visszatöltés próba-alakja", () => {
  it("--apply NÉLKÜL egyetlen író hívás sem történik", async () => {
    const f = cliWith([SOR]);

    const kod = await runBrandBackfillCli([], f.out, f.deps);

    assert.equal(kod, 0);
    // A BIZONYITEK: a vegrehajto nem futott le. A kimenet szovege nem az.
    assert.deepEqual(f.hivasok, ["rows", "brands"]);
    assert.match(f.szoveg(), /Ez a futás semmit nem írt/);
  });

  /**
   * ES A MASIK IRANY, MERT AZ ELSO ALLITAS NELKULE ERTELMETLEN: egy teszt, ami
   * csak azt allitja, hogy nem ir, akkor is zold, ha a parancs SEMMIT nem
   * csinal. A ketto egyutt hatarolja be a kaput.
   */
  it("--apply MELLETT a végrehajtó lefut, és a számok a kimenetre kerülnek", async () => {
    const f = cliWith([SOR]);

    const kod = await runBrandBackfillCli(
      ["--apply", "--actor", LETEZO_FELHASZNALO],
      f.out,
      f.deps,
    );

    assert.equal(kod, 0);
    assert.deepEqual(f.hivasok, [
      "rows",
      "brands",
      "actorExists",
      "apply:" + LETEZO_FELHASZNALO,
    ]);
    assert.match(f.szoveg(), /Létrehozott márka-rekord: 1/);
    assert.match(f.szoveg(), /Termék, amire márka került: 0/);
  });

  /**
   * A TERV SZAMAI A PROBA-FUTASBAN IS MEGJELENNEK: enelkul a proba-alak nem
   * dontesi eszkoz lenne, csak egy biztonsagi kapcsolo.
   */
  it("a próba-futás kiírja a terv számait is", async () => {
    const f = cliWith([SOR]);

    await runBrandBackfillCli([], f.out, f.deps);

    assert.match(f.szoveg(), /Létrehozandó márka-rekord: 1/);
    assert.match(f.szoveg(), /se kategóriát, se árat, se készletet/);
  });
});

/**
 * A SZEREPLO ORZOJE, ES MIND A KET ALLITAS AZT MERI, HOGY NEM TORTENT SEMMI.
 *
 * A MERT HIBA, AMIT EZ ZAR LE: az elso valtozat a `"unas-backfill"` SZOVEGET
 * adta at `actorId` gyanant. Az ertek a `DomainEvent.actorUserId` oszlopba
 * megy, aminek idegen kulcsa van a `User` tablara -- a teszt gepen az iras az
 * ELSO markanal hasalt el (P2003).
 *
 * A tesztek addig zoldek voltak, es HELYESEN azok: a spec az `apply` helyere
 * duplat injektal, es egy idegen kulcs KIZAROLAG az adatbazisban letezik,
 * duplaban soha. Ez az az alak, amit a sajat lapunk ir le: egy duplat nem az
 * minosit, hogy zold tole a teszt, hanem hogy a HIVO minden hasznalt erteket
 * megkap-e. A hivo itt olyan erteket adott at, amit egyedul az adatbazis tud
 * elutasitani -- ezert kerult a LETEZES-ELLENORZES a varratra.
 */
describe("a márka-visszatöltés szereplő-őrzője", () => {
  it("--actor nélkül NEM ír, és megmondja, mit kér", async () => {
    const f = cliWith([SOR]);

    const kod = await runBrandBackfillCli(["--apply"], f.out, f.deps);

    assert.equal(kod, 1);
    assert.deepEqual(f.hivasok, ["rows", "brands"]);
    assert.match(f.szoveg(), /--actor/);
  });

  /**
   * ES A NEM LETEZO AZONOSITO IS MEGALL -- MIELOTT BARMI TORTENIK. Enelkul az
   * elso marka letrehozasakor hasalna el, felbehagyott futassal.
   */
  it("nem létező --actor mellett sem ír egyetlen sort sem", async () => {
    const f = cliWith([SOR]);

    const kod = await runBrandBackfillCli(
      ["--apply", "--actor", "nincs-ilyen"],
      f.out,
      f.deps,
    );

    assert.equal(kod, 1);
    assert.deepEqual(f.hivasok, ["rows", "brands", "actorExists"]);
    assert.match(f.szoveg(), /Az írás EL SEM INDULT/);
  });
});
