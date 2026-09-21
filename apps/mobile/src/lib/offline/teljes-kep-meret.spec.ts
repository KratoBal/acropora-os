import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { atvitelOsszege } from "./teljes-kep-meret";

describe("mit ígér a teljes képek gombja", () => {
  it("az ismert méreteket összeadja", () => {
    const eredmeny = atvitelOsszege([{ sizeBytes: 1000 }, { sizeBytes: 2000 }]);
    assert.deepEqual(eredmeny, { darab: 2, bytes: 3000, ismeretlen: false });
  });

  /**
   * A HIANYZO MERET NEM NULLA. A nulla azt IGERI, hogy ingyen van -- inkabb ne
   * alljon ott szam, mint hogy rossz alljon.
   *
   * MI PIROSIT: egy csupasz `reduce`, ami a nullat is osszeadja. Az a valtozat
   * a felso allitason ATMENNE, es CSAK ez fogja meg.
   */
  it("a hiányzó méret ISMERETLENNÉ teszi az összeget", () => {
    const eredmeny = atvitelOsszege([{ sizeBytes: 1000 }, { sizeBytes: 0 }]);
    assert.equal(eredmeny.ismeretlen, true);
  });

  it("az értelmetlen méret is ismeretlen", () => {
    assert.equal(atvitelOsszege([{ sizeBytes: Number.NaN }]).ismeretlen, true);
    assert.equal(atvitelOsszege([{ sizeBytes: -5 }]).ismeretlen, true);
  });

  /**
   * A DARABSZAM AKKOR IS AZ OSSZESET SZAMOLJA, ha a meret ismeretlen: a
   * szerelo lathassa, HANY kepről van szo, meg ha a megabajtot nem is tudjuk.
   */
  it("a darabszám ismeretlen méret mellett is megvan", () => {
    assert.equal(atvitelOsszege([{ sizeBytes: 0 }, { sizeBytes: 5 }]).darab, 2);
  });

  /** POZITIV KONTROLL: ures listara nulla, es NEM ismeretlen. */
  it("üres listán nincs mit átvinni", () => {
    assert.deepEqual(atvitelOsszege([]), {
      darab: 0,
      bytes: 0,
      ismeretlen: false,
    });
  });
});
