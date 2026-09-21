import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptDeviceToken,
  describeTokenShape,
  storedTokenForm,
} from "./device-token.rules.js";

const APNS = "A".repeat(64);
/*
  EGY FCM-SZERU ALAK: hosszu, kettosponttal es alahuzassal. A TARTALMA KITALALT --
  amit merunk, az az ALAK, nem egy valodi token. Ugyanaz a fixtura-alak, mint a
  telefon oldalan (`push-alak.spec.ts`), hogy a ket keszlet osszevetheto legyen.
*/
const FCM = "dGVzenQ_a1b2c3:APA91bH-" + "x".repeat(120);
const EXPO = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

describe("melyik tokent fogadjuk be", () => {
  it("iOS-en a 64 hexadecimalis alak atmegy", () => {
    assert.deepEqual(acceptDeviceToken({ token: APNS, platform: "IOS" }), {
      ok: true,
    });
  });

  /**
   * A REGI VISELKEDES, NEV SZERINT: iOS-en a szabaly NEM lazult. Ha valaki a
   * platform-agat ugy irna at, hogy mindent atenged, ez a sor pirosodik.
   */
  it("iOS-en az FCM-szeru alak NEM megy at", () => {
    assert.deepEqual(acceptDeviceToken({ token: FCM, platform: "IOS" }), {
      ok: false,
      reason: "not-apns",
    });
  });

  /**
   * AZ UJ AG. Ez az a sor, ami MA az eles nulla androidos tokent okozta: a
   * szabaly platform-ag nelkul futott, es ezt az alakot eldobta.
   */
  it("Androidon az FCM-szeru alak ATMEGY", () => {
    assert.deepEqual(acceptDeviceToken({ token: FCM, platform: "ANDROID" }), {
      ok: true,
    });
  });

  /**
   * AZ EXPO-TOKEN MINDKET PLATFORMON ROSSZ -- ez volt az EREDETI hiba, es az
   * android ag nem nyithatja ki elotte az ajtot. Ket kulon allitas, mert a ket
   * platform ket kulon uton jut ide.
   */
  it("az Expo-token iOS-en elbukik, sajat okkal", () => {
    assert.deepEqual(acceptDeviceToken({ token: EXPO, platform: "IOS" }), {
      ok: false,
      reason: "expo-token",
    });
  });

  it("az Expo-token ANDROIDON IS elbukik, sajat okkal", () => {
    assert.deepEqual(acceptDeviceToken({ token: EXPO, platform: "ANDROID" }), {
      ok: false,
      reason: "expo-token",
    });
  });
});

describe("a tarolt alak", () => {
  it("iOS-en kisbetus (a hexadecimalis ertek normalizalhato)", () => {
    assert.equal(
      storedTokenForm({ token: APNS, platform: "IOS" }),
      "a".repeat(64),
    );
  });

  /**
   * ANDROIDON A KISBETUSITES ELRONTANA A TOKENT, es a hiba csak a KULDESNEL
   * derulne ki -- ott pedig ugy nezne ki, mintha a keszulek adott volna rossz
   * tokent. A vezerlo 2026-09-21-ig MINDEN tokenre `toLowerCase()`-t hivott.
   */
  it("Androidon VALTOZATLAN marad (kis- es nagybetu-erzekeny)", () => {
    assert.equal(storedTokenForm({ token: FCM, platform: "ANDROID" }), FCM);
  });
});

describe("a token alakja, a token kiirasa nelkul", () => {
  it("az APNs alakot hexadecimaliskent nevezi meg, a hosszaval", () => {
    const leiras = describeTokenShape("a".repeat(64));
    assert.ok(leiras.includes("64 karakter"));
    assert.ok(leiras.includes("csak hexadecimális"));
  });

  it("az FCM-szeru alaknal a jeleket sorolja fel", () => {
    const leiras = describeTokenShape(FCM);
    assert.ok(leiras.includes("kettőspontot tartalmaz"));
    assert.ok(leiras.includes("aláhúzást tartalmaz"));
    assert.ok(!leiras.includes("csak hexadecimális"));
  });

  it("az Expo-tokent neven nevezi", () => {
    assert.ok(describeTokenShape(EXPO).includes("Expo-token"));
  });

  /**
   * A LEGFONTOSABB ALLITAS EBBEN A BLOKKBAN: a leiras NEM tartalmazza a tokent.
   * A naplot tobben olvassak, mint az eszkoz-tablat, es egy token a naploban
   * ugyanaz a hiba, mint egy token a kepernyon.
   */
  it("a leiras SEHOL nem tartalmazza magat a tokent", () => {
    for (const token of [APNS, FCM, EXPO]) {
      const leiras = describeTokenShape(token);
      assert.ok(!leiras.includes(token));
      // A token barmely husz karakteres darabja sem szivaroghat at.
      assert.ok(!leiras.includes(token.slice(0, 20)));
    }
  });
});
