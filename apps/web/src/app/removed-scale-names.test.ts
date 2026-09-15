import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A MEGSZUNT SKALA NEVE NEM SZIVAROGHAT VISSZA.
 *
 * A `teal-*` es a `slate-*` tokenek 2026-09-15-en kikerultek a
 * `globals.css`-bol, mert a hivasi helyek atalltak `brand-*`-ra, illetve
 * `dusk-*`-ra.
 *
 * ES ITT KORABBAN HAMIS INDOK ALLT, A SAJAT KEZEMTOL: azt irtam, hogy egy
 * visszakerulo `text-teal-700` "szintelen" marad, mert a Tailwind nem general
 * hozza szabalyt. NEM IGY VAN, es a kulonbseg rosszabb, nem jobb. Mind a ket
 * nev a Tailwind SAJAT keszletenek a resze (lemerve a telepitett 4.3.3
 * `theme.css`-eben: 11-11 fokozat). A mi `@theme` blokkunk csak FELULIRTA
 * oket. Ha a felulirás eltunik, a nev NEM szunik meg -- VISSZAESIK a Tailwind
 * sajat ertekere:
 *
 *     a mi slate-500-unk volt   #686477   (ibolya fele, 253 fok)
 *     a Tailwind slate-500-a    oklch(55.4% 0.046 257.417)   (kek fele, 215 fok)
 *
 * Vagyis egy visszaszivargo nev nem hianyzo szint ad, hanem MASIKAT -- es az
 * meg mindig nema minden kapunak, mert egy osztalynev sima sztring.
 *
 * EZ AZ ORZO AZERT LETEZIK, MERT PONTOSAN EZ TORTENT VELEM az atnevezes
 * kozben: egy fajl kimaradt, es a `format:check`, a `typecheck`, a `test` es
 * a `build` MIND ZOLD volt folotte. A negy kapu kozul egyik sem latja ezt a
 * hibafajtat -- egyik sem a kapuk hibaja, csak egyik sem errol szol.
 *
 * A MERES A KODRA MEGY, NEM A FAJL SZOVEGERE: a `globals.css` fejlece maga
 * IDEZI a regi nevet, amikor elmagyarazza, miert szunt meg. Egy szoveg-alapu
 * kereses ezen elbukna -- es akkor a sajat magyarazatunk tiltana meg, hogy
 * elmagyarazzuk a dolgot.
 */
const MEGSZUNT = ["teal", "slate"];

/**
 * A HATOKORE `apps/web/src`, ES EZT KI KELL MONDANI, MERT SZUKEBB, MINT A NEVE.
 *
 * A `packages/ui` hat komponense is hasznalta a regi nevet, es azok is
 * atalltak -- de ez a teszt oda NEM lat el. Egy visszaszivargas ONNAN ugyanugy
 * nema volna, es ez az orzo nem szolna rola.
 *
 * Nem "majd megcsinaljuk": azert all igy, mert egy webes egyseg-teszt, ami egy
 * masik CSOMAG forrasat olvassa, olyan fuggoseget kepez, ami a csomagok
 * hatarat mossa el. Ha a `packages/ui` is kap ilyet, az ODA valo, sajat
 * tesztkent. Addig ez a megjegyzes az, ami megakadalyozza, hogy valaki
 * TELJESNEK olvassa ezt a lefedest.
 */

function kodSzoveg(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

describe("megszűnt skálanevek", () => {
  const gyoker = join(__dirname, "..");
  const fajlok = readdirSync(gyoker, { recursive: true, encoding: "utf8" })
    .filter((nev) => /\.(ts|tsx|css)$/.test(nev) && !/\.test\.tsx?$/.test(nev))
    .map((nev) => join(gyoker, nev));

  /**
   * A FAJLLISTA MAGA IS ALLITAS, ES EDDIG NEM VOLT AZ.
   *
   * Ez a teszt korabban azt IRTA MAGAROL, hogy egy ures fajllista mellett is
   * zold lenne -- es a "pozitiv kontroll" nevu masodik allitas EGY SZTRINGEN
   * mert, nem a listan. Vagyis megnevezte a kockazatot, amit nem zart le.
   * Acrobot vette eszre a beolvasztas elott.
   *
   * ES A MECHANIZMUS KONKRET, NEM ELMELETI: a `readdirSync` `recursive`
   * kapcsoloja Node 18.17 elott nem letezik, es NEM HIBAZIK -- csak a legfelso
   * szintet adja vissza. Lemerve: az `apps/web/src` legfelso szintjen NULLA
   * fajl van (csupa mappa), tehat a szuro utan ures lista maradna, es mind a
   * ket allitas zold lenne. Egy Node-csere a CI kepfajlban NEMAN uritené ki
   * ezt az orzot -- ugyanabban az alakban, amirol az orzo maga szol.
   *
   * MA ez nem all fenn (a CI Node 22-n fut), tehat ez LATENS res volt, nem
   * elo hiba. Az also hatar 50, a mai szam 187: a kulonbseg azert ekkora, hogy
   * egy valodi fajl-torles ne vigye pirosra, egy KIURULES viszont igen.
   */
  it("a forrás egyetlen helyen sem hívja őket", () => {
    expect(fajlok.length).toBeGreaterThan(50);

    const talalatok: string[] = [];
    for (const f of fajlok) {
      const kod = kodSzoveg(readFileSync(f, "utf8"));
      for (const nev of MEGSZUNT) {
        const m = kod.match(new RegExp(`\\b${nev}-\\d{2,3}\\b`, "g"));
        if (m) talalatok.push(`${f.replace(gyoker, "")}: ${m.join(", ")}`);
      }
    }
    expect(talalatok).toEqual([]);
  });

  /**
   * POZITIV KONTROLL A TELJES UTRA, NEM CSAK A REGEXPRE.
   *
   * A korabbi valtozat egy SZTRING-LITERALON mert: az bizonyitotta, hogy a
   * `kodSzoveg` es a minta egyutt mukodik, de SEMMIT nem mondott arrol, hogy a
   * VALODI fajlokon is vegigfut. Ez az allitas ugyanazt a lancot jaratja meg a
   * lemezen levo fajlokon: ha barmelyik lepes (olvasas, komment-kiszedes,
   * illesztes) elnemulna, itt derulne ki -- nem a hianyt merve, hanem egy
   * ISMERT JELENLETET.
   */
  it("ugyanez a keresés megtalál egy nevet, amelyik tényleg ott van", () => {
    let talalt = 0;
    for (const f of fajlok) {
      if (/\bbrand-700\b/.test(kodSzoveg(readFileSync(f, "utf8")))) talalt += 1;
    }
    expect(talalt).toBeGreaterThan(5);
  });

  it("a komment-kiszedés nem eszi meg a valódi kódot", () => {
    const kod = kodSzoveg(
      `/* magyarazat: a teal-700 megszunt */\nconst a = "text-teal-700";`,
    );
    expect(kod).not.toMatch(/magyarazat/);
    expect(kod).toMatch(/\bteal-700\b/);
  });
});
