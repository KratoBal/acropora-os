import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pushEnabled, shouldRegisterPush } from "./push-preference";

/**
 * A CSENDES KIESÉS A TÉT.
 *
 * A munkalap kiosztásáról szóló értesítés az egyetlen, ami a szerelőt a
 * helyszínen eléri. Ha a beállítatlan állapot kikapcsoltat jelentene, akkor
 * mindenki, aki a kapcsolóhoz soha nem nyúl, némán esne ki -- és arról semmi
 * nem szólna, mert a hiba az, hogy nem történik semmi.
 */

describe("pushEnabled", () => {
  it("treats an untouched switch as on", () => {
    assert.equal(pushEnabled(null), true);
  });

  it("honours both explicit answers", () => {
    assert.equal(pushEnabled("on"), true);
    assert.equal(pushEnabled("off"), false);
  });
});

describe("shouldRegisterPush", () => {
  it("registers a signed-in phone whose switch was never touched", () => {
    assert.equal(
      shouldRegisterPush({ authenticated: true, preference: null }),
      true,
    );
  });

  /**
   * EZ A KAPCSOLÓ ÍGÉRETE: kikapcsolva a készülék NEM regisztrál, tehát a
   * szerver oldalán nincs mit megszólítani. A másik felét (a már bejegyzett
   * készülék leszedését) a szerver integrációs tesztje méri.
   */
  it("does not register while the switch is off", () => {
    assert.equal(
      shouldRegisterPush({ authenticated: true, preference: "off" }),
      false,
    );
  });

  /**
   * A KIJELENTKEZÉS NEM UGYANAZ, MINT A KIKAPCSOLÁS: kijelentkezve nincs kihez
   * kötni a készüléket, tehát a regisztráció akkor sem fut, ha a kapcsoló be
   * van kapcsolva.
   */
  it("waits for a signed-in colleague, switch or no switch", () => {
    assert.equal(
      shouldRegisterPush({ authenticated: false, preference: "on" }),
      false,
    );
    assert.equal(
      shouldRegisterPush({ authenticated: false, preference: null }),
      false,
    );
  });
});
