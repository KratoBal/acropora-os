import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeQueuedAssetUpdate,
  readQueuedAssetUpdate,
  type QueuedAssetUpdate,
} from "./asset-update-queue";

/**
 * A MERCE: EGY OFFLINE JAVITAS SE TUNJON EL CSENDBEN.
 *
 * A ket fuggveny egyutt azt vedi, hogy a masodik szerkesztes ne irja felul az
 * elsot es ne is essen el. Mindket vesztes NEMA lenne: a szerelo „elmentve"
 * uzenetet latna, es a javitasa sehol nem lenne.
 */

const modositas = (
  patch: Record<string, unknown>,
  assetName = "Szivattyú",
): QueuedAssetUpdate =>
  ({
    assetName,
    patch: { expectedUpdatedAt: "2026-09-04T08:00:00Z", ...patch },
  }) as QueuedAssetUpdate;

describe("a sorban álló eszköz-módosítás törzse", () => {
  it("KÜLÖN mezőkre írt két szerkesztés MINDKETTŐT megtartja", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN.

      A szerelo offline atirja a gyartot, ment, majd eszreveszi, hogy a
      helyszin is rossz. A ket patch KULON mezorol szol, mert mindketto a
      gyorsitotarazott (regi) allapothoz kepest keszult.

      MI PIROSIT: egy `REPLACE` alaku sorba tetel (a gyarto eltunne) es egy
      `INSERT OR IGNORE` alaku is (a helyszin tunne el).
    */
    const eredmeny = mergeQueuedAssetUpdate(
      modositas({ manufacturer: "Grundfos" }),
      modositas({ departmentId: "unit-2" }),
    );

    assert.equal(eredmeny.patch.manufacturer, "Grundfos");
    assert.equal(eredmeny.patch.departmentId, "unit-2");
  });

  it("UGYANARRA a mezőre a későbbi érték nyer", () => {
    // Ha a megorzott elso ertek nyerne, a javitast nem lehetne visszavonni.
    const eredmeny = mergeQueuedAssetUpdate(
      modositas({ manufacturer: "Grundfos" }),
      modositas({ manufacturer: "Wilo" }),
    );

    assert.equal(eredmeny.patch.manufacturer, "Wilo");
  });

  it("a null (törlés) NEM esik ki az összefésülésnél", () => {
    /*
      A `null` a szerverne "töröld ezt a mezot", az `undefined` pedig "hagyd
      bekeen". Egy olyan osszefesules, ami a null erteket hianyzonak veszi,
      CSENDBEN elhagyna a torlest -- a mezo a regi erteken maradna.
    */
    const eredmeny = mergeQueuedAssetUpdate(
      modositas({ manufacturer: "Grundfos" }),
      modositas({ manufacturer: null }),
    );

    assert.equal(eredmeny.patch.manufacturer, null);
    assert.equal("manufacturer" in eredmeny.patch, true);
  });

  it("a név a FRISSEBB olvasásból jön", () => {
    const eredmeny = mergeQueuedAssetUpdate(
      modositas({}, "Szivattyú"),
      modositas({}, "Keringető szivattyú"),
    );

    assert.equal(eredmeny.assetName, "Keringető szivattyú");
  });

  it("a `expectedUpdatedAt` NÉLKÜLI törzs olvashatatlan", () => {
    /*
      A verzio nelkul a szerver nem tudna, MIHEZ KEPEST ir, es pont az a
      vedelem esne ki, amiert a mezo letezik. Egy ilyen sor inkabb alljon meg,
      mint hogy vakon felmenjen.
    */
    const json = JSON.stringify({
      assetName: "Szivattyú",
      patch: { status: "ACTIVE" },
    });

    assert.equal(readQueuedAssetUpdate(json), null);
  });

  it("ISMERT POZITÍV: a teljes törzset felismeri", () => {
    /*
      E NELKUL a fenti nulla-allitas semmit nem mondana: egy fuggveny, ami
      MINDIG null-t ad, ugyanugy atmenne rajta.
    */
    const json = JSON.stringify(modositas({ status: "ACTIVE" }));
    const olvasott = readQueuedAssetUpdate(json);

    assert.notEqual(olvasott, null);
    assert.equal(olvasott?.assetName, "Szivattyú");
    assert.equal(olvasott?.patch.expectedUpdatedAt, "2026-09-04T08:00:00Z");
  });

  it("az értelmezhetetlen JSON null, nem kivétel", () => {
    // A kuldes agan egy kivetel a TELJES kiuritest allitana meg, nem csak ezt
    // az egy sort.
    assert.equal(readQueuedAssetUpdate("{ nem json"), null);
  });
});
