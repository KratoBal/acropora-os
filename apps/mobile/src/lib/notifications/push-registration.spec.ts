import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptDeviceToken,
  isNativeDeviceToken,
  registrationOutcome,
  storedTokenForm,
} from "./push-registration";

const granted = { granted: true, canAskAgain: true };
const nativeToken = "a1".repeat(32);
/* UGYANAZ A FIXTURA-ALAK, mint a szerver `device-token.rules.spec.ts`-eben es a
   `push-alak.spec.ts`-ben: hosszu, kettosponttal es alahuzassal. A TARTALMA
   kitalalt -- amit merunk, az az ALAK, nem egy valodi token. */
const FCM = "dGVzenQ_a1b2c3:APA91bH-" + "x".repeat(120);
const EXPO = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

describe("push registration outcome", () => {
  it("is ready when the device answered with a native token", () => {
    const outcome = registrationOutcome({
      supported: true,
      permission: granted,
      token: nativeToken.toUpperCase(),
      platform: "IOS",
    });

    assert.deepEqual(outcome, { status: "ready", token: nativeToken });
  });

  /**
   * The one mistake that looks like success everywhere else: Expo hands out a
   * token of its own from the neighbouring call, the server would store it,
   * and nothing would ever arrive. Named as its own failure so a log line
   * says which call the build is making.
   */
  it("refuses an Expo token instead of registering it", () => {
    const outcome = registrationOutcome({
      supported: true,
      permission: granted,
      token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
      platform: "IOS",
    });

    /*
      AZ OK MOSTANTOL AZ ALAKOT IS HORDOZZA (2026-09-21), ezert nem betu szerinti
      egyezest allitunk, hanem a KET RESZT kulon: a nevet (ez valasztja el a
      tobbi kimeneteltol) es azt, hogy az Expo-tokent NEVEN nevezi (ez valasztja
      el a rossz hivast a masik platform tokenjetol). Egy betu szerinti allitas
      itt a bovitest tiltana, nem a hibat fogna meg.
    */
    assert.equal(outcome.status, "failed");
    if (outcome.status !== "failed") return;
    /*
      2026-09-21: AZ EXPO-TOKEN SAJAT OKOT KAP. Korabban itt a
      "not a native APNs token" kezdet allt -- az ANDROID agon HAMIS lenne, mert
      ott nem az APNs-alak a szabaly. Az allitas azt meri, ami a JELENTEST
      hordozza: hogy a valasz az Expo-tokenre mutat, nem az APNs-alakra.
    */
    assert.match(outcome.reason, /expo/i);
    assert.ok(outcome.reason.includes("Expo-token"));
  });

  it("treats a simulator as a device without push, not as a fault", () => {
    const outcome = registrationOutcome({
      supported: false,
      permission: { granted: false, canAskAgain: false },
      token: null,
      platform: "IOS",
    });

    assert.deepEqual(outcome, { status: "unavailable" });
  });

  /**
   * A colleague who declines notifications has declined them. This is a state
   * to record, not one to argue with, and the caller has nothing to show.
   */
  it("takes no for an answer", () => {
    const outcome = registrationOutcome({
      supported: true,
      permission: { granted: false, canAskAgain: false },
      token: null,
      platform: "IOS",
    });

    assert.deepEqual(outcome, { status: "declined" });
  });

  it("reports a granted permission with no token as the fault it is", () => {
    const outcome = registrationOutcome({
      supported: true,
      permission: granted,
      token: null,
      platform: "IOS",
    });

    assert.deepEqual(outcome, { status: "failed", reason: "missing token" });
  });

  describe("what counts as a native token", () => {
    it("accepts 64 hexadecimal characters, in either case", () => {
      assert.equal(isNativeDeviceToken(nativeToken), true);
      assert.equal(isNativeDeviceToken(nativeToken.toUpperCase()), true);
    });

    it("rejects anything shorter, longer or non-hexadecimal", () => {
      assert.equal(isNativeDeviceToken("a1".repeat(31)), false);
      assert.equal(isNativeDeviceToken("a1".repeat(33)), false);
      assert.equal(isNativeDeviceToken(`${"a1".repeat(31)}zz`), false);
      assert.equal(isNativeDeviceToken(""), false);
    });
  });
});

/**
 * A PLATFORM-AG. A PARJA A SZERVEREN ALL, ugyanezekkel a nevekkel:
 * `apps/api/src/notifications/device-token.rules.spec.ts`. A ket keszlet
 * SZANDEKOSAN osszevetheto -- ugyanaz a szabaly ket helyen fut, es 2026-09-21-ig
 * mind a ketto 64 hexet kovetelt, platform-ag nelkul.
 */
describe("melyik tokent fogadja be a keszulek", () => {
  it("iOS-en a 64 hexadecimalis alak atmegy", () => {
    assert.deepEqual(
      acceptDeviceToken({ token: nativeToken, platform: "IOS" }),
      {
        ok: true,
      },
    );
  });

  /** A REGI VISELKEDES, NEV SZERINT: iOS-en a szabaly NEM lazult. */
  it("iOS-en az FCM-szeru alak NEM megy at", () => {
    assert.deepEqual(acceptDeviceToken({ token: FCM, platform: "IOS" }), {
      ok: false,
      reason: "not-apns",
    });
  });

  /**
   * AZ UJ AG, ES EZ AZ A SOR, AMI AZ ELES NULLA ANDROIDOS TOKENT OKOZTA: a
   * szabaly platform-ag nelkul futott, es ezt az alakot eldobta -- MEG MIELOTT
   * a regisztracios keres elindult volna a szerver fele.
   */
  it("Androidon az FCM-szeru alak ATMEGY", () => {
    assert.deepEqual(acceptDeviceToken({ token: FCM, platform: "ANDROID" }), {
      ok: true,
    });
  });

  /**
   * A CSUPA SZOKOZ SAJAT OKKAL BUKIK. Az ANDROID ag mintat nem ir elo, tehat ha
   * ez a feltetel nem allna, egy ures ertek eljutna a szerverig.
   */
  it("a csupa szokoz Androidon elbukik, sajat okkal", () => {
    assert.deepEqual(acceptDeviceToken({ token: "   ", platform: "ANDROID" }), {
      ok: false,
      reason: "empty",
    });
  });

  it("a csupa szokoz iOS-en is elbukik, ugyanazzal az okkal", () => {
    assert.deepEqual(acceptDeviceToken({ token: "  ", platform: "IOS" }), {
      ok: false,
      reason: "empty",
    });
  });

  /**
   * A LEGKOZELEBBI TEVESZTES: egy VALODI token, ami szokozt is visel a szelen.
   * A `trim()` csak az URES esetet zarja ki -- a tartalmas erteket nem szabad
   * elvennie.
   */
  it("a szokozzel korbevett, de TARTALMAS ertek Androidon atmegy", () => {
    assert.deepEqual(
      acceptDeviceToken({ token: `  ${FCM}  `, platform: "ANDROID" }),
      { ok: true },
    );
  });

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

describe("a tovabbkuldott alak", () => {
  it("iOS-en kisbetus (a hexadecimalis ertek normalizalhato)", () => {
    assert.equal(
      storedTokenForm({ token: nativeToken.toUpperCase(), platform: "IOS" }),
      nativeToken,
    );
  });

  /**
   * ANDROIDON A KISBETUSITES ELRONTANA A TOKENT. A `registrationOutcome`
   * 2026-09-21-ig MINDEN tokenre `toLowerCase()`-t hivott, tehat a telefon MAR
   * ELRONTVA kuldte volna az FCM tokent -- es a kar csak a KULDESNEL latszana,
   * `INVALID_ARGUMENT` alakjaban, vagyis ugy, mintha a keszulek adott volna
   * rossz tokent. A szerver ugyanezt a hibat ugyanaznap javitotta; kulon-kulon
   * egyik javitas sem lett volna eleg.
   */
  it("Androidon VALTOZATLAN marad (kis- es nagybetu-erzekeny)", () => {
    assert.equal(storedTokenForm({ token: FCM, platform: "ANDROID" }), FCM);
  });
});

describe("a regisztracio vege vegig, platformonkent", () => {
  /**
   * A TELJES UT, NEM CSAK A SZABALY: ez az allitas fogja meg, ha barmelyik
   * kesobbi lepes megis hozzanyul a tokenhez. A kis- es nagybetuk MEGMARADNAK.
   */
  it("Androidon az FCM token READY allapotban, VALTOZATLANUL jon vissza", () => {
    const outcome = registrationOutcome({
      supported: true,
      permission: granted,
      token: FCM,
      platform: "ANDROID",
    });

    assert.deepEqual(outcome, { status: "ready", token: FCM });
  });

  it("Androidon az Expo-token OKA az Expo-tokenre mutat, nem az APNs-alakra", () => {
    const outcome = registrationOutcome({
      supported: true,
      permission: granted,
      token: EXPO,
      platform: "ANDROID",
    });

    assert.equal(outcome.status, "failed");
    if (outcome.status !== "failed") return;
    assert.match(outcome.reason, /expo/i);
    assert.doesNotMatch(outcome.reason, /APNs/);
  });
});
