import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runBrandBackfillCli,
  type BackfillProgress,
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
function cliWith(
  sorok: BrandBackfillRow[] = [],
  markak: ExistingBrand[] = [],
  /**
   * A BUKO VEGREHAJTO: annyit ir, amennyit a hivo ker, aztan dob. Enelkul a
   * felbehagyott futast nem lehetne merni -- egy dupla, ami mindig sikerul,
   * pont azt az agat nem jarja be, amirol ez a szelet szol.
   */
  bukasElotte: number | null = null,
) {
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
    apply: async (
      plan: BrandBackfillPlan,
      actorId: string,
      progress: BackfillProgress,
    ) => {
      hivasok.push("apply:" + actorId);
      if (bukasElotte !== null) {
        progress.created = bukasElotte;
        throw new Error("az adatbázis elutasította az írást");
      }
      progress.created = plan.createBrands.length;
      progress.assigned = plan.assign.length;
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

/**
 * A FELBEHAGYOTT IRAS KIMENETE.
 *
 * === MIT MER, ES MIT NEM ===
 *
 * Azt meri, hogy a bukas utan is MEGTUDJA a hivo, hany marka es hany termek
 * keszult el. Azt NEM meri, hogy a szamok igazak -- azt az adatbazis mondja
 * meg. A javitas kenyelmet ad vissza, nem bizonyitekot: az allapot a bukas utan
 * is lekerdezheto.
 *
 * === MIERT KELL A MASODIK ALLITAS ===
 *
 * Az elso onmagaban akkor is zold lenne, ha a parancs a hibat ELNYELNE es nulla
 * kilepesi koddal allna meg -- vagyis pont a legrosszabb valtozatot engedne at.
 * A ketto egyutt hatarolja be: a szamok kimennek, ES a futas attol meg bukott.
 */
describe("a márka-visszatöltés félbehagyott írása", () => {
  it("bukás esetén is kiírja, mennyi készült el", async () => {
    const f = cliWith([SOR], [], 1);

    /**
     * A DOBAST ITT SZANDEKOSAN ELNYELJUK, es ez nem hanyagsag.
     *
     * Merve: amig `assert.rejects` allt itt, ez az allitas a DOBASROL is
     * beszelt -- es akkor az a rontas, ami a hibat elnyeli, KET tesztet dontott
     * pirosra, nem egyet. Tobb piros a szantnal nem erosebb bizonyitek: azt
     * mondja, hogy a ket allitas ugyanazt az utat jarja.
     *
     * Igy viszont ez a szelet CSAK a kiirast meri, a szomszedja CSAK a dobast,
     * es mindket rontas pontosan a sajat tesztjet donti el.
     */
    await runBrandBackfillCli(
      ["--apply", "--actor", LETEZO_FELHASZNALO],
      f.out,
      f.deps,
    ).catch(() => undefined);

    assert.match(f.szoveg(), /Eddig létrehozott márka-rekord: 1/);
    assert.match(f.szoveg(), /Eddig márkát kapott termék: 0/);
  });

  it("a hiba tovább megy: a félbehagyott írás NEM sikeres futás", async () => {
    const f = cliWith([SOR], [], 1);

    await assert.rejects(
      () =>
        runBrandBackfillCli(
          ["--apply", "--actor", LETEZO_FELHASZNALO],
          f.out,
          f.deps,
        ),
      /az adatbázis elutasította az írást/,
    );

    // ES A SIKER-SZOVEG NEM JELENIK MEG: egy felbehagyott futas kimenete ne
    // legyen osszetevesztheto egy kesz futaseval.
    assert.doesNotMatch(f.szoveg(), /^Létrehozott márka-rekord/m);
  });
});

/**
 * A KETERTELMU KULCS A PARANCSOT IS MEGALLITJA -- A TERVET IS, NEM CSAK AZ IRAST.
 *
 * Egy terv, ami ketertelmu indexre epul, MAR rossz sorokat mutat: a jovahagyo
 * azt olvasna dontesi anyagnak. Ezert a proba-alak sem fut le.
 */
describe("a márka-visszatöltés kétértelmű kulcsnál megáll", () => {
  const KETERTELMU: ExistingBrand[] = [
    {
      id: "b1",
      name: "AquaMedic",
      normalizedName: "aquamedic",
      normalizedAliases: [],
    },
    {
      id: "b2",
      name: "Aqua Medic",
      normalizedName: "aqua medic",
      normalizedAliases: ["aquamedic"],
    },
  ];

  it("--apply NÉLKÜL sem ad tervet, és megnevezi mindkét márkát", async () => {
    const f = cliWith([SOR], KETERTELMU);

    const kod = await runBrandBackfillCli([], f.out, f.deps);

    assert.equal(kod, 1);
    assert.match(f.szoveg(), /KÉTÉRTELMŰ MÁRKA-KULCS/);
    assert.match(f.szoveg(), /"AquaMedic"/);
    assert.match(f.szoveg(), /"Aqua Medic"/);
  });

  /**
   * ES A BIZONYITEK ITT IS AZ, HOGY NEM TORTENT SEMMI: a terv-szoveg ki sem
   * irodik. A kimenet szovege onmagaban nem eleg -- egy parancs, ami kiirja a
   * figyelmeztetest ES a tervet is, ugyanezt a sort adna.
   */
  it("a terv szövege meg sem jelenik", async () => {
    const f = cliWith([SOR], KETERTELMU);

    await runBrandBackfillCli([], f.out, f.deps);

    assert.doesNotMatch(f.szoveg(), /Létrehozandó márka-rekord/);
  });
});
