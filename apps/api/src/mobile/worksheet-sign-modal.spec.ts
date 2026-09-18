import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { maskCommentsAndStrings } from "../testing/source-mask.js";

/**
 * AZ ALAIRAS KEPERNYOJE FEDO MODALISKENT NYILIK, ES A KIFELE VEZETO UT ZART.
 *
 * === MIERT VAN ORZO EGY KET SOROS NAVIGACIOS BEALLITASON ===
 *
 * Balazs kerese, 2026-09-18 07:01 UTC, szo szerint: "Szeretnek egy Alairas
 * gombot az aljara. ha azt megnyomjuk akkor egy felugro ablakban..."
 *
 * A "felugro ablak" itt NEM elrendezesi izles. Ezt a kepernyot a szerelo
 * ODAADJA az ugyfelnek (a keperno sajat fejlece mondja ki, 2026-09-03 ota). A
 * mogotte allo munkalap-adatlapon tetel-felvitel es torles van: egy veletlen
 * lehuzo mozdulat az ugyfel kezebe adna a szerelo munkaeszkozet.
 *
 * A VEDELEM KIZAROLAG KET NAVIGACIOS OPCION ALL:
 *
 *   presentation: "fullScreenModal"   a mogotte levo lap nem latszik
 *   gestureEnabled: false             lehuzassal nem lehet visszajutni ra
 *
 * Ha barmelyik kikerul, SEMMI nem szol: a fordulas zold, minden teszt zold, es
 * a kepernyo tovabbra is megnyilik -- csak epp lehuzhatova valik, egy atadott
 * telefonon. Ezert all itt allitas.
 *
 * === AMIT EZ AZ ORZO NEM BIZONYIT, ES KI KELL MONDANI ===
 *
 * Azt meri, hogy a KET OPCIO OTT ALL, nem azt, hogy a futo alkalmazas tenyleg
 * fedi a hatteret. Az utobbi keszuleken lathato, es az appban nulla
 * komponens-teszt van. A ket opcio jelentese az `expo-router` natv
 * vermeenek a szerzodese, es azt a fordito tartja: a `presentation` erteke
 * zart halmaz, egy elgepelt alak forditasi hiba.
 *
 * === MIERT AZ API OLDALAN ALL ===
 *
 * Ugyanaz az ok, amiert a `mobile-screen-routes.spec.ts` is itt ul: egy orzo,
 * ami abban a forditasi halmazban el, amit oriznie kell, a halmaz szukitesekor
 * kiesik vele egyutt, es zold marad.
 */

const LAYOUT = "../mobile/src/app/_layout.tsx";
const DETAIL = "../mobile/src/app/worksheets/[id].tsx";
const SIGN_ROUTE = "worksheets/sign/[id]";

function forras(ut: string): string {
  const s = readFileSync(join(ut), "utf8");
  assert.ok(s.length > 500, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

/** Az elso sztring-literal a megadott poziciotol, vagy `null`. */
function literalAt(source: string, at: number): string | null {
  const match = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1/.exec(source.slice(at));
  return match ? match[2]! : null;
}

/**
 * EGY `<Stack.Screen>` ELEM HATARAI, A NEVE ALAPJAN.
 *
 * A HATAROKAT A MASZKON KERESSUK, hogy egy komment ne tudja meghosszabbitani az
 * elemet -- a KIOLVASAS viszont az EREDETIN tortenik, azonos poziciokon.
 *
 * AZ ELSO ALAKOM ITT ELHASALT, ES A HIBA TANULSAGOS: a maszkolt szoveget adtam
 * vissza, tehat a keresett ERTEK (`"fullScreenModal"`) is ki volt feherítve. A
 * maszk a kereseshez kell, nem a kiolvasashoz.
 */
function screenRange(
  source: string,
  nev: string,
): { from: number; to: number } {
  const masked = maskCommentsAndStrings(source);
  for (const talalat of masked.matchAll(/<Stack\.Screen\b/g)) {
    const from = talalat.index;
    const to = masked.indexOf("/>", from);
    assert.notEqual(to, -1, "nem találtam az elem végét");
    if (source.slice(from, to).includes(`"${nev}"`)) return { from, to };
  }
  assert.fail(`nem találtam Stack.Screen elemet ehhez: ${nev}`);
}

/**
 * EGY BEALLITAS SZTRING-ERTEKE az adott kepernyo elemeben, vagy `null`.
 *
 * A KULCSOT a maszkon keressuk (igy egy komment nem talalat), az ERTEKET az
 * eredetibol olvassuk ki ugyanarrol a poziciorol.
 */
function opcioSzoveg(
  source: string,
  nev: string,
  kulcs: string,
): string | null {
  const { from, to } = screenRange(source, nev);
  const masked = maskCommentsAndStrings(source).slice(from, to);
  const m = new RegExp(`\\b${kulcs}\\s*:\\s*`).exec(masked);
  return m ? literalAt(source, from + m.index + m[0].length) : null;
}

/** Egy beallitas NEM sztring erteke (`false`, `true`, szam) ugyanigy. */
function opcioNyers(source: string, nev: string, kulcs: string): string | null {
  const { from, to } = screenRange(source, nev);
  const masked = maskCommentsAndStrings(source).slice(from, to);
  const m = new RegExp(`\\b${kulcs}\\s*:\\s*([A-Za-z0-9_]+)`).exec(masked);
  return m ? m[1]! : null;
}

describe("az aláírás képernyője fedő modálisként nyílik", () => {
  const layout = forras(LAYOUT);

  /**
   * POZITIV KONTROLL: ha a kereso rossz utat kapna vagy az elem-kivagas
   * elromlana, ket URES szoveget vetnenk ossze, zolden. Egy ISMERT, mas
   * kepernyo szolgal referenciakent -- annak NINCS modalis beallitasa, tehat
   * a ket allitas egyutt azt is megmutatja, hogy a kereso KULONBOZTET.
   */
  it("POZITÍV KONTROLL: a kiolvasás lát, és meg is különböztet", () => {
    assert.equal(opcioSzoveg(layout, SIGN_ROUTE, "title"), "Munkalap aláírása");
    /*
      EGY ISMERT, MAS KEPERNYO referenciakent: annak NINCS modalis beallitasa.
      A ket allitas egyutt mutatja meg, hogy a kiolvaso KULONBOZTET -- egy
      olyan kereso, ami mindenre igazat mond, ugyanugy zold lenne.
    */
    assert.equal(opcioSzoveg(layout, "settings", "presentation"), null);
    assert.equal(opcioNyers(layout, "settings", "gestureEnabled"), null);
  });

  it('FEDŐ: `presentation: "fullScreenModal"`', () => {
    /*
      MI PIROSIT: az opcio elhagyasa, vagy a gyengebb "modal" ertek. Az utobbi
      iOS-en LEHUZHATO lapot ad, amin a mogotte levo adatlap latszik -- vagyis
      pont az a viselkedes, ami ellen ez keszult.
    */
    assert.equal(
      opcioSzoveg(layout, SIGN_ROUTE, "presentation"),
      "fullScreenModal",
    );
  });

  it("ZÁRT: `gestureEnabled: false`", () => {
    /*
      MI PIROSIT: az opcio elhagyasa vagy `true`-ra allitasa. Enelkul egy
      lehuzo mozdulat az ATADOTT telefonon visszavinne a szerkesztheto lapra.
    */
    assert.equal(opcioNyers(layout, SIGN_ROUTE, "gestureEnabled"), "false");
  });

  it("a munkalap adatlapja ERRE az útvonalra visz", () => {
    /*
      A KET ALLITAS EGYUTT ER VALAMIT: a fenti harom azt meri, hogy a
      REGISZTRACIO helyes; ez azt, hogy oda is megyunk. Egy atnevezett utvonal
      mellett a fenti harom zold maradna, es a gomb sehova nem vinne.
    */
    const detail = forras(DETAIL);
    assert.ok(
      maskCommentsAndStrings(detail).includes("pathname"),
      "a részletlap nem navigál sehova",
    );
    assert.ok(detail.includes(`"/${SIGN_ROUTE}"`));
  });
});
