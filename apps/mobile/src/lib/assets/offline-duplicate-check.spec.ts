import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkScannedCodeOffline,
  describeOfflineCheck,
} from "./offline-duplicate-check";

/**
 * A KETTOS FELVITEL A TET, ES A PINCEBEN NINCS TERERO.
 *
 * Balazs szava (2026-09-03): "amig az nincs kesz nem nagyon tudjuk hasznalni az
 * uj eszkoz rogziteset egy pinceben". Ha a telefon nem nez ra a mar letoltott
 * eszkozokre, ugyanaz a matricakod ketszer kerul fel, es a hiba a szinkronnal
 * derul ki -- akkor, amikor a masodik felvitel mar megtortent.
 */

const LISTASOR = { id: "asset_1" };
const ADATLAP = { id: "asset_2" };

describe("a beolvasott kód ellenőrzése a gyorsítótár ellen", () => {
  it("TALÁLATNÁL megáll, és megnevezi az eszközt", () => {
    /*
      EZ AZ AG A MEGNYITOTT ADATLAPOT hasznalja (`detail`), a lenti allitas a
      LISTASORT (`summary`). A ket fixture szandekosan KULONBOZO: elsore mindketto
      csak `summary`-t adott, es akkor egy celzott rontas MINDKETTOT kipirositotta
      -- vagyis a ket allitas ugyanazt az utat jarta, es nem tudtuk, mit merunk.
    */
    const v = checkScannedCodeOffline({
      found: { detail: ADATLAP, summary: null },
      cachedCount: 400,
      syncedAt: "2026-09-03T06:00:00Z",
    });
    assert.equal(v.allowed, false);
    assert.equal(v.conflictingAssetId, "asset_2");
  });

  it("a LISTASOR is találat, nem csak a megnyitott adatlap", () => {
    /*
      MI PIROSIT: ha valaki csak a `detail` mezot nezi. A `detail` CSAK azoknal
      all, akiket tereróvel megnyitottak; a `summary` minden mentett eszkoznel.
      A `detail`-re szukitett ellenorzes tehat a kodok TOBBSEGERE azt mondana,
      hogy szabad -- epp azokra, amiket soha nem nyitottak meg.
    */
    const v = checkScannedCodeOffline({
      found: { detail: null, summary: LISTASOR },
      cachedCount: 10,
      syncedAt: null,
    });
    assert.equal(v.allowed, false);
  });

  it("NEM találatnál ENGED, de kiírja, hány eszköz ellen ellenőrzött", () => {
    const v = checkScannedCodeOffline({
      found: null,
      cachedCount: 400,
      syncedAt: "2026-09-03T06:00:00Z",
    });
    assert.equal(v.allowed, true);
    assert.equal(v.conflictingAssetId, null);
    assert.equal(v.checkedAgainst, 400);
    const szoveg = describeOfflineCheck(v);
    assert.match(szoveg, /400 eszköz ellen/);
    assert.match(szoveg, /a szinkron dönti el/);
  });

  it("ÜRES gyorsítótárnál NEM ugyanazt mondja, mint egy teli ellen", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN. Egy "nem talaltam egyezest"
      mondat NULLA eszkoz ellen is igaz -- es epp attol veszelyes, hogy
      megnyugtat. A ket allapotot a szoveg valasztja szet, mert a `allowed`
      mindkettoben igaz.
    */
    const ures = describeOfflineCheck(
      checkScannedCodeOffline({ found: null, cachedCount: 0, syncedAt: null }),
    );
    const teli = describeOfflineCheck(
      checkScannedCodeOffline({
        found: null,
        cachedCount: 400,
        syncedAt: null,
      }),
    );
    assert.match(ures, /NEM tudtam\s+ellenőrizni|NEM tudtam ellenőrizni/);
    assert.notEqual(ures, teli);
    // ISMERT POZITIV KONTROLL: a teli eset SZAMOT mond, tehat a ket ag
    // tenylegesen kulonbozik, nem csak a szohasznalatban.
    assert.match(teli, /400/);
  });

  it("a másolat KORÁT is kiírja, ha ismert", () => {
    const v = checkScannedCodeOffline({
      found: null,
      cachedCount: 12,
      syncedAt: "2026-09-03T06:00:00Z",
    });
    assert.match(describeOfflineCheck(v), /2026-09-03T06:00:00Z/);
  });
});
