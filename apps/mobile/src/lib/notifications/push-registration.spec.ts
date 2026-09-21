import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isNativeDeviceToken, registrationOutcome } from "./push-registration";

const granted = { granted: true, canAskAgain: true };
const nativeToken = "a1".repeat(32);

describe("push registration outcome", () => {
  it("is ready when the device answered with a native token", () => {
    const outcome = registrationOutcome({
      supported: true,
      permission: granted,
      token: nativeToken.toUpperCase(),
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
    assert.ok(outcome.reason.startsWith("not a native APNs token"));
    assert.ok(outcome.reason.includes("Expo-token"));
  });

  it("treats a simulator as a device without push, not as a fault", () => {
    const outcome = registrationOutcome({
      supported: false,
      permission: { granted: false, canAskAgain: false },
      token: null,
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
    });

    assert.deepEqual(outcome, { status: "declined" });
  });

  it("reports a granted permission with no token as the fault it is", () => {
    const outcome = registrationOutcome({
      supported: true,
      permission: granted,
      token: null,
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
