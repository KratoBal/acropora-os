import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inlineJelentes,
  olvashatoMeret,
  type SorOsszegzes,
} from "./inline-document-report.js";

const SOROK: SorOsszegzes[] = [
  { owner: "asset", sorbanAllo: 3, sorbanAlloBajt: 3_000, tarolon: 10 },
  { owner: "worksheet", sorbanAllo: 2, sorbanAlloBajt: 2_000, tarolon: 0 },
  { owner: "service-job", sorbanAllo: 0, sorbanAlloBajt: 0, tarolon: 5 },
];

describe("a sorban allo dokumentumok jelentese", () => {
  it("osszead, es a nevezot is megtartja", () => {
    const j = inlineJelentes(SOROK);
    assert.equal(j.osszesSorbanAllo, 5);
    assert.equal(j.osszesSorbanAlloBajt, 5_000);
    assert.equal(j.osszesTarolon, 15);
  });

  /**
   * A NEVEZO NELKUL A SZAM ERTELMEZHETETLEN, es ezert all kulon allitas rajta:
   * egy "ot sor" onmagaban nem mondja meg, hogy az a keszlet negyede vagy az
   * ezredresze. Egy olyan valtozat, ami csak a sorban allokat adja ossze,
   * pontosan ezen bukik el.
   */
  it("a tarolon allo sorokat is megszamolja, nem csak a sorban allokat", () => {
    assert.equal(inlineJelentes(SOROK).osszesTarolon, 15);
  });

  /** A soronkenti bontas megmarad: egy osszeg nem mondja meg, MELYIK tablarol van szo. */
  it("a soronkenti bontas nem vesz el", () => {
    const j = inlineJelentes(SOROK);
    assert.deepEqual(
      j.soronkent.map((s) => s.owner),
      ["asset", "worksheet", "service-job"],
    );
  });

  it("ures bemeneten nullat ad, nem hibazik", () => {
    const j = inlineJelentes([]);
    assert.equal(j.osszesSorbanAllo, 0);
    assert.equal(j.osszesSorbanAlloBajt, 0);
    assert.equal(j.osszesTarolon, 0);
  });

  it("a meret olvashato alakja a hatarokon is helyes", () => {
    assert.equal(olvashatoMeret(0), "0 B");
    assert.equal(olvashatoMeret(1023), "1023 B");
    assert.equal(olvashatoMeret(1024), "1.0 kB");
    assert.equal(olvashatoMeret(1024 * 1024), "1.0 MB");
    assert.equal(olvashatoMeret(3 * 1024 * 1024 * 1024), "3.0 GB");
  });
});
