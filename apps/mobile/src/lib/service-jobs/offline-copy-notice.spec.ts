import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { OFFLINE_COPY_NOTICE } from "./offline-copy-notice";

/**
 * A MENTETT MÁSOLAT SOHA NEM NÉMA -- ÉS EZ AZ ÁLLÍTÁS AZÉRT VAN, MERT EGYSZER
 * MÁR AZ VOLT.
 *
 * A hibajegy lapjának első alakjában a léptetés KIMONDTA, miért nem megy térerő
 * nélkül, a fénykép-szakasz viszont a `!masolatbol` feltétel mögött EGYETLEN SZÓ
 * NÉLKÜL eltűnt. Egy hiányzó gomb ugyanúgy néz ki, mint egy elromlott -- és a
 * szerelő a helyszínen nem tudja eldönteni, melyikről van szó.
 *
 * MIÉRT A FORRÁS SZÖVEGÉBŐL: ebben a csomagban nincs komponens-teszt eszköz. A
 * határa kimondva: azt állítja, hogy a képernyő HASZNÁLJA a mondatokat, nem azt,
 * hogy a felhasználó LÁTJA őket -- egy elrejtett szülő ezt nem venné észre.
 */
/**
 * A FORRASFAT OLVASSA, NEM A LEFORDITOTT KIMENETET.
 *
 * A `__dirname` futasidoben a `test-dist/lib/service-jobs` mappa, tehat HAROM
 * szintet kell felfele lepni a csomag gyokereig, es onnan a `src` ala. Az elso
 * alakom kettot lepett, es a `test-dist`-ben keresett egy `.tsx` fajlt, ami ott
 * nincs is.
 *
 * A POZITIV KONTROLL EPP EZT FOGTA MEG, es ezert all a tobbi allitas ELOTT: az
 * OLVASAST nevezte meg, nem hagyta, hogy harom allitas ures szovegen fusson
 * vegig -- azok kulonben ZOLDEN mondtak volna, hogy minden rendben.
 */
const KEPERNYO = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "service-jobs",
  "[id].tsx",
);

function kepernyo(): string {
  try {
    return readFileSync(KEPERNYO, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${KEPERNYO}. Ez a KERESÉS hibája, nem a lefedettségé -- az alábbi állítások addig semmit nem mondanak.`,
    );
  }
}

describe("a mentett másolat kimondja, mi nem megy", () => {
  it("POZITÍV KONTROLL: a képernyő olvasható és nem üres", () => {
    assert.ok(kepernyo().length > 2000, "a képernyő üres vagy gyanúsan rövid");
  });

  /**
   * MIND A KÉT MONDATOT HASZNÁLJA -- ÉS EZ AZ, AMI AZ EREDETI HIBÁT MEGFOGTA
   * VOLNA. A `photo` sor hiánya pontosan az az állapot volt, amiben a szakasz
   * némán eltűnt.
   */
  it("a képernyő MINDEN mondatot kitesz, amit a tábla hordoz", () => {
    const forras = kepernyo();
    /**
     * A KULCSOKAT A TABLABOL VESSZUK, NEM KEZZEL FELSOROLVA.
     *
     * A kezzel irt lista pontosan azt a hibat engedne vissza, ami miatt ez a
     * fajl letezik: egy UJ mondat felkerul a tablara, a kepernyo nem hasznalja,
     * es az allitas -- ami csak a regi ket kulcsot nezi -- ZOLD marad. A
     * kiesett muvelet megint nemán tunne el.
     */
    const kulcsok = Object.keys(OFFLINE_COPY_NOTICE);
    // POZITIV KONTROLL: ures kulcs-halmazon a lenti ciklus zolden allna.
    assert.ok(
      kulcsok.length >= 3,
      `gyanúsan kevés mondat a táblán: ${kulcsok.join(", ")}`,
    );
    for (const kulcs of kulcsok)
      assert.match(
        forras,
        new RegExp(`OFFLINE_COPY_NOTICE\\.${kulcs}`),
        `a képernyő nem használja a(z) "${kulcs}" mondatot: egy kieső művelet némán tűnik el`,
      );
  });

  /**
   * A FÉNYKÉP-SZAKASZ NEM A MÁSOLAT-ÁLLAPOTRA VAN KAPUZVA.
   *
   * Ez a hiba KONKRÉT alakja volt: `serviceJobsManage && !masolatbol`. A gomb
   * lehet TILTVA, a szakasz nem tűnhet el -- különben nincs hol megjelennie a
   * mondatnak.
   */
  it("a fénykép-szakasz nem esik ki a másolat miatt", () => {
    assert.doesNotMatch(
      kepernyo(),
      /serviceJobsManage\s*&&\s*!masolatbol/,
      "a fénykép-szakasz megint a másolat-állapotra van kapuzva: némán tűnne el",
    );
  });

  /**
   * A MONDATOK A JELEN ÁLLAPOTRÓL SZÓLNAK, NEM A VILÁGRÓL.
   *
   * acrobot kikötése (2026-09-16): ha a szöveg úgy szólna, hogy „térerő nélkül
   * nem lehet fényképet rögzíteni", és holnap megépül az offline fényképezés,
   * a mondat HAZUDNI kezdene. Ezért mind a kettő azzal kezdődik, hogy MIT nézel
   * most -- az az állítás akkor is igaz marad, amikor ez az ág már elő sem áll.
   */
  it("a mondatok a mentett másolatra hivatkoznak, nem általános tiltásra", () => {
    for (const szoveg of Object.values(OFFLINE_COPY_NOTICE)) {
      assert.match(szoveg, /Mentett másolatot nézel/);
      assert.match(szoveg, /most nem/);
      // ÁLTALÁNOS TILTÁST NE ÁLLÍTSON: az elavulna egy új képességgel.
      assert.doesNotMatch(szoveg, /nem lehet|soha|egyáltalán/);
    }
  });

  it("mind a két mondat megmondja, MIKOR megy", () => {
    // A TEENDŐ NÉLKÜL a mondat csak közli a kudarcot. A "térerőnél" az az egy
    // szó, amiből a szerelő tudja, mit kezdjen magával.
    for (const szoveg of Object.values(OFFLINE_COPY_NOTICE))
      assert.match(szoveg, /érerőnél/);
  });
});
