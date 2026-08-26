import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  runningVersionLine,
  shortUpdateId,
  type RunningVersionFacts,
} from "./app-version";

/**
 * AMIT EZ A FÁJL ŐRIZ.
 *
 * A felirat egyetlen dolgot ér: megmondja, MELYIK kód fut. A veszély nem az,
 * hogy hiányzik, hanem hogy ott van és félrevezet -- pontosan úgy, ahogy a
 * verziószám tenné, ami a 6-os, a 7-es és a 8-as buildnél egyaránt `0.1.0`.
 */

const facts = (
  extra: Partial<RunningVersionFacts> = {},
): RunningVersionFacts => ({
  buildNumber: "8",
  isEmbeddedLaunch: true,
  updateId: null,
  updateCreatedAt: null,
  ...extra,
});

describe("runningVersionLine", () => {
  it("names the build, because the version alone cannot tell two builds apart", () => {
    const line = runningVersionLine(facts());

    assert.match(line, /8\. build/);
  });

  /**
   * EZ A SOR A LÉNYEG. A beágyazott és a letöltött indulás kívülről
   * megkülönböztethetetlen, és pont ezt a különbséget kellett tegnap
   * kérdésekkel kideríteni.
   */
  it("separates the embedded bundle from a downloaded one", () => {
    const embedded = runningVersionLine(facts({ isEmbeddedLaunch: true }));
    const downloaded = runningVersionLine(
      facts({
        isEmbeddedLaunch: false,
        updateId: "01a03f64-7580-7cbd-8393-e915dfc1981d",
      }),
    );

    assert.match(embedded, /beépített/);
    assert.doesNotMatch(embedded, /éteri/);
    assert.match(downloaded, /éteri/);
    assert.doesNotMatch(downloaded, /beépített/);
  });

  it("shows which update is running, not just that one is", () => {
    const line = runningVersionLine(
      facts({
        isEmbeddedLaunch: false,
        updateId: "01a03f64-7580-7cbd-8393-e915dfc1981d",
      }),
    );

    // A rövid alak a teljes azonosító ELEJE, tehát összevethető a publikálás
    // kimenetén szereplő hosszú értékkel.
    assert.match(line, /01a03f64/);
    assert.ok("01a03f64-7580-7cbd-8393-e915dfc1981d".startsWith("01a03f64"));
  });

  it("says the build is unknown instead of inventing one", () => {
    const line = runningVersionLine(facts({ buildNumber: null }));

    // A hiányzó adat NEM látszhat adatnak. Egy üres hely vagy egy nulla itt
    // olyan feliratot adna, ami magabiztosabb, mint amennyit tud.
    assert.match(line, /ismeretlen build/);
    assert.doesNotMatch(line, /^\. build/);
  });

  it("leaves out the time when there is none, rather than printing an epoch", () => {
    const line = runningVersionLine(
      facts({
        isEmbeddedLaunch: false,
        updateId: "abc12345",
        updateCreatedAt: null,
      }),
    );

    assert.doesNotMatch(line, /1970/);
    assert.match(line, /abc12345/);
  });
});

describe("shortUpdateId", () => {
  it("keeps the beginning, so the short form matches the long one", () => {
    assert.equal(
      shortUpdateId("01a03f64-7580-7cbd-8393-e915dfc1981d"),
      "01a03f64",
    );
    assert.equal(shortUpdateId(null), null);
  });
});

/**
 * A KONTROLL: a képernyő tényleg a fenti modulból dolgozik, és tényleg az
 * `expo-updates` futásidejű mezőit adja át neki. Enélkül a fenti állítások egy
 * olyan függvényt mérnének, amit senki nem hív.
 */
describe("a kezdőképernyő ugyanezt a sort írja ki", () => {
  const SCREEN = "src/app/index.tsx";

  it("reads the screen it claims to read", () => {
    const source = readFileSync(SCREEN, "utf8");

    assert.ok(source.length > 1000);
    assert.match(source, /runningVersionLine/);
  });

  /**
   * A KÉT MEZŐ, AMI UGYANANNAK LÁTSZIK. A `Constants.platform.ios.buildNumber` a
   * natív bináris értéke, és a csomag dokumentációja szerint egy adott
   * binárisnál SOHA nem változik; az `expoConfig.ios.buildNumber` viszont egy
   * éteren érkezett frissítéssel FELÜLÍRÓDHAT. A kettő pont akkor tér el,
   * amikor a felirat a legfontosabb.
   */
  it("reads the build number from the binary, not from the updatable manifest", () => {
    const source = readFileSync(SCREEN, "utf8");

    assert.match(source, /Constants\.platform\?\.ios\?\.buildNumber/);
    assert.doesNotMatch(source, /expoConfig\?\.ios\?\.buildNumber/);
  });

  it("takes the facts from the update runtime, not from the config alone", () => {
    const source = readFileSync(SCREEN, "utf8");

    // Az `isEmbeddedLaunch` az EGYETLEN mező, ami megmondja, hogy a futó csomag
    // a buildé vagy egy letöltött frissítésé. Ha valaha kikerül a hívásból, a
    // felirat megmarad, de a lényeget hallgatja el.
    assert.match(source, /isEmbeddedLaunch/);
    assert.match(source, /updateId/);
  });
});
