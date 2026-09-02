import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isNavigationEntryVisible,
  navigationEntry,
  navigationIdsFor,
  NAVIGATION_ENTRIES,
} from "./navigation.js";

describe("a menü közös forrása", () => {
  it("minden azonosítója egyedi", () => {
    const ids = NAVIGATION_ENTRIES.map((entry) => entry.id);

    // KONTROLL: a lista be is toltodott. Egy ures lista minden alabbi
    // allitason atmenne, es a "nincs utkozes" akkor semmit nem jelentene.
    assert.ok(
      ids.length >= 20,
      `Csak ${ids.length} tétel. Ez a betöltés hibája.`,
    );
    assert.deepEqual(ids, [...new Set(ids)]);
  });

  it("minden tétel legalább egy felületen megjelenik", () => {
    const sehol = NAVIGATION_ENTRIES.filter(
      (entry) => entry.surfaces.length === 0,
    ).map((entry) => entry.id);

    assert.deepEqual(
      sehol,
      [],
      "Ezek a tételek egyik felületen sem jelennek meg, tehát a szabályuk " +
        "senkire nem hat: " +
        sehol.join(", "),
    );
  });

  /**
   * A SZEREP-LISTÁS ÁG EGYETLEN TÉTELÉ, ÉS EZT A SZÁM ŐRZI.
   *
   * A második szabály-fajta azért fért be, mert a NAV-csempe mai viselkedését
   * másképp nem lehetett megőrizni (a szerep-listája ma pontosan azoké, akiknek
   * `purchasing.view` joguk van, de a két szabály nem ugyanaz). Egy kivétel,
   * amit senki nem számol, terjedni fog: a következő olvasó tervezett
   * képességnek látja, és a jog-alapú ág lassan kiürül.
   *
   * MI PIROSÍT: egy második szerep-listás tétel. Az nem tilos, de nem lehet
   * csendes -- aki felveszi, ezt a sort is átírja, és akkor leírja, miért.
   */
  it("egyetlen szerep-listás tételt tart, és az megnevezi, mi szünteti meg", () => {
    const szereplistasak = NAVIGATION_ENTRIES.filter(
      (entry) => entry.visibility.kind === "roles",
    );

    assert.deepEqual(
      szereplistasak.map((entry) => entry.id),
      ["nav-integration-mobile"],
    );

    for (const entry of szereplistasak) {
      const rule = entry.visibility;
      assert.equal(rule.kind, "roles");
      if (rule.kind !== "roles") continue;
      assert.ok(
        rule.retiredBy.length > 40,
        `A(z) ${entry.id} szerep-listás ága nem mondja meg, mi szünteti meg.`,
      );
      assert.ok(rule.roles.length > 0, `A(z) ${entry.id} szerep-listája üres.`);
    }
  });

  /**
   * ISMERETLEN AZONOSÍTÓ: NEM LÁTSZIK.
   *
   * Ez NEM mond ellent annak, hogy egy új oldal alapértelmezetten látszik. Az a
   * szabály a menü-ADAT hiányáról szól (ott a jog dönt). Itt a kérdés maga
   * értelmetlen: egy azonosító, ami nincs a forrásban, nem egy tétel, amiről
   * nincs adatunk, hanem egyáltalán nem tétel.
   *
   * ÉS A POZITÍV KONTROLL MELLETTE: ugyanez a hívás IGAZAT ad egy létező
   * tételre. Enélkül a fenti sor akkor is zöld lenne, ha a függvény MINDIG
   * hamisat adna -- vagyis ha az egész menü eltűnt volna.
   */
  it("ismeretlen azonosítóra nem ad láthatóságot, ismertre igen", () => {
    assert.equal(isNavigationEntryVisible("nincs-ilyen-tetel", "OWNER"), false);
    assert.equal(isNavigationEntryVisible("dashboard", "OWNER"), true);
    assert.equal(navigationEntry("nincs-ilyen-tetel"), undefined);
  });

  /**
   * A SZŰKÍTÉS MAGA, MINDKÉT ÁGON, ÉS EZ A FÁJLBÓL HIÁNYZOTT.
   *
   * Mérve 2026-09-02: amikor a jog-ellenőrzés eredményét hatástalanná tettem
   * (`... || true`), ennek a csomagnak MIND A 31 tesztje zöld maradt. A hibát a
   * webes csomag háló-tesztje fogta meg -- vagyis épp ott nem volt állítás,
   * ahol a függvény lakik.
   *
   * AZ OK NEM FIGYELMETLENSÉG, HANEM AZ ÁLLÍTÁSOK IRÁNYA: minden korábbi sor a
   * MEGENGEDETT esetet nézte (létező azonosító, helyes felület), és egy
   * megengedett eset akkor is átmegy, ha MINDEN meg van engedve. A szűkítést
   * csak egy tiltott eset méri.
   *
   * MINDKÉT PÁR EGYÜTT ÁLL, mert a tagadás önmagában egy üres világon is igaz:
   * a `false` mellett ott a `true` ugyanarra a tételre, egy másik szereppel.
   */
  it("szűkít: akinek nincs joga, nem látja -- akinek van, igen", () => {
    // JOG-ALAPÚ ÁG. A SERVICE szerepnek nincs `users.manage` joga, az OWNER-nek van.
    assert.equal(isNavigationEntryVisible("users", "SERVICE"), false);
    assert.equal(isNavigationEntryVisible("users", "OWNER"), true);

    // SZEREP-LISTÁS ÁG. A SALES nincs a NAV-csempe listáján, az ADMIN igen.
    assert.equal(
      isNavigationEntryVisible("nav-integration-mobile", "SALES"),
      false,
    );
    assert.equal(
      isNavigationEntryVisible("nav-integration-mobile", "ADMIN"),
      true,
    );
  });

  it("felületenként külön szűr", () => {
    const web = navigationIdsFor("OWNER", "web");
    const mobil = navigationIdsFor("OWNER", "mobile");

    assert.ok(web.includes("dashboard"));
    assert.equal(mobil.includes("dashboard"), false);
    assert.ok(mobil.includes("nav-integration-mobile"));
    assert.equal(web.includes("nav-integration-mobile"), false);
  });
});
