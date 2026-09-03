import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeCacheAge,
  describeCachedDepartmentsNotice,
  describeCachedWorksheetNotice,
  describeOfflineDetailNotice,
  describeOfflineNotice,
  isCacheStale,
  STALE_AFTER_HOURS,
} from "./offline-notice";

/**
 * A NÉMA MÁSOLAT A TÉT.
 *
 * Egy offline lista pontosan úgy néz ki, mint egy online: ugyanazok a sorok,
 * ugyanaz az elrendezés. Ha semmi nem mondja ki, hogy mentett másolat, akkor a
 * szerelő azt hiszi, a mai állapotot látja -- és a tévedéséről nem kap jelet.
 * Ezek a tesztek arra állnak, hogy a kimondás MEGTÖRTÉNIK, és hogy online,
 * friss adat mellett viszont NEM foglal helyet.
 *
 * Az idő itt bemenet: minden eset rögzített `now` értékkel mér, tehát a
 * korhatárok nem a futtatás pillanatától függenek.
 */

const now = new Date("2026-08-27T12:00:00.000Z");
const anHourAgo = "2026-08-27T11:10:00.000Z";
const yesterday = "2026-08-26T08:00:00.000Z";

describe("describeCacheAge", () => {
  it("says it never happened when there is no copy", () => {
    assert.equal(describeCacheAge(null, now), "még soha");
  });

  it("keeps the last hour vague on purpose", () => {
    assert.equal(describeCacheAge(anHourAgo, now), "az imént");
  });

  it("counts in hours inside a day", () => {
    assert.equal(describeCacheAge("2026-08-27T09:00:00.000Z", now), "3 órája");
  });

  it("counts in days beyond that", () => {
    assert.equal(describeCacheAge("2026-08-23T12:00:00.000Z", now), "4 napja");
  });

  /**
   * ELÁLLÍTOTT KÉSZÜLÉKÓRA. A jövőbeli bélyeg nem hiba, amit jelenteni kell, de
   * negatív órákat sem írhatunk ki. Az "az imént" a legkevesebbet állító válasz.
   */
  it("does not print a negative age when the clock is ahead", () => {
    assert.equal(describeCacheAge("2026-08-28T12:00:00.000Z", now), "az imént");
  });

  it("says the age is unknown rather than NaN for an unreadable stamp", () => {
    assert.equal(describeCacheAge("tegnap", now), "ismeretlen ideje");
  });
});

describe("isCacheStale", () => {
  it("treats a missing copy as stale, because there is nothing to work from", () => {
    assert.equal(isCacheStale(null, now), true);
  });

  it("holds the line exactly at the limit", () => {
    const exactly = new Date(
      now.getTime() - STALE_AFTER_HOURS * 60 * 60 * 1000,
    ).toISOString();
    assert.equal(isCacheStale(exactly, now), true);

    const justInside = new Date(
      now.getTime() - (STALE_AFTER_HOURS * 60 - 1) * 60 * 1000,
    ).toISOString();
    assert.equal(isCacheStale(justInside, now), false);
  });
});

describe("describeOfflineNotice", () => {
  it("stays out of the way when the phone is online and the copy is fresh", () => {
    assert.equal(
      describeOfflineNotice({
        online: true,
        syncedAt: anHourAgo,
        itemCount: 12,
        now,
      }),
      null,
    );
  });

  it("says out loud that the list is a saved copy, and how old it is", () => {
    const notice = describeOfflineNotice({
      online: false,
      syncedAt: yesterday,
      itemCount: 12,
      now,
    });

    assert.equal(notice?.tone, "offline");
    assert.equal(notice?.title, "Nincs kapcsolat: mentett másolatot látsz");
    // 28 óra: a nap fölött már napokban mérünk, tehát "1 napja". A megírt
    // várakozásom eredetileg "28 órája" volt -- a teszt fogta meg, nem én.
    assert.match(notice!.message, /1 napja/);
  });

  /**
   * A ROSSZABB ESET: nincs kapcsolat ÉS nincs mentett másolat. Ilyenkor a
   * képernyő üres, és az üres lista magától azt állítaná, hogy nincs eszköz.
   */
  it("distinguishes an empty phone from an empty registry", () => {
    const notice = describeOfflineNotice({
      online: false,
      syncedAt: null,
      itemCount: 0,
      now,
    });

    assert.equal(notice?.tone, "empty");
    assert.match(notice!.title, /nincs mentett másolat/);
  });

  /**
   * Online, régi másolat mellett a sáv NEM a képernyőn látható adatról szól --
   * az a szerverről jött --, hanem arról, hogy a készülék nincs felkészítve a
   * következő térerő nélküli munkára.
   */
  it("warns while there is still signal to fix it", () => {
    const notice = describeOfflineNotice({
      online: true,
      syncedAt: "2026-08-20T12:00:00.000Z",
      itemCount: 12,
      now,
    });

    assert.equal(notice?.tone, "stale");
    assert.match(notice!.message, /7 napja/);
  });
});

describe("describeOfflineDetailNotice", () => {
  it("says nothing while the sheet comes from the server", () => {
    assert.equal(
      describeOfflineDetailNotice({
        online: true,
        hasFullCopy: false,
        syncedAt: yesterday,
        now,
      }),
      null,
    );
  });

  it("marks a full saved sheet as saved", () => {
    const notice = describeOfflineDetailNotice({
      online: false,
      hasFullCopy: true,
      syncedAt: anHourAgo,
      now,
    });

    assert.equal(notice?.tone, "offline");
    assert.match(notice!.title, /mentett adatlap/);
  });

  /**
   * A LISTÁBÓL ÖSSZERAKOTT LAP HIÁNYOS, és a hiányzó mezők a repó szabálya
   * szerint nem üres sorként, hanem sehogy nem jelennek meg. A hiányukról tehát
   * semmi nem szólna: ez a sáv az egyetlen jel.
   */
  it("says which fields are missing because of the missing signal", () => {
    const notice = describeOfflineDetailNotice({
      online: false,
      hasFullCopy: false,
      syncedAt: yesterday,
      now,
    });

    assert.equal(notice?.tone, "stale");
    assert.match(notice!.title, /hiányos adatlap/);
    assert.match(notice!.message, /csak térerővel látszik/);
  });
});

describe("a mentett helyszínek sávja", () => {
  const most = new Date("2026-09-03T12:00:00.000Z");

  it("kapcsolattal NEM szól", () => {
    // ISMERT POZITIV KONTROLL a lentiekhez: e nelkul egy "mindig szol" valtozat
    // is atmenne rajtuk, es a sav allandoan ott ulne a valaszto folott.
    assert.equal(
      describeCachedDepartmentsNotice({
        online: true,
        count: 3,
        syncedAt: "2026-09-03T06:00:00.000Z",
        now: most,
      }),
      null,
    );
  });

  it("mentett listánál kimondja a DARABSZÁMOT és a KORT", () => {
    const notice = describeCachedDepartmentsNotice({
      online: false,
      count: 3,
      syncedAt: "2026-09-03T06:00:00.000Z",
      now: most,
    });
    assert.match(notice?.message ?? "", /3 helyszín/);
    assert.match(notice?.message ?? "", /6 órája/);
    // ES AMI A LENYEG: hogy ami azota MEGSZUNT, azt itt nem latni. A valasztas
    // ITT irassa valik, es egy torolt helyszin a kuldest bukna el kesobb.
    assert.match(notice?.message ?? "", /megszűnt/);
  });

  it("ÜRES másolatnál MÁS mondat jár, mert más a teendő", () => {
    /*
      MI PIROSIT: egy kozos mondat a ket esetre. "Nulla helyszin a telefonrol"
      ugy hangzana, mintha a partnernek nem lenne helyszine -- holott csak MI nem
      mentettuk le, es terero mellett ott van mind.
    */
    const notice = describeCachedDepartmentsNotice({
      online: false,
      count: 0,
      syncedAt: null,
      now: most,
    });
    assert.match(notice?.message ?? "", /nincs mentett helyszín/);
    assert.match(notice?.message ?? "", /kötelező/);
    assert.doesNotMatch(notice?.message ?? "", /0 helyszín/);
  });
});

describe("a mentett munkalap sávja", () => {
  const most = new Date("2026-09-04T10:00:00Z");
  const ket_oraja = "2026-09-04T08:00:00Z";

  it("térerővel nincs sáv", () => {
    assert.equal(
      describeCachedWorksheetNotice({
        online: true,
        syncedAt: ket_oraja,
        status: "DRAFT",
        now: most,
      }),
      null,
    );
  });

  it("PISZKOZATNÁL az ÁLLAPOTOT mondja ki, nem csak a korát", () => {
    /*
      EZ A LENYEG. Az eszkoz adatlapjanal a regi masolat annyit jelent, hogy
      "ami azota valtozott, azt nem latod". A munkalapnal az ALLAPOT ennel
      tobbet ronthat: ha az iroda kozben LEZARTA, a masolatban meg piszkozatnak
      latszik, es a szerelo azt hiszi, nyitott lapra dolgozik.

      MI PIROSIT: ha a sav csak a kort mondja el, mint az eszkoznel.
    */
    const notice = describeCachedWorksheetNotice({
      online: false,
      syncedAt: ket_oraja,
      status: "DRAFT",
      now: most,
    });
    assert.equal(notice?.tone, "stale");
    assert.ok(notice?.message.includes("LEZÁRHATTA"), notice?.message ?? "");
    assert.ok(notice?.message.includes("2 órája"), notice?.message ?? "");
  });

  it("és azt is kimondja, hogy a begépelt szöveg NEM vész el", () => {
    /*
      A figyelmeztetes fele csak ijesztget, ha nem mondja meg, mi tortenik a
      munkaval. A sorban marad -- ezt a 488 ota tudjuk allitani, mert az
      elvetett sor sem tunik el.
    */
    const notice = describeCachedWorksheetNotice({
      online: false,
      syncedAt: ket_oraja,
      status: "DRAFT",
      now: most,
    });
    assert.ok(notice?.message.includes("nem vész el"), notice?.message ?? "");
  });

  it("ALÁÍRT lapnál MÁS a mondat, mert az állapot nem mozdulhat", () => {
    /*
      LEMERVE a szerveren: az `amendRefusal` a SIGNED allapotra elutasitast ad,
      a munka folytatasa UJ lap. Vagyis ez az EGYETLEN allapot, ami nem valtozhat
      a masolat alatt -- ott a kor a kerdes, nem az allapot.

      MI PIROSIT: egy kozos szoveg a ket agra. Az alairt lapnal az "iroda
      lezarhatta" mondat egyszeruen HAMIS lenne.
    */
    const notice = describeCachedWorksheetNotice({
      online: false,
      syncedAt: ket_oraja,
      status: "SIGNED",
      now: most,
    });
    assert.equal(notice?.tone, "offline");
    assert.equal(notice.message.includes("LEZÁRHATTA"), false);
    assert.ok(notice.message.includes("nem változhatott"), notice.message);
  });

  it("minden NEM aláírt állapot a figyelmeztető ágra megy", () => {
    /*
      ISMERT POZITIV KONTROLL a fenti mellé: a piszkozat NEM kulonleges eset.
      Az alairasra varo lapot alairhatjak vagy elutasithatjak, az elutasitottat
      atirhatjak -- mindharom MOZOG a masolat alatt.
    */
    for (const status of ["DRAFT", "AWAITING_SIGNATURE", "REJECTED"]) {
      const notice = describeCachedWorksheetNotice({
        online: false,
        syncedAt: ket_oraja,
        status,
        now: most,
      });
      assert.equal(notice?.tone, "stale", status);
    }
  });
});
