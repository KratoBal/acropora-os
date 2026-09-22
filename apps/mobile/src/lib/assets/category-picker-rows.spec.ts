import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { categoryPickerPlan } from "./category-picker-rows";

const AKTIV = [
  { id: "cat-szivattyu", name: "Szivattyú" },
  { id: "cat-vilagitas", name: "Világítás" },
];

describe("kategória-választó", () => {
  it("üres értéknél a „Nincs megadva” áll a csukott soron", () => {
    const terv = categoryPickerPlan({ options: AKTIV, value: "" });

    assert.equal(terv.summary, "Nincs megadva");
    assert.deepEqual(terv.rows, AKTIV);
  });

  it("választott kategóriánál a neve áll ott", () => {
    const terv = categoryPickerPlan({ options: AKTIV, value: "cat-vilagitas" });

    assert.equal(terv.summary, "Világítás");
    assert.equal(terv.rows.length, 2);
  });

  /**
   * EZ AZ AZ ALLITAS, AMIERT A FUGGVENY LETEZIK.
   *
   * Az eszkozon allhat KIVEZETETT kategoria: a valaszto a torzsadat AKTIV
   * sorait kapja, tehat az nincs kozottuk. Ha a csukott sor „Nincs megadva”
   * feliratot mutatna, a szerelo azt hinne, nincs beallitva semmi -- es egy
   * ervenyes erteket irna felul vakon. Ugyanaz a hiba, amit a matricakodnal
   * mar egyszer megfizettunk.
   */
  it("kivezetett kategóriánál a MOSTANI név áll a csukott soron", () => {
    const terv = categoryPickerPlan({
      options: AKTIV,
      value: "cat-regi",
      currentName: "Régi világítás",
    });

    assert.equal(terv.summary, "Régi világítás");
  });

  /**
   * ES A LISTABA IS BEKERUL, MEGJELOLVE, A LISTA ELEJEN.
   *
   * Enelkul a szerelo latna, mi all rajta, de ha kinyitja a listat es
   * meggondolja magat, NEM tudna visszaallitani az eredetit -- egy lista,
   * amibol csak kifele vezet ut.
   */
  it("a kivezetett kategória a lista ELEJÉRE kerül, megjelölve", () => {
    const terv = categoryPickerPlan({
      options: AKTIV,
      value: "cat-regi",
      currentName: "Régi világítás",
    });

    assert.equal(terv.rows.length, 3);
    assert.deepEqual(terv.rows[0], {
      id: "cat-regi",
      name: "Régi világítás (kivezetett)",
    });
    // KONTROLL: az aktiv sorok VALTOZATLANUL ott vannak utana. Egy rontas,
    // ami a kivezetettet a lista HELYERE teszi, a fenti ket allitason
    // atmenne.
    assert.deepEqual(terv.rows.slice(1), AKTIV);
  });

  /**
   * NEV NELKUL AZ AZONOSITO KERUL KI.
   *
   * Nem szep, de IGAZ: a „Nincs megadva” ott hazudna. Ugyanaz a visszaeses,
   * ami a helyszin-nevnel es a mertekegyseg-jelnel all a feloldo kepernyon.
   */
  it("név nélkül az azonosító áll ott, nem a „Nincs megadva”", () => {
    const terv = categoryPickerPlan({ options: AKTIV, value: "cat-regi" });

    assert.equal(terv.summary, "cat-regi");
    assert.notEqual(terv.summary, "Nincs megadva");
  });
});
