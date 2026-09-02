import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attachableWorksheetWhere } from "./attachable-worksheets.js";

describe("melyik lap csatolható egy hibajegy alá", () => {
  /**
   * EGYETLEN FELTÉTEL, ÉS EZ AZ ÁLLÍTÁS PONTOSAN AZT VÉDI.
   *
   * A kézenfekvő bővítés (csak piszkozat, csak az elmúlt harminc nap, csak
   * ami még nincs átadva) nem hibát okozna, hanem ELTÜNTETNÉ a folyamat felét
   * - és a felület attól még működne, csak épp nem találná azt a lapot, amit
   * keresnek. Ezért a szűrő KULCSAIT állítjuk, nem csak a viselkedést.
   */
  it("csak a hibajegy hiányára szűr, semmi másra", () => {
    const where = attachableWorksheetWhere();

    assert.deepEqual(Object.keys(where), ["serviceJobId"]);
    assert.equal(where.serviceJobId, null);
  });

  /**
   * A HÁROM TILTOTT SZŰRŐ NÉV SZERINT. Egy általános "egy kulcs van" állítás
   * elbukna ezekre is, de nem mondaná meg, MIÉRT baj - és a következő olvasó
   * azt hinné, a szám a lényeg. A lezárt, régi, átadott lap MIND csatolható.
   */
  it("nem szűr állapotra, korra és átadottságra", () => {
    const where = attachableWorksheetWhere() as Record<string, unknown>;

    assert.equal(where.versions, undefined);
    assert.equal(where.createdAt, undefined);
    assert.equal(where.handedOverAt, undefined);
  });
});
