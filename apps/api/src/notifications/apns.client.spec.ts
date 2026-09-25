import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildApnsPayload } from "./apns.client.js";

/**
 * A MERT HIBA, AMIERT EZ AZ ORZO LETEZIK (2026-09-25): az `expo-notifications`
 * telepitett iOS-kodja TAVOLI push-nal a sajat adatot a "body" kulcs ALATT
 * keresi (`NotificationRecords.swift:328-334`), NEM a payload gyokereben. A
 * korabbi alak csak a gyokerbe teritette a `data` mezoket, tehat
 * `request.content.data` MINDIG ures volt iOS-en minden tavoli push-nal --
 * ettol a mobil `pushTarget()` mindig "no-target"-et adott, es a koppintas
 * EGYETLEN tipusnal sem navigalt soha iOS-en (csak Androidon, FCM-en
 * keresztul). Lasd `buildApnsPayload` sajat fejleceit a reszletekert.
 */
describe("az APNs payload alakja", () => {
  it('a data KETSZER szerepel: a "body" kulcs alatt IS, a gyokerben IS', () => {
    /*
      MI PIROSIT: ha a "body" kulcs hianyzik vagy nem a `data` mezoket
      hordozza, az iOS-kliens `content.data`-ja ures marad, es a koppintas
      megint sehova nem visz -- ugyanaz a hiba, amit ez az orzo eppen megfog.
    */
    const payload = buildApnsPayload({
      title: "Új vízmérés",
      body: "Rifi",
      data: { targetType: "aquarium", targetId: "aq-1" },
    });

    assert.deepEqual(payload.body, {
      targetType: "aquarium",
      targetId: "aq-1",
    });
    assert.equal((payload as { targetType?: string }).targetType, "aquarium");
    assert.equal((payload as { targetId?: string }).targetId, "aq-1");
  });

  it("az aps.alert.body a SZOVEGES uzenet marad, nem a data", () => {
    /*
      A KET "body" NEVAZONOS, DE MAS SZINTEN AL, ES MAS DOLGOT JELENT: az
      `aps.alert.body` az ertesites LATHATO szovege, a gyokerbeli "body" a
      NEM lathato, koppintaskor olvasott adat. MI PIROSIT: ha a ketto
      osszekeveredik, az ertesites vagy nem mutat szoveget, vagy a koppintas
      a szoveget probalna utvonalkent ertelmezni.
    */
    const payload = buildApnsPayload({
      title: "Új vízmérés",
      body: "Rifi",
      data: { targetType: "aquarium", targetId: "aq-1" },
    }) as { aps: { alert: { title: string; body: string } } };

    assert.equal(payload.aps.alert.title, "Új vízmérés");
    assert.equal(payload.aps.alert.body, "Rifi");
  });

  it('data nélkül a "body" kulcs `undefined`, és a JSON-ból lemarad', () => {
    /*
      MI PIROSIT: ha `data` hianyaban a "body" kulcs egy URES OBJEKTUMOT
      kapna `undefined` helyett, az iOS-kliens azt hinne, kapott adatot --
      csak eppen ertelmezhetetlent.
    */
    const payload = buildApnsPayload({ title: "Cím", body: "Törzs" });
    assert.equal(payload.body, undefined);
    /*
      A `JSON.stringify` KIHAGYJA az `undefined` erteku kulcsokat -- ez a
      TENYLEGES vezetekre kerulo alak, nem a JS objektum sajat kulcslistaja
      (ott a "body" kulcs meglenne, csak `undefined` ertekkel). A
      `aps.alert.body` (a lathato ertesites-szoveg) VISZONT megmarad, tehat a
      nyers JSON-szoveg maga NEM alkalmas a proba alapjanak.
    */
    const gyokerVisszaolvasva: unknown = JSON.parse(JSON.stringify(payload));
    assert.equal(
      typeof gyokerVisszaolvasva === "object" &&
        gyokerVisszaolvasva !== null &&
        "body" in gyokerVisszaolvasva,
      false,
    );
  });
});
