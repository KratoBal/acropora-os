import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideOfflineRecord, describeQueueWrite } from "./offline-record";
import { operationId } from "../offline/sync-queue";

/**
 * HAROM HIBA, MIND CSENDES, ES MIND UGYANUGY NEZ KI A TELEFONON: "elmentve".
 *
 *   ket felvitel ugyanazzal a koddal
 *   ket rekord ugyanabbol a felvitelbol (mas azonosito az urlapon es a sorban)
 *   a sorba tetel elbukik, es a felvitel SEHOL nem letezik
 */

const MOST = "2026-09-03T10:00:00Z";

describe("az offline felvitel döntése", () => {
  it("ismert kódnál MEGÁLL, és megnevezi az eszközt", () => {
    const d = decideOfflineRecord({
      qrToken: "QR-A",
      scannedAt: MOST,
      cached: { detail: null, summary: { id: "asset_1" } },
      cachedCount: 400,
      syncedAt: MOST,
    });
    assert.equal(d.type, "blocked");
    assert.equal(d.type === "blocked" && d.conflictingAssetId, "asset_1");
  });

  it("ismeretlen kódnál ENGED, és a mondat megmondja, mihez képest", () => {
    const d = decideOfflineRecord({
      qrToken: "QR-B",
      scannedAt: MOST,
      cached: null,
      cachedCount: 400,
      syncedAt: MOST,
    });
    assert.equal(d.type, "queueable");
    assert.match(d.message, /400 eszköz ellen/);
  });

  it("az azonosító UGYANAZ, amit a szinkron használ", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN, es a legkonnyebben elromlo.

      Ha az urlap sajat ideiglenes azonositot adna, egy megismetelt kuldes KET
      rekordot csinalna a szerveren. A hiba a felviteltol tavol, a szinkronban
      latszana -- es semmi nem mutatna, hogy a ket azonosito valaha kulonbozott.

      MI PIROSIT: barmilyen sajat kulcs-eloallitas az urlapon.
    */
    const d = decideOfflineRecord({
      qrToken: "QR-B",
      scannedAt: MOST,
      cached: null,
      cachedCount: 10,
      syncedAt: null,
    });
    assert.equal(
      d.type === "queueable" && d.operationId,
      operationId({ qrToken: "QR-B", scannedAt: MOST }),
    );
  });

  it("ÜRES gyorsítótárnál más mondatot ad, mint egy teli ellen", () => {
    // A #418-bol jovo negyedik eset, ide bekotve: a "nem talaltam egyezest"
    // NULLA eszkoz ellen is igaz.
    const ures = decideOfflineRecord({
      qrToken: "QR-B",
      scannedAt: MOST,
      cached: null,
      cachedCount: 0,
      syncedAt: null,
    });
    assert.match(ures.message, /NEM tudtam ellenőrizni/);
  });
});

describe("a sorba tétel válasza", () => {
  it("sikeres sorba tételnél kimondja, hogy VÁR feltöltésre", () => {
    const o = describeQueueWrite(
      { ok: true, operationId: "op1" },
      "Ezt a kódot 400 eszköz ellen ellenőriztem.",
    );
    assert.equal(o.type, "queued");
    assert.match(o.message, /vár feltöltésre/);
  });

  it("a sorba tétel BUKÁSA nem 'elmentve', hanem ELVESZETT", () => {
    /*
      A felhasznalo mindket esetben elkuldte a felvitelt. Ha ugyanazt a zold
      uzenetet kapna, tovabbmenne -- es az eszkoz SEHOL nem letezne: sem a
      szerveren, sem a telefonon.
    */
    const o = describeQueueWrite(
      { ok: false, error: "megtelt a tároló" },
      "Ezt a kódot 400 eszköz ellen ellenőriztem.",
    );
    assert.equal(o.type, "queue-failed");
    assert.match(o.message, /NEM sikerült/);
    assert.match(o.message, /elveszett/);
    // ES NEM MONDJA, hogy var feltoltesre -- ez a testver-kontroll.
    assert.doesNotMatch(o.message, /vár feltöltésre/);
  });
});
