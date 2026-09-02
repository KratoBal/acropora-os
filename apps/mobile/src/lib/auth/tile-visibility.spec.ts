import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { servedTileIds, tileVisible, TILE_ENTRY } from "./tile-visibility";
import type { AuthenticatedUser } from "./types";

/**
 * A KEZDOKEPERNYO CSEMPEIT A SZERVER MENUJE DONTI EL.
 *
 * MIERT LETEZIK EZ A FAJL: a (3) lepes kalibraciojanal a "a telefon FIGYELMEN
 * KIVUL hagyja a kiadott menut, es a sajat tablaira esik vissza" rontas NULLA
 * tesztet dontott pirosra. Vagyis a lepes LENYEGET semmi nem merte -- a tobbi
 * mobil teszt a kepesseg-tablakat es a forras SZOVEGET nezi, azt nem, hogy a
 * kepernyo melyiket koveti.
 */

const felhasznalo = (
  navigation?: AuthenticatedUser["navigation"],
): Pick<AuthenticatedUser, "navigation"> => ({ navigation });

describe("a csempék a kiadott menüt követik", () => {
  it("a kiadott menü dönt, nem a saját tábla", () => {
    const ids = servedTileIds(
      felhasznalo([{ id: "worksheets", surfaces: ["web", "mobile"] }]),
    );

    // A KIADOTT tetel latszik, MEG AKKOR IS, ha a visszaeses hamisat mondana.
    assert.equal(tileVisible(ids, "MU", false), true);
    // ES a NEM kiadott NEM latszik, meg akkor sem, ha a visszaeses igazat mond.
    // EZ AZ AZ ALLITAS, AMI HIANYZOTT: enelkul a kepernyo visszaeshetne a sajat
    // tablaira, es minden zold maradna.
    assert.equal(tileVisible(ids, "RE", true), false);
  });

  it("a WEBES tételt nem rajzolja ki csempeként", () => {
    // A valasz a webes teteleket is hozza. Kihagyni oket NEM verzio-csuszas,
    // hanem normal mukodes -- ezert szur a `surfaces` mezore.
    const ids = servedTileIds(
      felhasznalo([{ id: "products", surfaces: ["web"] }]),
    );

    assert.equal(tileVisible(ids, "TE", true), false);
  });

  it("menü nélküli válasznál a saját táblára esik vissza", () => {
    // REGEBBI SZERVER. Enelkul a kezdokepernyo EGYETLEN csempet sem rajzolna ki,
    // hibauzenet nelkul -- egy ures kepernyo, ami mukodonek latszik.
    const ids = servedTileIds(felhasznalo(undefined));

    assert.equal(ids, null);
    assert.equal(tileVisible(ids, "MU", true), true);
    assert.equal(tileVisible(ids, "MU", false), false);
  });

  it("minden csempe-kód képződik, és az azonosítók egyediek", () => {
    const kodok = Object.keys(TILE_ENTRY);
    const tetelek = Object.values(TILE_ENTRY);

    // KONTROLL: het csempe all a kepernyon. Egy ures tabla mellett a fenti
    // allitasok is atmennenek, mert egyik sem nezne meg semmit.
    assert.equal(kodok.length, 7);
    assert.deepEqual([...new Set(tetelek)].sort(), [...tetelek].sort());
  });
});
