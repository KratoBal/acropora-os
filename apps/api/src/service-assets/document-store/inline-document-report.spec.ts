import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inlineJelentes,
  olvashatoMeret,
  type SorOsszegzes,
} from "./inline-document-report.js";

const SOROK: SorOsszegzes[] = [
  {
    owner: "asset",
    sorbanAllo: 3,
    sorbanAlloBajt: 3_000,
    sorbanAlloNyersBajt: 3_100,
    mindketHelyen: 4,
    mindketHelyenBajt: 4_000,
    mindketHelyenNyersBajt: 4_000,
    csakTarolon: 10,
    egyikSem: 0,
  },
  {
    owner: "worksheet",
    sorbanAllo: 2,
    sorbanAlloBajt: 2_000,
    sorbanAlloNyersBajt: 2_000,
    mindketHelyen: 0,
    mindketHelyenBajt: 0,
    mindketHelyenNyersBajt: 0,
    csakTarolon: 0,
    egyikSem: 1,
  },
  {
    owner: "service-job",
    sorbanAllo: 0,
    sorbanAlloBajt: 0,
    sorbanAlloNyersBajt: 0,
    mindketHelyen: 0,
    mindketHelyenBajt: 0,
    mindketHelyenNyersBajt: 0,
    csakTarolon: 5,
    egyikSem: 0,
  },
];

describe("a sorban allo dokumentumok jelentese", () => {
  it("osszead, es a nevezot is megtartja", () => {
    const j = inlineJelentes(SOROK);
    assert.equal(j.osszesSorbanAllo, 5);
    assert.equal(j.osszesSorbanAlloBajt, 5_000);
    assert.equal(j.osszesCsakTarolon, 15);
  });

  /**
   * A KET HALMAZ NEM OLVAD OSSZE, ES EZ A KESZLET LEGFONTOSABB ALLITASA.
   *
   * A "mar mindket helyen" sorokhoz SEMMILYEN athelyezes nem kell: ott a
   * tartalom atkerult, es a sorbeli peldany MA torolheto. Ha egy valtozat ezeket
   * a `sorbanAllo`-hoz adna (vagy a `csakTarolon`-hoz, ahol a bajtjaik SEHOVA
   * nem szamitanak), a dontes a dragabb feltevesbol indulna -- ez az allitas
   * pontosan azon bukna el.
   */
  it("a mar athelyezett, de meg sorban is allo tartalom kulon szamot kap", () => {
    const j = inlineJelentes(SOROK);
    assert.equal(j.osszesMindketHelyen, 4);
    assert.equal(j.osszesMindketHelyenBajt, 4_000);
    assert.notEqual(j.osszesSorbanAllo, j.osszesMindketHelyen);
  });

  /**
   * ES A SERULT SOR SEM TUNIK EL EGY OSSZEGBEN. Se tartalom, se kulcs: ezt a
   * `exactly_one_content_source` megkotes zarja ki, tehat egy nem-nulla szam
   * itt nem athelyezesi kerdes, hanem lelet.
   */
  it("az egyik helyen sem allo sor sajat szamot kap", () => {
    assert.equal(inlineJelentes(SOROK).osszesEgyikSem, 1);
  });

  /**
   * A NEVEZO NELKUL A SZAM ERTELMEZHETETLEN, es ezert all kulon allitas rajta:
   * egy "ot sor" onmagaban nem mondja meg, hogy az a keszlet negyede vagy az
   * ezredresze. Egy olyan valtozat, ami csak a sorban allokat adja ossze,
   * pontosan ezen bukik el.
   */
  it("a tarolon allo sorokat is megszamolja, nem csak a sorban allokat", () => {
    assert.equal(inlineJelentes(SOROK).osszesCsakTarolon, 15);
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
    assert.equal(j.osszesMindketHelyen, 0);
    assert.equal(j.osszesCsakTarolon, 0);
    assert.equal(j.osszesEgyikSem, 0);
  });

  it("a meret olvashato alakja a hatarokon is helyes", () => {
    assert.equal(olvashatoMeret(0), "0 B");
    assert.equal(olvashatoMeret(1023), "1023 B");
    assert.equal(olvashatoMeret(1024), "1.0 kB");
    assert.equal(olvashatoMeret(1024 * 1024), "1.0 MB");
    assert.equal(olvashatoMeret(3 * 1024 * 1024 * 1024), "3.0 GB");
  });
});
