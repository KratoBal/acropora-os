import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A KESZULEK FELE NEZO HIVASOK EGY HELYEN ALLNAK.
 *
 * === A MERT ALLAPOT, AMI EZT KIVALTOTTA (2026-09-17) ===
 *
 * Hat kepernyo tolt fel fenykepet. Negy a kozos horgot hasznalta, KETTO viszont
 * sajat kezzel kerte az engedelyt es inditotta a valasztot: az eszkoz es a
 * hibajegy adatlapja. Ugyanaz a nyolc sor, ketszer.
 *
 * MIERT SZAMIT: a #772 pont egy ilyen masolt reszben allitott valamit, es EGY
 * helyen ment be. Ha a tobbi masolat elter, a javitas nem all mindenhol -- es
 * ezt ugy talaljak meg, hogy az egyik kepernyon megy a feltoltes, a masikon
 * nem. Ket egymas utani csalodas egy dologrol.
 *
 * === MIERT FORRAS-SZOVEG, ES MI A HATARA ===
 *
 * A mobil tesztsorban nincs kepernyo-renderelo, tehat a bekotes csak a forras
 * alakjabol merheto. Ugyanaz a minta, amit a
 * `lib/offline/list-source-wiring.spec.ts` hasznal -- es ugyanaz a kikotes: ha
 * egyszer lesz renderelo, ezt VISELKEDESRE kell cserelni, nem melle tenni.
 *
 * A KOMMENTEKET KISZEDJUK, mert a sajat magyarazo szovegunk ugyanazokat a
 * szavakat hasznalja, amiket a kereses keres -- ma delelott negyszer bukott el
 * hamisan egy meres pontosan ettol.
 */

const SRC = "src";
const KOZOS = "src/lib/photos/pick-photos.ts";

/** Ezek a hivasok a keszulekkel beszelnek, es csak a kozos modulban allhatnak. */
const KESZULEK_HIVASOK = [
  "launchCameraAsync",
  "launchImageLibraryAsync",
  "requestCameraPermissionsAsync",
  "requestMediaLibraryPermissionsAsync",
];

/** A blokk- es sor-kommentek nelkuli kod. */
function kodSzoveg(forras: string): string {
  return forras.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function forrasFajlok(mappa: string): string[] {
  const talalt: string[] = [];
  for (const bejegyzes of readdirSync(mappa)) {
    const ut = join(mappa, bejegyzes);
    if (statSync(ut).isDirectory()) {
      talalt.push(...forrasFajlok(ut));
      continue;
    }
    if (/\.tsx?$/.test(bejegyzes) && !/\.spec\.tsx?$/.test(bejegyzes))
      talalt.push(ut);
  }
  return talalt;
}

describe("a keszulek fele nezo kep-valaszto", () => {
  /**
   * POZITIV KONTROLL, ES A LISTA ELSO SORA: a kozos modul TENYLEG tartalmazza
   * mind a negy hivast. Enelkul az alabbi allitas egy URES modul mellett is
   * teljesulne -- es akkor azt merne, hogy sehol nincs valaszto, nem azt, hogy
   * egy helyen van.
   */
  it("a közös modul mind a négy készülék-hívást tartalmazza", () => {
    const kod = kodSzoveg(readFileSync(KOZOS, "utf8"));
    for (const hivas of KESZULEK_HIVASOK)
      assert.ok(kod.includes(hivas), `hiányzik a közös modulból: ${hivas}`);
  });

  /**
   * ES A TOBBI FAJLBAN NEM ALLHAT.
   *
   * MI PIROSIT: egy hetedik masolat. Az uzenet NEVEN nevezi a fajlt es a
   * hivast, mert egy puszta "valahol tobb van" nem mondja meg, hol.
   *
   * A HIBAJEGY ADATLAPJA MA MEG KIVETEL, es ez KIMONDVA all, nem elhallgatva:
   * azt a fajlt nautilus gallery-kartyaja (cc118129) is nyitva tarthatja,
   * tehat kulon korben vezetjuk at. Amikor az megtortenik, ezt a kivetelt
   * TOROLNI kell -- es ha valaki elfelejti, ez az allitas tovabbra is zold
   * marad, tehat a torles nem magatol ertetodo.
   */
  it("a képernyők nem hívják közvetlenül a választót", () => {
    const KIVETEL = "src/app/service-jobs/[id].tsx";
    const vetkesek: string[] = [];

    for (const fajl of forrasFajlok(SRC)) {
      if (fajl === KOZOS || fajl === KIVETEL) continue;
      const kod = kodSzoveg(readFileSync(fajl, "utf8"));
      for (const hivas of KESZULEK_HIVASOK)
        if (kod.includes(hivas)) vetkesek.push(`${fajl}: ${hivas}`);
    }

    assert.deepEqual(
      vetkesek,
      [],
      `A képernyő közvetlenül hívja a választót. Használd a lib/photos/pick-photos.ts függvényeit:\n  ${vetkesek.join("\n  ")}`,
    );
  });

  /**
   * A KIVETEL MAGA IS ALLITAS -- KULONBEN CSENDBEN TULELNE A SAJAT OKAT.
   *
   * Ha a hibajegy adatlapja MAR atvezetodott, ez az allitas pirosra valt, es a
   * kovetkezo ember a KIVETELT torli, nem a mai allapotot irja at. Egy kivetel,
   * amit senki nem mer, evekig allhat ugy, hogy az indoka regen megszunt.
   */
  it("a hibajegy adatlapja MA még kivétel, és ezt mérjük is", () => {
    const kod = kodSzoveg(
      readFileSync("src/app/service-jobs/[id].tsx", "utf8"),
    );
    const meg_kezi = KESZULEK_HIVASOK.filter((hivas) => kod.includes(hivas));
    assert.notDeepEqual(
      meg_kezi,
      [],
      "A hibajegy adatlapja már nem hívja közvetlenül a választót: vedd ki a KIVETEL sorból a fenti állításban, és töröld ezt az állítást.",
    );
  });
});
