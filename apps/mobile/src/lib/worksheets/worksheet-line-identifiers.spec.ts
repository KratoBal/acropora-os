import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A MUNKALAP KÉPERNYŐJE NEM FORDÍTHATÓ BE A TESZT-PROJEKTBE: `@/` alakú
 * importokat használ, és azokon keresztül behúzná az Expo futásidőt. Ezért a
 * képernyőre szóló ígéretet a FORRÁSÁN mérjük, ahogy a címke-nyomtatásnál is.
 * Ez gyengébb egy komponens-tesztnél, de nem nulla: az a néma elcsúszás, amit
 * fog, pont a leggyakoribb -- valaki átírja a képernyőt, és semmi nem szól.
 */
const SCREEN = "src/app/worksheets/[id].tsx";

describe("a munkalap tételsora a két azonosítót külön kezeli", () => {
  /**
   * A KONTROLL: a képernyő fájlját tényleg elolvassuk, és tényleg az a fájl,
   * ami a tételsorokat rajzolja. Enélkül a többi állítás egy üres sztringen is
   * elbukna, és az elbukás okát a hiányzó fájlra fognánk.
   */
  it("reads the screen it claims to read", () => {
    const source = readFileSync(SCREEN, "utf8");

    assert.ok(source.length > 1000);
    assert.match(source, /current\.lines\.map/);
    assert.match(source, /line\.assetNumber/);
  });

  /**
   * AZ ÜGYFÉL SAJÁT KÓDJA FELIRATTAL ÁLL, A MIÉNK CSUPASZON. A tételsoron a
   * MI eszközszámunk már ott van; egy második csupasz kód alatta pont az a
   * keveredés lenne, ami ellen ez a mező külön nevet kapott.
   */
  it("writes the customer's own code with its label", () => {
    const source = readFileSync(SCREEN, "utf8");

    assert.match(source, /Partner azonosítója: \{line\.inventoryNumber\}/);
  });

  /**
   * ÉS CSAK AKKOR, HA VAN: egy érték nélküli "Partner azonosítója:" azt állítaná,
   * hogy tudunk róla valamit. A mező nullázható, tehát ez nem elméleti eset,
   * hanem a leggyakoribb: a legtöbb eszközön ma nincs ügyfél-kód.
   */
  it("never writes the label without a value", () => {
    const source = readFileSync(SCREEN, "utf8");

    assert.match(source, /\{line\.inventoryNumber \? \(/);
  });
});
