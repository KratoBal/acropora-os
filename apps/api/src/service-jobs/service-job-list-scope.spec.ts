import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SERVICE_JOB_LIST_SCOPES,
  serviceJobScopeWhere,
} from "./service-job-list-scope.js";

/**
 * A NEGY HATOKOR FELTETELE -- ADATBAZIS NELKUL.
 *
 * AMIT EZ MER: hogy melyik hatokor MELYIK feltetelt allitja elo, es hogy a
 * negy kozul harom TENYLEG szukit. Ez tiszta fuggveny, tehat itt merheto.
 *
 * AMIT EZ NEM MER, ES KI KELL MONDANI: hogy a Prisma ebbol a feltetelbol
 * helyes SQL-t epit, es hogy a `mine` ag a valodi kapcsolotablan talal. Az
 * mar adatbazis-kerdes, es a `service-job-assignees.integration.spec.ts`
 * meri, a CI-ben. Egy zold itt tehat NEM azt jelenti, hogy a szures mukodik.
 */
describe("a hibajegy-lista hatokorei", () => {
  it("a nyitott es a lezart PONTOSAN egymas tukre", () => {
    const nyitott = serviceJobScopeWhere("open", "user-1");
    const lezart = serviceJobScopeWhere("closed", "user-1");

    assert.deepEqual(nyitott, {
      status: { notIn: ["COMPLETED", "CANCELLED"] },
    });
    assert.deepEqual(lezart, { status: { in: ["COMPLETED", "CANCELLED"] } });
  });

  /**
   * AZ `osszes` NEM SZURHET SEMMIRE, es ez nem stilus: a hivo `AND` agba teszi
   * az eredmenyt, tehat barmilyen kulcs, ami ide kerul, CSENDBEN szukitene a
   * legtagabb listat.
   */
  it("az osszes ures feltetelt ad, tehat nem szukit", () => {
    assert.deepEqual(serviceJobScopeWhere("all", "user-1"), {});
  });

  /**
   * A KIOSZTAS A KAPCSOLOTABLAROL JON, NEM A JEGY `assignedUserId` OSZLOPAROL.
   *
   * MI PIROSIT: ha valaki a halott oszlopra irja at. Az a valtozat SEMMILYEN
   * hibat nem adna -- a lista egyszeruen mindig ures lenne, ami pontosan ugy
   * nez ki, mint "nincs rad kiosztva semmi".
   */
  it("a ram kiosztva a kapcsolotablan keres, a bejelentkezett emberre", () => {
    assert.deepEqual(serviceJobScopeWhere("mine", "user-7"), {
      assignees: { some: { userId: "user-7" } },
    });
  });

  /**
   * MINDEN FELSOROLT HATOKORNEK VAN FELTETELE.
   *
   * A `switch` `default` ag NELKUL all, tehat egy uj ertek forditasi hibat ad
   * -- ez az allitas az, ami a FUTASIDOT is lefedi, ha valaki a forditot
   * megkerulne. Egyben pozitiv kontroll a felsorolasra: ha a lista valaha
   * kiurulne, ez a ciklus nulla korrel menne at, es azt a darabszam fogja meg.
   */
  it("mind a negy hatokor ad feltetelt", () => {
    assert.equal(SERVICE_JOB_LIST_SCOPES.length, 4);
    for (const scope of SERVICE_JOB_LIST_SCOPES) {
      assert.equal(
        typeof serviceJobScopeWhere(scope, "user-1"),
        "object",
        `nincs feltetele: ${scope}`,
      );
    }
  });
});
