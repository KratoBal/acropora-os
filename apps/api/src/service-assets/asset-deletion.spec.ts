import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assetDeletionRefusal } from "./asset-deletion.js";

const none = { serviceJobs: 0, worksheetLines: 0, childAssets: 0 };

describe("assetDeletionRefusal", () => {
  it("üres eszközre nincs visszatartás", () => {
    assert.equal(assetDeletionRefusal(none), null);
  });

  /**
   * A HAROM AG KULON ALLITAST KAP, ES EZ NEM ALAPOSSAG.
   *
   * Egy osszevont "van rajta valami" ellenorzes eseten mind a harom eset
   * ugyanazt a valaszt adna, tehat egyetlen teszt SEM tudna megkulonboztetni
   * oket: ha valaki elrontja a munkalap-agat, a hibajegyre irt allitas zolden
   * fedne el. Kulon szamlalokkal mindegyik ag onalloan tud elbukni.
   */
  it("mindegyik feltétel ÖNMAGÁBAN visszatart", () => {
    assert.match(
      assetDeletionRefusal({ ...none, serviceJobs: 1 }) ?? "",
      /hibajegy/,
    );
    assert.match(
      assetDeletionRefusal({ ...none, worksheetLines: 1 }) ?? "",
      /munkalapsor/,
    );
    assert.match(
      assetDeletionRefusal({ ...none, childAssets: 1 }) ?? "",
      /alárendelt/,
    );
  });

  /** A visszautasitas MEGMONDJA, mi tartja vissza, nem csak azt, hogy valami. */
  it("több feltétel esetén MINDEGYIKET megnevezi", () => {
    const message =
      assetDeletionRefusal({
        serviceJobs: 2,
        worksheetLines: 3,
        childAssets: 4,
      }) ?? "";
    assert.match(message, /2 hibajegy/);
    assert.match(message, /3 munkalapsor/);
    assert.match(message, /4 alárendelt/);
  });

  /**
   * A NEGATIV SZAM NEM ENGED AT. Egy szamlalo elvben nem lehet negativ, de a
   * feltetel `> 0` alakja miatt egy `>= 0`-ra atirt valtozat csendben mindent
   * atengedne -- ez az allitas az, ami ezt megfogja.
   */
  it("csak a NULLA jelent szabad utat", () => {
    assert.equal(assetDeletionRefusal({ ...none, serviceJobs: 0 }), null);
    assert.notEqual(assetDeletionRefusal({ ...none, serviceJobs: 1 }), null);
  });
});
