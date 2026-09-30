import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { assetStatusLabel, assetStatusTone } from "./asset-management.js";

/**
 * A SEMA, AMI AZ ALLAPOTOK SORRENDJET ADJA. A futo fajl a `test-dist` alatt all,
 * tehat a `../../database/...` a `packages/database`-re mutat.
 */
const SEMA = new URL("../../database/prisma/schema.prisma", import.meta.url)
  .pathname;

/**
 * AZ "UZEMEN KIVUL" ALLAPOT (Balazs kerese, 2026-09-30 12:29 UTC).
 */
describe("eszköz-állapot szótár", () => {
  it("az Üzemen kívül magyar címkét és piros jelvényt kap", () => {
    assert.equal(assetStatusLabel.OUT_OF_SERVICE, "Üzemen kívül");
    // A 2026-09-16 elotti szabaly: a nem uzemelo eszkoz fel nem vett teendo,
    // tehat piros -- es nem a tartalekok kekje, amik SZANDEKOS allapotok.
    assert.equal(assetStatusTone.OUT_OF_SERVICE, "red");
  });

  /*
    A LEGORDULOK SORRENDJE A CIMKE-SZOTAR KULCSAINAK SORRENDJE: a webes
    szerkesztok `Object.entries(assetStatusLabel)`-lel epitik a valasztot. A
    lista pedig a SEMA sorrendjeben rendez. Ha a ketto elter, a valaszto mas
    sorrendet mutat, mint a lista. MI PIROSIT: ha az uj erteket a szotar vegere
    irjak, vagy a semaban mashova kerul.
  */
  it("a szótár kulcsainak sorrendje a séma sorrendje", () => {
    const blokk = /enum AssetStatus \{([^}]*)\}/.exec(
      readFileSync(SEMA, "utf8"),
    );
    assert.ok(blokk, "nem találtam az AssetStatus enumot a sémában");
    const sema = blokk[1]!
      .split("\n")
      .map((sor) => sor.trim())
      .filter(Boolean);
    assert.deepEqual(Object.keys(assetStatusLabel), sema);
  });
});
