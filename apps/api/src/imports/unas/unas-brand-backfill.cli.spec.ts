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
    apply: async (plan: BrandBackfillPlan) => {
      hivasok.push("apply");
      return {
        created: plan.createBrands.length,
        assigned: plan.assign.length,
      };
    },
  };
  return { out, deps, hivasok, szoveg: () => ki.join("") };
}

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

    const kod = await runBrandBackfillCli(["--apply"], f.out, f.deps);

    assert.equal(kod, 0);
    assert.deepEqual(f.hivasok, ["rows", "brands", "apply"]);
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
