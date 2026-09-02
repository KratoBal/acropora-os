import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

    // A KIADOTT tetel latszik.
    assert.equal(tileVisible(ids, "MU"), true);
    // ES a NEM kiadott NEM latszik. EZ AZ AZ ALLITAS, AMI HIANYZOTT: enelkul a
    // kepernyo a sajat tablaira eshetne vissza, es minden zold maradna.
    assert.equal(tileVisible(ids, "RE"), false);
  });

  it("a WEBES tételt nem rajzolja ki csempeként", () => {
    // A valasz a webes teteleket is hozza. Kihagyni oket NEM verzio-csuszas,
    // hanem normal mukodes -- ezert szur a `surfaces` mezore.
    const ids = servedTileIds(
      felhasznalo([{ id: "products", surfaces: ["web"] }]),
    );

    assert.equal(tileVisible(ids, "TE"), false);
  });

  /**
   * MENU NELKUL NINCS CSEMPE -- ES EZ 2026-09-02 OTA IGY HELYES.
   *
   * A (3) lepesben meg volt visszaeses: menu nelkuli valasznal a kezdokepernyo
   * a sajat kepesseg-tablaira esett. Acrobot dontese szerint menu nelkuli
   * szervert nem tamogatunk, es az indok az, hogy a visszaeses NEMA: csendben a
   * regi tablakbol dolgozna, es senki nem venne eszre. A kezdokepernyo ezt most
   * ki is mondja ("Nincs megjelenithetó modul").
   *
   * A KONTROLL A MASODIK SOR: ugyanez a fuggveny IGAZAT ad, amikor a szerver
   * KULDOTT tetelt. Enelkul ez az allitas akkor is zold lenne, ha a fuggveny
   * MINDIG hamisat adna -- vagyis ha minden csempe eltunt volna.
   */
  it("menü nélküli válasznál egyetlen csempe sem látszik", () => {
    const ures = servedTileIds(felhasznalo(undefined));

    assert.equal(ures.size, 0);
    assert.equal(tileVisible(ures, "MU"), false);

    const kuldott = servedTileIds(
      felhasznalo([{ id: "worksheets", surfaces: ["mobile"] }]),
    );
    assert.equal(tileVisible(kuldott, "MU"), true);
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

/**
 * A NULLA-CSEMPE UZENET LETEZESE, A KEPERNYO SZOVEGEBOL.
 *
 * MIERT SZOVEGBOL, ES NEM RENDERELESSEL: ebben a csomagban nincs komponens-teszt
 * kornyezet -- minden spec logikat mer, nem kepernyot. A repo sajat mintaja erre
 * a forras olvasasa (lasd `nav-tile-roles.spec.ts`), es ugyanaz a hatara is: azt
 * allitja, hogy az ag OTT VAN, nem azt, hogy jol nez ki.
 *
 * MIERT KELL EGYALTALAN: a 4. lepesben kiesett a visszaeses, es a dontes indoka
 * az volt, hogy a hiba legyen HANGOS a csendes visszaeses helyett. Egy ures
 * szakasz a "Modulok" cim alatt viszont nem hangos, csak zavaro. Merve
 * 2026-09-02: az uzenet eltuntetese NULLA tesztet dontott pirosra, amig ez a
 * sor nem allt itt -- vagyis a dontes fele resze orizetlen volt.
 */
describe("a kezdőképernyő kimondja, ha nincs csempe", () => {
  const kepernyo = () => readFileSync("src/app/index.tsx", "utf8");

  it("van ága a nulla csempére, és megnevezi az okot", () => {
    const forras = kepernyo();

    // KONTROLL A KERESESRE: a fajl be is toltodott, es a modul-szakasz benne van.
    assert.match(forras, /Modulok/);

    assert.match(forras, /lathatoCsempek === 0/);
    assert.match(forras, /Nincs megjeleníthető modul/);

    // ES A KET RESZ, AMI A HIBAT ELVALASZTJA A JOGOSULTSAG HIANYATOL. Egy ures
    // kezdolap ugyanugy nez ki, mint egy jog nelkuli felhasznaloe -- a szoveg
    // ezert mondja ki, hogy nem arrol van szo, es ezert all mellette
    // ujraprobalas, ami a menut ujra lekeri kijelentkezes nelkul.
    assert.match(forras, /nem a\s*\n?\s*jogosultságaiddal/);
    assert.match(forras, /onPress=\{retryRestore\}/);
  });
});
