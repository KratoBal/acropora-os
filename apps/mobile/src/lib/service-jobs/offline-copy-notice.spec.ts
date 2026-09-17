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
  it("a képernyő MIND A KÉT mondatot kiteszi", () => {
    const forras = kepernyo();
    for (const kulcs of ["step", "photo"] as const)
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
  /**
   * A KET MONDAT SZABALYA 2026-09-17 OTA KULONBOZIK, ES EZ NEM LAZITAS.
   *
   * Korabban mindkettore ugyanaz allt: "most nem" megy, es "tereronel" fog. A
   * FENYKEP viszont azota SORBA KERUL terero nelkul is, tehat az a kikotes
   * epp a helyes mondatot utasitotta volna el -- a regi allitas pirosa
   * BIZONYITEK volt, nem javitando hiba.
   *
   * A LEPTETESRE VALTOZATLANUL ALL: az a szerveren a LATOTT allapotra ir
   * feltetelesen, tehat NEM sorbol valo, es terero nelkul tenylegesen nem megy.
   *
   * AMI MIND A KETTOBEN KOZOS, es ezert maradt kozos allitas: a mondat a JELEN
   * allapotrol szoljon (mentett masolatot nezel), ne altalanos tiltasrol -- es
   * mondja meg a TEENDOT, kulonben csak kozli a kudarcot.
   */
  it("mind a két mondat a mentett másolatra hivatkozik, nem általános tiltásra", () => {
    for (const szoveg of Object.values(OFFLINE_COPY_NOTICE)) {
      assert.match(szoveg, /Mentett másolatot nézel/);
      assert.doesNotMatch(szoveg, /nem lehet|soha|egyáltalán/);
    }
  });

  it("a léptetés megmondja, hogy térerőnél megy", () => {
    assert.match(OFFLINE_COPY_NOTICE.step, /most nem/);
    assert.match(OFFLINE_COPY_NOTICE.step, /érerőnél/);
  });

  /**
   * A FENYKEP VISZONT NEM TILTOTT, ES EZT KI IS KELL MONDANI: ha csak annyit
   * mondanank, hogy "mentett masolatot nezel", a szerelo azt hinne, hogy a kep
   * NEM megy -- es nem is probalna meg, epp ott, ahol a sor a legtobbet erne.
   */
  it("a fénykép mondata megmondja, hogy a kép magától felmegy", () => {
    assert.match(OFFLINE_COPY_NOTICE.photo, /magától felmegy/);
    assert.doesNotMatch(OFFLINE_COPY_NOTICE.photo, /nem tölthető/);
  });
});
