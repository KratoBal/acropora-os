import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import {
  MedusaCategoryImportRefusedError,
  type CategoryImportReport,
  type MedusaCategoryImportService,
} from "./medusa-category-import.service.js";
import {
  describeVerification,
  runCategoryCli,
  type CliOutput,
} from "./medusa-category.cli.js";
import type { OurCategoryNode } from "./medusa-category-tree.js";

const FA: OurCategoryNode[] = [
  { id: "cat_gyoker", parentId: null, name: "Termékek" },
];

function kimenet() {
  const ki: string[] = [];
  const hiba: string[] = [];
  const out: CliOutput = {
    stdout: (v) => ki.push(v),
    stderr: (v) => hiba.push(v),
  };
  return { out, ki, hiba };
}

const URES_TERV = {
  create: [{ ourId: "cat_gyoker", title: "Termékek", parentOurId: null }],
  skip: [],
  mapOnly: [],
  staleMapping: [],
  conflict: [],
};

function szolgaltatasDupla(
  terv: unknown = URES_TERV,
  report?: Partial<CategoryImportReport>,
) {
  const hivasok: string[] = [];
  const service = {
    // eslint-disable-next-line @typescript-eslint/require-await
    async plan() {
      hivasok.push("plan");
      return { plan: terv, rows: [] };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async run() {
      hivasok.push("run");
      return {
        created: 1,
        linkedOnly: 0,
        relinked: 0,
        skipped: 0,
        conflicts: [],
        blockedByConflict: [],
        verification: {
          carryingOurId: 1,
          activeAmongThem: 1,
          mappingRowsHere: 1,
          expected: 1,
        },
        ...report,
      };
    },
  } as unknown as MedusaCategoryImportService;
  return { service, hivasok };
}

function deps(service: MedusaCategoryImportService) {
  return {
    client: () => Promise.resolve({} as MedusaAdminClient),
    tree: () => Promise.resolve(FA),
    service: () => service,
    now: () => new Date("2026-09-02T22:00:00.000Z"),
  };
}

describe("az ellenőrzés kimondása", () => {
  it("egyező számoknál kimondja, hogy egyeznek", () => {
    const szoveg = describeVerification({
      carryingOurId: 219,
      activeAmongThem: 219,
      mappingRowsHere: 219,
      expected: 219,
    });
    assert.match(szoveg, /A három szám egyezik/);
  });

  it("az INAKTÍV katalógust megnevezi, nem csak a számot adja", () => {
    /*
      EZ A NEMA HIBA HANGOS ALAKJA. Ha a Medusa eldobja az aktiv jelolot,
      minden mas szam helyes: 219 kategoria all a mi azonositonkkal, es 219
      lekepezes-sor all nalunk. Egy nyers szamharmas mellett az olvasonak
      TUDNIA kellene, hogy a masodik szamot a harmadikhoz kell merni.
    */
    const szoveg = describeVerification({
      carryingOurId: 219,
      activeAmongThem: 0,
      mappingRowsHere: 219,
      expected: 219,
    });
    assert.doesNotMatch(szoveg, /A három szám egyezik/);
    assert.match(szoveg, /219 kategória INAKTÍV/);
    assert.match(szoveg, /nem látszik/);
  });

  it("a hiányzó leképezés-sorokat is megnevezi", () => {
    const szoveg = describeVerification({
      carryingOurId: 219,
      activeAmongThem: 219,
      mappingRowsHere: 0,
      expected: 219,
    });
    assert.match(szoveg, /csak 0 leképezés-sor/);
    assert.match(szoveg, /kategória nélkül menne ki/);
  });
});

describe("a kategória-parancs", () => {
  it("--apply NÉLKÜL csak tervez, és a betöltést MEG SEM HÍVJA", async () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN, es nem a kiirt szoveget meri.
      Egy "megnezem, mit csinalna" szandeku futas nem hozhat letre 219
      kategoriat egy kulso rendszerben. A bizonyitek az, hogy a `run` NEM
      szerepel a hivasok kozott -- nem az, hogy a kimeneten ott all a "terv" szo.
    */
    const { service, hivasok } = szolgaltatasDupla();
    const { out, ki } = kimenet();
    const kod = await runCategoryCli([], out, deps(service));
    assert.deepEqual(hivasok, ["plan"]);
    assert.equal(kod, 0);
    assert.match(ki.join(""), /Létrehozandó: 1/);
  });

  it("--apply-jal a betöltést hívja", async () => {
    // ISMERT POZITIV KONTROLL a fentihez: ha a `run` SOHA nem hivodna meg, a
    // fenti allitas akkor is zold lenne, es semmit nem bizonyitana.
    const { service, hivasok } = szolgaltatasDupla();
    const { out } = kimenet();
    const kod = await runCategoryCli(["--apply"], out, deps(service));
    assert.deepEqual(hivasok, ["run"]);
    assert.equal(kod, 0);
  });

  it("ütközésnél a kilépési kód 2, nem 0 és nem 1", async () => {
    // Nem hiba (a tobbi tetel atment), de nem is csend: ember dontese kell.
    const { service } = szolgaltatasDupla(URES_TERV, {
      conflicts: ["cat_gyoker"],
    });
    const { out } = kimenet();
    assert.equal(await runCategoryCli(["--apply"], out, deps(service)), 2);
  });

  it("a szülőjük miatt kimaradt ágakra is 2", async () => {
    const { service } = szolgaltatasDupla(URES_TERV, {
      blockedByConflict: ["cat_hal"],
    });
    const { out } = kimenet();
    assert.equal(await runCategoryCli(["--apply"], out, deps(service)), 2);
  });

  it("megtagadott betöltésnél 1-gyel lép ki, és az OKOT írja ki", async () => {
    const service = {
      run: () =>
        Promise.reject(
          new MedusaCategoryImportRefusedError("a lista csonkolt"),
        ),
    } as unknown as MedusaCategoryImportService;
    const { out, hiba } = kimenet();
    assert.equal(await runCategoryCli(["--apply"], out, deps(service)), 1);
    assert.match(hiba.join(""), /a lista csonkolt/);
  });
});
