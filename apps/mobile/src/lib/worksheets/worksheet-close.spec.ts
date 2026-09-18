import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canCloseWorksheetVersion,
  LEZARAS_ISMERETLEN_HIBA,
  lezarasHibaUzenete,
} from "./worksheet-close";

describe("mikor látszik a lezáró gomb", () => {
  it("piszkozaton, joggal: látszik", () => {
    assert.equal(
      canCloseWorksheetVersion({ status: "DRAFT", worksheetsManage: true }),
      true,
    );
  });

  /**
   * A KET FELTETEL KULON-KULON IS SZAMIT, es ezert ket kulon allitas all rajtuk.
   * Egy kozos "nem latszik" allitas nem mondana meg, MELYIK feltetel tartja.
   */
  it("jog nélkül nem látszik", () => {
    assert.equal(
      canCloseWorksheetVersion({ status: "DRAFT", worksheetsManage: false }),
      false,
    );
  });

  it("már lezárt lapon nem látszik", () => {
    for (const status of ["AWAITING_SIGNATURE", "SIGNED", "REJECTED"]) {
      assert.equal(
        canCloseWorksheetVersion({ status, worksheetsManage: true }),
        false,
        status,
      );
    }
  });
});

describe("mit mond a képernyő, ha a lezárás elbukik", () => {
  /**
   * A SZERVER UZENETE MEGY KI, nem sajat masolat: egy masolat egyszer
   * elcsuszna, es a telefon MAST mondana, mint a web -- ugyanarra a lapra.
   */
  it("a szerver mondatát adja tovább", () => {
    assert.equal(
      lezarasHibaUzenete("A munkalapnak nincs tétele."),
      "A munkalapnak nincs tétele.",
    );
  });

  it("hiányzó szerver-üzenetnél sem marad üres", () => {
    assert.equal(lezarasHibaUzenete(null), LEZARAS_ISMERETLEN_HIBA);
    assert.equal(lezarasHibaUzenete("   "), LEZARAS_ISMERETLEN_HIBA);
  });
});
