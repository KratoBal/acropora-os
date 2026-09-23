import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { byHungarianName } from "./hungarian-name-sort.util.js";

describe("byHungarianName", () => {
  /**
   * A MERT PANASZ: az ekezetes nevek a lista VEGERE kerultek, nem a
   * helyukre. Ez a mintaeset pontosan azt a torzitast adna, ha az
   * osszehasonlitas nem magyar lokal szerint futna.
   */
  it("az ékezetes nevek a HELYÜKRE kerülnek, nem a lista végére", () => {
    const input = [
      { name: "Zsivány" },
      { name: "Ábel" },
      { name: "Csenge" },
      { name: "Ágnes" },
    ];

    const sorted = byHungarianName(input).map((row) => row.name);

    assert.deepEqual(sorted, ["Ábel", "Ágnes", "Csenge", "Zsivány"]);
  });

  /**
   * KONTROLL: ugyanaz a bemenet, naiv (lokal nélküli) összehasonlítással
   * MÁS sorrendet ad. E nélkül a fenti állítás egy olyan megvalósításon is
   * zöld maradhatna, ami történetesen ugyanazt a négy nevet adja vissza
   * bármilyen sorrendben.
   */
  it("KONTROLL: a naiv (lokal nélküli) sorrend MÁS, mint a magyar ABC", () => {
    const names = ["Zsivány", "Ábel", "Csenge", "Ágnes"];

    const naive = [...names].sort();

    assert.notDeepEqual(naive, ["Ábel", "Ágnes", "Csenge", "Zsivány"]);
  });

  it("nem módosítja az eredeti tömböt", () => {
    const input = [{ name: "Zsóka" }, { name: "Aladár" }];

    byHungarianName(input);

    assert.deepEqual(
      input.map((row) => row.name),
      ["Zsóka", "Aladár"],
    );
  });
});
