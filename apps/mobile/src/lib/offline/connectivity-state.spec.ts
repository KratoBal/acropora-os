import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  initialConnectivity,
  nextConnectivity,
  OFFLINE_CONFIRM_MS,
  reportSaysOffline,
} from "./connectivity-state";

const OFFLINE = { isConnected: true, isInternetReachable: false };
const ONLINE = { isConnected: true, isInternetReachable: true };
const BIZONYTALAN = { isConnected: true, isInternetReachable: null };

describe("a kapcsolat-jelzes", () => {
  /**
   * A MERT HIBA: Balazs mukodo halozat mellett latta a "Nincs kapcsolat" savot
   * (2026-09-02, a 13:33-as build). A NetInfo `isInternetReachable` mezoje
   * atmenetileg hamis tud lenni; egyetlen ilyen jelentes NEM allapot.
   */
  it("egyetlen hamis jelentestol nem mondja, hogy nincs kapcsolat", () => {
    const utana = nextConnectivity(initialConnectivity, 1000, OFFLINE);

    assert.equal(utana.online, true);
    // ES A MASODIK ALLITAS: a varakozas EL IS INDULT. Enelkul a fenti sor akkor
    // is teljesulne, ha a jelentest egyszeruen eldobnank -- es akkor a VALODI
    // kapcsolat-vesztes sem jutna soha at.
    assert.equal(utana.offlineSince, 1000);
  });

  it("kitarto offline jelentes utan kimondja", () => {
    const elso = nextConnectivity(initialConnectivity, 1000, OFFLINE);
    const kesobb = nextConnectivity(elso, 1000 + OFFLINE_CONFIRM_MS, OFFLINE);

    assert.equal(kesobb.online, false);
  });

  it("a hatarido ELOTT meg nem mondja ki", () => {
    const elso = nextConnectivity(initialConnectivity, 1000, OFFLINE);
    const kozben = nextConnectivity(
      elso,
      1000 + OFFLINE_CONFIRM_MS - 1,
      OFFLINE,
    );

    assert.equal(kozben.online, true);
  });

  /**
   * ASZIMMETRIKUS SZANDEKOSAN: a visszateres azonnali. Egy keson kiirt "megint
   * van kapcsolat" ugyanugy hazudik, csak a masik iranyba -- es ott nincs olyan
   * kar, ami a varakozast indokolna.
   */
  it("a visszateres azonnali, varakozas nelkul", () => {
    const elso = nextConnectivity(initialConnectivity, 1000, OFFLINE);
    const offline = nextConnectivity(elso, 1000 + OFFLINE_CONFIRM_MS, OFFLINE);
    assert.equal(offline.online, false);

    const vissza = nextConnectivity(
      offline,
      1000 + OFFLINE_CONFIRM_MS + 1,
      ONLINE,
    );
    assert.equal(vissza.online, true);
    assert.equal(vissza.offlineSince, null);
  });

  /**
   * A BIZONYTALANSAG ONLINE. Ez a `connectivity.ts` eredeti dontese volt, es
   * valtozatlan: a `null` azt jelenti, hogy a keszulek MEG MERI.
   */
  it("a null bizonytalansagot online-nak veszi", () => {
    assert.equal(reportSaysOffline(BIZONYTALAN), false);
    assert.equal(reportSaysOffline(ONLINE), false);
    // KONTROLL: a hataroott hamis viszont offline jelentes -- kulonben a fenti
    // ket sor akkor is teljesulne, ha a fuggveny MINDIG hamisat adna.
    assert.equal(reportSaysOffline(OFFLINE), true);
    assert.equal(
      reportSaysOffline({ isConnected: false, isInternetReachable: true }),
      true,
    );
  });
});

/**
 * A VALODI SZAKADAS UTJA NEM EZEN A MODULON AT MEGY, ES EZT KI KELL MONDANI.
 *
 * A varakozas a KESZULEK allitasat halasztja. Az elhasalt lekerdezes jele
 * (`query.isError`) fuggetlen tole, es a ket kepernyo `online && !query.isError`
 * alakban vonja ossze -- tehat a valodi szakadas AZONNAL latszik.
 *
 * MIERT SZOVEGBOL: a ket kepernyo React-komponens, es ebben a csomagban nincs
 * renderelo kornyezet. A hatara ugyanaz, mint a tobbi ilyen allitasnak: azt
 * meri, hogy a KOTES ott van, nem azt, hogy jol nez ki.
 *
 * MI PIROSIT: ha valaki "kovetkezetessegbol" a varakozast ratenne a hiba-agra
 * is, vagy kivenne a `!query.isError` reszt -- mindketto a dragabb hibat hozna
 * vissza: egy elhasalt lekerdezes ures listaja NYUGALOMNAK latszik.
 */
describe("a valódi szakadás jele független ettől a modultól", () => {
  const KEPERNYOK = ["src/app/assets/index.tsx", "src/app/assets/[id].tsx"];

  it("mindkét képernyő a kérés hibáját is beleszámítja", () => {
    for (const ut of KEPERNYOK) {
      const forras = readFileSync(ut, "utf8");

      // KONTROLL: a fajl be is toltodott, es tenyleg a savot allitja ossze.
      assert.ok(forras.length > 1000, `${ut}: ures vagy hianyzo fajl`);
      assert.match(forras, /describeOfflineNotice|notice/);

      assert.match(
        forras,
        /online: online && !query\.isError/,
        `${ut}: a sav nem szamitja bele a keres hibajat, tehat egy valodi ` +
          "szakadas ures listakent, nyugalomnak latszana",
      );
    }
  });
});
