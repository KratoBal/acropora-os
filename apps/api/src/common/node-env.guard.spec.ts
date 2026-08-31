import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertKnownNodeEnv,
  describeNodeEnvProblem,
  KNOWN_NODE_ENVS,
  UnknownNodeEnvError,
} from "./node-env.guard.js";

/**
 * Az őrző, a bootstrap felhúzása nélkül.
 *
 * A két irányt külön kell mérni, és a második a fontosabb: hogy MEGÁLL egy
 * elíráson, ÉS hogy NEM áll meg azon, ami ma működik. Egy őrző, ami mindent
 * megállít, ugyanolyan használhatatlan, mint az, ami semmit - csak hangosabb.
 */

describe("describeNodeEnvProblem", () => {
  /** KONTROLL: enélkül egy „mindent elutasít" hiba is átmenne a tiltó teszteken. */
  for (const value of KNOWN_NODE_ENVS)
    it(`accepts the known value ${value}`, () => {
      assert.equal(describeNodeEnvProblem(value), null);
    });

  /**
   * AZ ÜRES ÉRTÉK A NORMÁL ESET, nem kivétel: a CI egyetlen helyen állítja a
   * NODE_ENV értékét, egyébként nem, és a helyi futás is beállítás nélkül megy.
   */
  it("accepts an unset value, because that is how CI and local runs go", () => {
    assert.equal(describeNodeEnvProblem(undefined), null);
  });

  it("accepts an empty string the same way as unset", () => {
    assert.equal(describeNodeEnvProblem(""), null);
    assert.equal(describeNodeEnvProblem("   "), null);
  });

  it("rejects a typo", () => {
    const problem = describeNodeEnvProblem("prodcution");

    assert.ok(problem);
    assert.match(problem, /prodcution/);
  });

  /**
   * A NAGYBETŰS ALAK IS ELÍRÁS. A kód `=== "production"` alakban hasonlít, tehát
   * a `Production` érték a „nem production" ágra esne - pontosan a csendes
   * eset.
   */
  it("rejects a value that differs only in case", () => {
    assert.ok(describeNodeEnvProblem("Production"));
    assert.ok(describeNodeEnvProblem("PRODUCTION"));
  });

  /**
   * AZ ÜZENET MONDJA MEG, MI A KÁR ÉS MI A TEENDŐ. Egy „érvénytelen érték"
   * szövegből senki nem tudja meg, hogy közben megnyílt a fejlesztői
   * bejelentkezés - és ez az a mondat, ami miatt valaki tényleg javít.
   */
  it("names the actual damage, not just the rule", () => {
    const problem = describeNodeEnvProblem("prodcution");

    assert.ok(problem);
    assert.match(problem, /fejlesztői bejelentkezés/);
    assert.match(problem, /secure/);
    assert.match(problem, /Javítsd az értéket, ne ezt az ellenőrzést/);
  });
});

describe("assertKnownNodeEnv", () => {
  it("stays silent on a known value", () => {
    assert.doesNotThrow(() => assertKnownNodeEnv({ NODE_ENV: "staging" }));
  });

  it("stays silent when nothing is set", () => {
    assert.doesNotThrow(() => assertKnownNodeEnv({}));
  });

  it("throws loudly on an unknown value", () => {
    assert.throws(
      () => assertKnownNodeEnv({ NODE_ENV: "stagging" }),
      UnknownNodeEnvError,
    );
  });
});
