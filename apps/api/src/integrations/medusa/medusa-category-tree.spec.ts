import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  categoryRowsFromOurTree,
  categoryTitle,
  firstOutOfOrder,
  parseCategoryTsv,
  planCategoryImport,
  type CategoryRow,
} from "./medusa-category-tree.js";

const FEJLEC =
  "sorszam\tazonosito\tszulo_azonosito\tnev\tmelyseg\tkozvetlen_termek_szam\tteljes_ut";

function tsv(...sorok: string[]): string {
  return [FEJLEC, ...sorok].join("\n") + "\n";
}

describe("a forrás-fájl beolvasása", () => {
  it("a gyökérnél nincs szülő, a mélyebbnél van", () => {
    const rows = parseCategoryTsv(
      tsv(
        "1\t742922\t\tTermékek\t1\t1585\tTermékek",
        "2\t100\t742922\tHalak\t2\t10\tTermékek / Halak",
      ),
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.parentSourceId, null);
    assert.equal(rows[1]!.parentSourceId, "742922");
    assert.equal(rows[1]!.name, "Halak");
  });

  it("hiányzó oszlopra hangosan elhasal", () => {
    // MI PIROSIT: ha a forras oszlopai atrendezodnek. A CSENDES valtozat az
    // lenne, hogy `undefined`-ot olvasunk, es ures nevekkel hozunk letre 219
    // kategoriat -- ami "sikeres" futas.
    assert.throws(
      () => parseCategoryTsv("a\tb\tc\n1\t2\t3\n"),
      /Hiányzó oszlop/,
    );
  });

  it("ÜRES azonosítójú forrás-sor meg sem születik", () => {
    /*
      EZ AZ ALLITAS EGY MEGBUKOTT KALIBRACIOBOL SZULETETT.

      Elsore csak egy allitas allt arrol, hogy az URES azonosito ne takarjon el
      semmit a parositasban -- es a celzott rontas NEM pirositotta ki, mert a
      fixturaban nem volt ures azonositoju sor. Az allitas nem mert semmit.

      A javitas nem uj fixtura lett, hanem az, hogy ures azonositoju sor MEG
      SEM SZULETHET: igy a "mivel egyezik" kerdes fel sem merul.
    */
    assert.throws(
      () => parseCategoryTsv(tsv("1\t\t\tNévtelen\t1\t0\tNévtelen")),
      /Üres azonosító/,
    );
  });
});

describe("a mi fánkból készülő sorok", () => {
  it("a szülő mindig a gyereke ELŐTT áll, akkor is, ha a bemenet kevert", () => {
    // MI PIROSIT: ha valaki a bemenet sorrendjet veszi at. A `Category` tabla
    // lekerdezese semmilyen sorrendet nem igér.
    const sorok = categoryRowsFromOurTree([
      { id: "c", parentId: "b", name: "Nagy" },
      { id: "a", parentId: null, name: "Termékek" },
      { id: "b", parentId: "a", name: "Halak" },
    ]);
    assert.deepEqual(
      sorok.map((s) => s.ourId),
      ["a", "b", "c"],
    );
    assert.equal(firstOutOfOrder(sorok), null);
  });

  it("a halmazon KÍVÜLI szülőre hangosan elhasal", () => {
    // Egy szurt lekerdezes levaghatja a szulot. A csendes valtozat az lenne,
    // hogy az ag egyszeruen kimarad a betoltesbol, es senki nem tudja, melyik.
    assert.throws(
      () =>
        categoryRowsFromOurTree([{ id: "b", parentId: "a", name: "Halak" }]),
      /nincs a halmazban/,
    );
  });

  it("körre hangosan elhasal", () => {
    // A `Category.parentId` ezt nem zarja ki. Bejaras kozben ez vegtelen
    // ciklus lenne; igy egy meg nem irt sor is szamotteveo.
    assert.throws(
      () =>
        categoryRowsFromOurTree([
          { id: "a", parentId: "b", name: "A" },
          { id: "b", parentId: "a", name: "B" },
        ]),
      /Kör van/,
    );
  });
});

describe("a megjelenő cím", () => {
  it("a gyökér a saját nevén áll", () => {
    assert.equal(categoryTitle("Termékek", null), "Termékek");
  });

  it("a mélyebb a szülője nevével egészül ki", () => {
    // A HETVENHAT UTKOZO NEV MIATT. Ket kulonbozo agon allo "Nagy" itt ket
    // kulonbozo cimet kap.
    assert.equal(categoryTitle("Nagy", "Halak"), "Nagy - Halak");
    assert.notEqual(
      categoryTitle("Nagy", "Halak"),
      categoryTitle("Nagy", "Korall"),
    );
  });
});

describe("a sorrend ellenőrzése", () => {
  const jo: CategoryRow[] = [
    { ourId: "a", parentOurId: null, name: "A" },
    { ourId: "b", parentOurId: "a", name: "B" },
  ];

  it("a helyes sorrendre null-t ad", () => {
    // ISMERT POZITIV KONTROLL: ha ez is talalatot adna, a lenti allitas semmit
    // nem bizonyitana -- egy "mindig talal" ellenorzes ugyanugy piros.
    assert.equal(firstOutOfOrder(jo), null);
  });

  it("megnevezi az ELSŐ sort, ami a szülője előtt áll", () => {
    // MI PIROSIT: ha valaki "rendezesre" csereli az ellenorzest. A letrehozas
    // az elso mely kategorianal hasalna el, mert a szulo Medusa-azonositoja
    // meg nem letezik.
    assert.equal(firstOutOfOrder([jo[1]!, jo[0]!]), "b");
  });
});

describe("a betöltés terve", () => {
  const rows: CategoryRow[] = [
    { ourId: "1", parentOurId: null, name: "Termékek" },
    { ourId: "2", parentOurId: "1", name: "Halak" },
  ];

  it("üres Medusába mindet létrehozza, sorrendben", () => {
    const terv = planCategoryImport(rows, [], []);
    assert.deepEqual(
      terv.create.map((c) => [c.ourId, c.title, c.parentOurId]),
      [
        ["1", "Termékek", null],
        ["2", "Halak - Termékek", "1"],
      ],
    );
    assert.deepEqual(terv.skip, []);
    assert.deepEqual(terv.mapOnly, []);
    assert.deepEqual(terv.staleMapping, []);
    assert.deepEqual(terv.conflict, []);
  });

  it("a NÉV egyezése NEM számít, csak a mi azonosítónk", () => {
    // EZ A LENYEG. A faban hetvenhat nev utkozik: ha a parositas nevre menne,
    // epp az utkozo teteleknel tevedne. Itt a Medusaban ALL egy "Halak" nevu
    // kategoria MAS azonositoval -- a tervnek MEGIS letre kell hoznia a mienket.
    const terv = planCategoryImport(
      rows,
      [{ id: "pcat_masik", externalId: "999" }],
      [],
    );
    assert.deepEqual(
      terv.create.map((c) => c.ourId),
      ["1", "2"],
    );
  });

  it("a külső azonosító NÉLKÜLI meglévő sor nem takar el semmit", () => {
    // A gyari bemutato adat (hat termek, negy kategoria) ilyen: nincs rajta a
    // mi azonositonk.
    const terv = planCategoryImport(
      rows,
      [{ id: "pcat_gyari", externalId: null }],
      [],
    );
    assert.deepEqual(
      terv.create.map((c) => c.ourId),
      ["1", "2"],
    );
  });

  /*
    AZ OT ALLAPOT. Mindegyiknek MAS a teendoje, es a lenti allitasok pontosan
    ezt a kulonbseget merik: ha ket allapot ugyanoda esne, a kalibracio TOBB
    sort pirositana ki, mint a szant -- az nem bizonyitek, hanem az, hogy a
    teszt nem kulonboztet.
  */

  it("ami áll a Medusában ÉS van sorunk róla: nincs teendő", () => {
    const terv = planCategoryImport(
      rows,
      [{ id: "pcat_1", externalId: "1" }],
      [{ ourId: "1", medusaId: "pcat_1" }],
    );
    assert.deepEqual(terv.skip, ["1"]);
    assert.deepEqual(
      terv.create.map((c) => c.ourId),
      ["2"],
    );
    assert.deepEqual(terv.mapOnly, []);
    assert.deepEqual(terv.conflict, []);
  });

  it("ami áll a Medusában, de NINCS sorunk: csak a sort írjuk meg", () => {
    // EZ AZ ALLAPOT EGY FELBESZAKADT FUTAS UTAN ALL ELO: a Medusa mar
    // megkapta, mi meg nem jegyeztuk fel. Ha ezt letrehozasnak vennenk, ket
    // azonos kategoria keletkezne -- es a masodiknak MAR nem lehetne a mi
    // azonositonkat adni.
    const terv = planCategoryImport(
      rows,
      [{ id: "pcat_1", externalId: "1" }],
      [],
    );
    assert.deepEqual(terv.mapOnly, [{ ourId: "1", medusaId: "pcat_1" }]);
    assert.deepEqual(
      terv.create.map((c) => c.ourId),
      ["2"],
    );
    assert.deepEqual(terv.skip, []);
  });

  it("ha van sorunk, de a Medusából eltűnt: újra létrehozzuk, és jelezzük", () => {
    // A sorunk hazudik. Ujra letre kell hozni, ES a sort FELULIRNI, nem
    // beszurni -- ezert all a `staleMapping` listaban is, nem csak a
    // `create`-ben.
    const terv = planCategoryImport(
      rows,
      [],
      [{ ourId: "1", medusaId: "pcat_torolt" }],
    );
    assert.deepEqual(terv.staleMapping, ["1"]);
    assert.deepEqual(
      terv.create.map((c) => c.ourId),
      ["1", "2"],
    );
    assert.deepEqual(terv.mapOnly, []);
  });

  it("ha KÉT különböző Medusa-azonosító tartozik hozzá: megáll, nem javít", () => {
    // A sorunk `pcat_regi`-re mutat, a mi azonositonkat viszont `pcat_uj`
    // hordozza. NEM tudjuk, melyik a helyes: lehet halott sor, es lehet, hogy
    // valaki kezzel adta a mi azonositonkat egy MASIK kategorianak. Egy
    // felulirassal a masodik esetben elvesznenek a termek-hozzarendelesek.
    const terv = planCategoryImport(
      rows,
      [{ id: "pcat_uj", externalId: "1" }],
      [{ ourId: "1", medusaId: "pcat_regi" }],
    );
    assert.deepEqual(terv.conflict, [
      {
        ourId: "1",
        mappedMedusaId: "pcat_regi",
        medusaIdCarryingOurId: "pcat_uj",
      },
    ]);
    // ES SEMMI MAST NEM CSINAL VELE. Ez a fontosabb fele: egy utkozo tetel,
    // ami mellesleg a `create` listaba is bekerul, ket kategoriat hagyna maga
    // utan.
    assert.deepEqual(
      terv.create.map((c) => c.ourId),
      ["2"],
    );
    assert.deepEqual(terv.skip, []);
    assert.deepEqual(terv.mapOnly, []);
    assert.deepEqual(terv.staleMapping, []);
  });
});
