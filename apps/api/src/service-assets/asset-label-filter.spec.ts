import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assetLabelWhere } from "./asset-label-filter.js";

/**
 * A MATRICA-SZUROK OSSZEEPITESE.
 *
 * A dontő allitas a NEGYEDIK: a ket szuro EGYUTT is ertelmes keres, es a
 * valasznak mind a kettot hordoznia kell. A korabbi, ket spreades alak a
 * masodikkal NEMAN felulirta az elsot, es ettol egy `without` + kod hivas nem
 * ures listat adott, hanem a kod szerinti eszkozt -- ertelmes, nem ures
 * valaszt a MASIK kerdesre.
 */
describe("assetLabelWhere", () => {
  it("szuro nelkul ures feltetelt ad", () => {
    assert.deepEqual(assetLabelWhere(undefined, undefined), {});
  });

  it("a 'without' a kapcsolt sor hianyara szur", () => {
    assert.deepEqual(assetLabelWhere("without", undefined), { label: null });
  });

  it("a 'with' a kapcsolt sor meglétére szur", () => {
    assert.deepEqual(assetLabelWhere("with", undefined), {
      label: { isNot: null },
    });
  });

  /**
   * EGY AGGAL A VISSZAADOTT OBJEKTUM BETURE A REGI. Enelkul a fuggveny
   * bevezetese onmagaban megvaltoztatna minden meglevo hivas lekerdezeset --
   * olyan valtozas, amit senki nem kert, es amit a tesztek nem is nezne.
   */
  it("egy aggal NEM tesz AND-et a feltetel köré", () => {
    assert.deepEqual(assetLabelWhere(undefined, "V2196"), {
      label: { code: "V2196" },
    });
  });

  /**
   * EZ AZ AZ ALLITAS, AMIERT A FUGGVENY LETEZIK.
   *
   * Mindket feltetel megmarad. A `without` + kod ellentmondas, tehat a helyes
   * valasz az URES halmaz -- de azt az ADATBAZIS adja meg, nem mi: a mi
   * dolgunk annyi, hogy MIND A KETTO feltetel eljusson hozza.
   */
  it("a ket szuro EGYUTT is megmarad, egyik sem irja felul a masikat", () => {
    assert.deepEqual(assetLabelWhere("without", "V2196"), {
      AND: [{ label: null }, { label: { code: "V2196" } }],
    });
    assert.deepEqual(assetLabelWhere("with", "V2196"), {
      AND: [{ label: { isNot: null } }, { label: { code: "V2196" } }],
    });
  });
});
