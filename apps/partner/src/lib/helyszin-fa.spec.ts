import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { helyszinFa } from "./helyszin-fa.js";

const sor = (id: string, parentId: string | null) => ({ id, parentId });

describe("helyszinFa", () => {
  it("a fát a szülő szerint építi, mélységgel", () => {
    const fa = helyszinFa([
      sor("fank", null),
      sor("biodom", "fank"),
      sor("medence", "biodom"),
    ]);

    assert.deepEqual(
      fa.map((x) => [x.item.id, x.depth]),
      [
        ["fank", 0],
        ["biodom", 1],
        ["medence", 2],
      ],
    );
  });

  /**
   * EZ AZ AZ ÁLLÍTÁS, AMIÉRT A FÜGGVÉNY KÜLÖN ÁLL.
   *
   * A szűkített válaszban egy kiosztott helyszín szülője hiányozhat. A korábbi
   * alak a gyökértől indulva járt be, tehát az ilyen sor CSENDBEN eltűnt --
   * nem hibaüzenettel, hanem egy hiányzó sorral.
   */
  it("az ÁRVA sor is megjelenik, gyökérként", () => {
    // A "biodom" szuloje ("fank") NINCS a halmazban.
    const fa = helyszinFa([sor("biodom", "fank"), sor("krokodil", null)]);

    assert.deepEqual(
      fa.map((x) => [x.item.id, x.depth]),
      [
        ["biodom", 0],
        ["krokodil", 0],
      ],
    );
  });

  /**
   * KONTROLL: HA A SZÜLŐ OTT VAN, AZ ÁRVA-SZABÁLY NEM LÉP BE.
   *
   * Enélkül a fenti állítás egy olyan megvalósításon is zöld lenne, ami MINDEN
   * sort gyökérnek vesz -- vagyis eldobja a hierarchiát.
   */
  it("KONTROLL: meglévő szülőnél NEM lapítja ki a fát", () => {
    const fa = helyszinFa([sor("fank", null), sor("biodom", "fank")]);

    assert.deepEqual(
      fa.map((x) => x.depth),
      [0, 1],
    );
  });

  it("üres listára üres eredmény", () => {
    assert.deepEqual(helyszinFa([]), []);
  });

  /**
   * A SORREND A BEMENETÉ, TESTVÉREK KÖZÖTT. A függvény NEM rendez: a
   * szerver adja a sorrendet, és egy itteni rendezés csendben felülírná.
   */
  it("testvérek között a bemeneti sorrendet tartja", () => {
    const fa = helyszinFa([
      sor("gyoker", null),
      sor("masodik", "gyoker"),
      sor("elso", "gyoker"),
    ]);

    assert.deepEqual(
      fa.map((x) => x.item.id),
      ["gyoker", "masodik", "elso"],
    );
  });
});
