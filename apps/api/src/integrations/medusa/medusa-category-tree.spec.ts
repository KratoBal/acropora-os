import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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

describe("a kategóriafa beolvasása", () => {
  it("a gyökérnél nincs szülő, a mélyebbnél van", () => {
    const rows = parseCategoryTsv(
      tsv(
        "1\t742922\t\tTermékek\t1\t1585\tTermékek",
        "2\t100\t742922\tHalak\t2\t10\tTermékek / Halak",
      ),
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.parentExternalId, null);
    assert.equal(rows[1]!.parentExternalId, "742922");
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
    { externalId: "a", parentExternalId: null, name: "A", depth: 1 },
    { externalId: "b", parentExternalId: "a", name: "B", depth: 2 },
  ];

  it("a helyes sorrendre null-t ad", () => {
    // ISMERT POZITIV KONTROLL: ha ez is talalatot adna, a lenti allitas semmit
    // nem bizonyitana -- egy "mindig talal" ellenorzes ugyanugy piros.
    assert.equal(firstOutOfOrder(jo), null);
  });

  it("megnevezi az ELSŐ sort, ami a szülője előtt áll", () => {
    // MI PIROSIT: ha valaki "rendezesre" csereli az ellenorzest. Egy sorrend,
    // ami magatol javul, elrejti, hogy a forras romlott el -- es a letrehozas
    // az elso mely kategorianal hasalna el, mert a szulo Medusa-azonositoja
    // meg nem letezik.
    assert.equal(firstOutOfOrder([jo[1]!, jo[0]!]), "b");
  });
});

describe("a betöltés terve", () => {
  const rows: CategoryRow[] = [
    { externalId: "1", parentExternalId: null, name: "Termékek", depth: 1 },
    { externalId: "2", parentExternalId: "1", name: "Halak", depth: 2 },
  ];

  it("üres Medusába mindet létrehozza, sorrendben", () => {
    const terv = planCategoryImport(rows, []);
    assert.deepEqual(
      terv.create.map((c) => [c.externalId, c.title, c.parentExternalId]),
      [
        ["1", "Termékek", null],
        ["2", "Halak - Termékek", "1"],
      ],
    );
    assert.deepEqual(terv.skip, []);
  });

  it("a MÁR meglévőt kihagyja, a KÜLSŐ azonosító alapján", () => {
    const terv = planCategoryImport(rows, [{ id: "pcat_x", externalId: "1" }]);
    assert.deepEqual(
      terv.create.map((c) => c.externalId),
      ["2"],
    );
    assert.deepEqual(terv.skip, ["1"]);
  });

  it("a NÉV egyezése NEM számít, csak a külső azonosító", () => {
    // EZ A LENYEG. A faban hetvenhat nev utkozik: ha a parositas nevre menne,
    // epp az utkozo teteleknel tevedne. Itt a Medusaban ALL egy "Halak" nevu
    // kategoria MAS azonositoval -- a tervnek MEGIS letre kell hoznia a mienket.
    const terv = planCategoryImport(rows, [
      { id: "pcat_masik", externalId: "999" },
    ]);
    assert.deepEqual(
      terv.create.map((c) => c.externalId),
      ["1", "2"],
    );
  });

  it("a külső azonosító NÉLKÜLI meglévő sor nem takar el semmit", () => {
    // A gyari bemutato adat (hat termek, negy kategoria) ilyen: nincs rajta a
    // mi azonositonk.
    const terv = planCategoryImport(rows, [
      { id: "pcat_gyari", externalId: null },
    ]);
    assert.deepEqual(
      terv.create.map((c) => c.externalId),
      ["1", "2"],
    );
  });

  it("ÜRES azonosítójú forrás-sor meg sem születik", () => {
    /*
      EZ AZ ALLITAS EGY MEGBUKOTT KALIBRACIOBOL SZULETETT.

      Elsore csak a fenti sor allt itt. Elrontottam a parositast ugy, hogy az
      URES azonosito is egyezesnek szamitson -- es SEMMI nem pirosodott ki: a
      fixturaban nem volt ures azonositoju sor, tehat az allitas nem mert
      semmit.

      A javitas nem uj fixtura lett, hanem az, hogy ures azonositoju sor MEG
      SEM SZULETHET: igy a "mivel egyezik" kerdes fel sem merul.
    */
    assert.throws(
      () => parseCategoryTsv(tsv("1\t\t\tNévtelen\t1\t0\tNévtelen")),
      /Üres azonosító/,
    );
  });
});
