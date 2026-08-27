import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A KIADÁSI ÚT KÉT HELYEN MONDJA KI UGYANAZT AZ AZONOSÍTÓT, ÉS AZ ELCSÚSZÁSUK NÉMA.
 *
 * A `submit` profil `bundleIdentifier` mezője azt dönti el, MELYIK alkalmazás
 * hitelesítő adatát keresi ki az EAS a beküldéshez. Ha hiányzik, a parancs a
 * HELYI `app.config.js` fájlból oldja fel a nevet, az pedig az `APP_VARIANT`
 * környezeti változóból dolgozik -- ami a submit hívásnál nincs beállítva,
 * tehát a `development` alapértelmezésre esik vissza.
 *
 * Mérve 2026-08-27: a production build beküldése közben a parancs ezt írta ki:
 * "Looking up credentials configuration for hu.acropora.os.dev". A `.dev` végű
 * név a fejlesztői variánsé. A beküldés akkor is a helyes alkalmazás alá ment,
 * mert az `ascAppId` explicit, és a használt kulcs alkalmazás-független -- de
 * ez szerencse volt, nem helyes konfiguráció.
 *
 * EZ AZ ŐRZŐ AZ AZONOSSÁGOT ÁLLÍTJA, nem egy konkrét sztringet: ha valaki a
 * production variáns azonosítóját átírja, ez pirosra vált, és nem a következő
 * beküldésen derül ki.
 */
const EAS_JSON = "eas.json";
const APP_CONFIG = "app.config.js";

function easSubmitBundleIdentifier(): unknown {
  const eas = JSON.parse(readFileSync(EAS_JSON, "utf8")) as {
    submit?: { production?: { ios?: { bundleIdentifier?: unknown } } };
  };
  return eas.submit?.production?.ios?.bundleIdentifier;
}

/**
 * A production variáns azonosítója a forrásból, nem a modul betöltésével: az
 * `app.config.js` az Expo futásidő felé nyit, amit a teszt-fordítás nem lát.
 */
function appConfigProductionBundleIdentifier(): string {
  const source = readFileSync(APP_CONFIG, "utf8");
  const block = /production:\s*\{([^}]*)\}/.exec(source);
  assert.ok(
    block,
    "nem találtam a production variáns blokkját az app.config.js fájlban",
  );
  const match = /bundleIdentifier:\s*"([^"]+)"/.exec(block[1]!);
  assert.ok(match, "a production blokkban nincs bundleIdentifier");
  return match[1]!;
}

describe("a beküldés és az alkalmazás ugyanazt a csomagazonosítót nevezi meg", () => {
  /**
   * A KONTROLL: mindkét fájlt tényleg elolvassuk, és mindkettőben van érték.
   * Enélkül két hiányzó érték is "egyezne", és a teszt zölden hallgatna.
   */
  it("reads a value from both files", () => {
    assert.equal(typeof easSubmitBundleIdentifier(), "string");
    assert.ok(appConfigProductionBundleIdentifier().length > 0);
  });

  /**
   * A `submit` profil azonosítója NEM lehet a fejlesztői vagy az előnézeti
   * variánsé. Ez a konkrét hiba, ami 2026-08-27-én megtörtént, csak akkor a
   * mező hiányzott, és a visszaesés hozta ugyanezt az eredményt.
   */
  it("never names a non-production variant", () => {
    const identifier = easSubmitBundleIdentifier();
    assert.equal(typeof identifier, "string");
    assert.doesNotMatch(identifier as string, /\.(dev|preview)$/);
  });

  it("names exactly the production variant's identifier", () => {
    assert.equal(
      easSubmitBundleIdentifier(),
      appConfigProductionBundleIdentifier(),
    );
  });
});
