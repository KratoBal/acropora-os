import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideProjectionDue } from "./medusa-projection-due.js";

const T = (iso: string) => new Date(iso);

describe("decideProjectionDue", () => {
  /**
   * A HAROM KIMENET KULON ALLITAST KAP, mert harom kulon sor viszi oket, es egy
   * osszevont allitas nem mondana meg, MELYIK romlott el.
   */
  it("a soha nem vetitett termek esedekes, es ezt kulon indokkal mondja", () => {
    const dontes = decideProjectionDue({
      lastProjectedAt: null,
      sourceTimestamps: [T("2026-09-04T08:00:00.000Z")],
    });

    assert.equal(dontes.due, true);
    assert.equal(dontes.reason, "NEVER_PROJECTED");
  });

  it("ha a forras a vetites UTAN valtozott, esedekes", () => {
    const dontes = decideProjectionDue({
      lastProjectedAt: T("2026-09-04T08:00:00.000Z"),
      sourceTimestamps: [T("2026-09-04T09:00:00.000Z")],
    });

    assert.equal(dontes.due, true);
    assert.equal(dontes.reason, "SOURCE_CHANGED");
  });

  it("ha a vetites frissebb minden forrasnal, NEM esedekes", () => {
    const dontes = decideProjectionDue({
      lastProjectedAt: T("2026-09-04T10:00:00.000Z"),
      sourceTimestamps: [
        T("2026-09-04T08:00:00.000Z"),
        T("2026-09-04T09:00:00.000Z"),
      ],
    });

    assert.equal(dontes.due, false);
    assert.equal(dontes.reason, "UP_TO_DATE");
  });

  /**
   * EZ AZ ALLITAS A JEL VALASZTASAT MERI, NEM A FUGGVENYT.
   *
   * A `Product` sor idobelyege REGEBBI a vetitesnel, egyedul egy RELACIOE
   * frissebb -- ez pontosan az az eset, amit egy `Product.updatedAt` alapu jel
   * NEM latna. A vetites bemenete het relaciobol jon, es a `Product` sor akkor
   * sem mozdul, ha azok valtoznak.
   */
  it("egy RELACIO valtozasa is esedekesse tesz, nem csak a termek soraé", () => {
    const dontes = decideProjectionDue({
      lastProjectedAt: T("2026-09-04T09:00:00.000Z"),
      sourceTimestamps: [
        T("2026-09-04T08:00:00.000Z"), // Product.updatedAt -- REGEBBI
        T("2026-09-04T09:30:00.000Z"), // ProductVariant.updatedAt -- FRISSEBB
      ],
    });

    assert.equal(dontes.due, true);
    assert.equal(dontes.reason, "SOURCE_CHANGED");
    assert.deepEqual(dontes.latestSourceChange, T("2026-09-04T09:30:00.000Z"));
  });

  /**
   * A HIANYZO IDOBELYEG NEM TESZ ESEDEKESSE. A `sourceTimestamps` elemei
   * lehetnek `null` vagy `undefined` ertekuek (egy termeknek nem kell tukre
   * vagy csatorna-sora), es egy hianyzo ertek NEM jelent valtozast -- kulonben
   * minden tukor nelkuli termek minden korben ujra kimenne.
   */
  it("a hianyzo forras-idobelyeg nem tesz esedekesse", () => {
    const dontes = decideProjectionDue({
      lastProjectedAt: T("2026-09-04T09:00:00.000Z"),
      sourceTimestamps: [null, undefined, T("2026-09-04T08:00:00.000Z")],
    });

    assert.equal(dontes.due, false);
    assert.equal(dontes.reason, "UP_TO_DATE");
  });

  /**
   * ES A HATARESET: AZONOS IDOBELYEG NEM ESEDEKES.
   *
   * A vetites a sajat `lastSyncedAt` erteket a futas idejevel irja, tehat egy
   * ugyanabban a masodpercben zart forras-iras egyenlo lehet vele. Ha az
   * esedekesseget `>=` dontene el, minden termek MINDEN korben ujra kimenne --
   * es a hiba NEMA lenne: a bolt ugyanazt kapna megegyszer, hibauzenet nelkul.
   */
  it("azonos idobelyegnel nem esedekes", () => {
    const azonos = T("2026-09-04T09:00:00.000Z");
    const dontes = decideProjectionDue({
      lastProjectedAt: azonos,
      sourceTimestamps: [new Date(azonos.getTime())],
    });

    assert.equal(dontes.due, false);
    assert.equal(dontes.reason, "UP_TO_DATE");
  });
});
