import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  confirmQueuedAndLeave,
  QUEUED_TITLE,
  type AlertFn,
} from "./queued-confirmation";

/**
 * OFFLINE "KESZ" UTAN VISSZAIGAZOLAS ES VISSZALEPES (Balazs 2026-11-17: ures urlap nyilt). MI PIROSIT: nincs ablak; a
 * gomb nem lep vissza; az ablak mellette koppintva bezarhato (akkor az ures urlap marad).
 */
describe("sorba került: visszaigazolás", () => {
  it("egy ablak a mondattal, egy Rendben gomb, ami visszavisz, és nem zárható be mellette koppintva", () => {
    const hivasok: Parameters<AlertFn>[] = [];
    let vissza = 0;
    confirmQueuedAndLeave(
      "A rögzítés a feltöltésre várók közé került.",
      () => (vissza += 1),
      (...a) => hivasok.push(a),
    );
    assert.equal(hivasok.length, 1);
    const [cim, szoveg, gombok, opciok] = hivasok[0]!;
    assert.equal(cim, QUEUED_TITLE);
    assert.equal(szoveg, "A rögzítés a feltöltésre várók közé került.");
    assert.deepEqual(
      gombok.map((g) => g.text),
      ["Rendben"],
    );
    assert.equal(opciok.cancelable, false);
    assert.equal(vissza, 0);
    gombok[0]!.onPress();
    assert.equal(vissza, 1);
  });
});
