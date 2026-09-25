import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A FIGMA TELEFON 12. KÖR, 6. CSOPORT SZÍN-ELLENŐRZÉSE.
 *
 * A brief (`exchange/figma-telefon-atultetes-brief-2026-09-25.md`)
 * ellenőrzési pontja szó szerint: "képernyőnként egy teszt, hogy a téma-
 * színek a `useAppTheme`-ből jönnek (nincs fix hex, a kamera-rátéten
 * kívül)". Ez a fájl a 6. csoport három képernyőjét méri forrás-szöveg
 * alapján -- nem futtatja a komponenseket, a `#rrggbb`/`#rgb` (és az
 * alfa-csatornás `#rrggbbaa`) alakú literálok JELENLÉTÉT nézi.
 *
 * === FONTOS: EZ A FÁJL `src/lib/` ALATT ÁLL, NEM `src/app/` ALATT ===
 *
 * Ugyanezt a hibát ma (2026-09-25) négyszer mérte acrobot nautilus PR-jein:
 * az expo-router a `src/app/` ALATTI FÁJLOKAT útvonalként fordítja, egy
 * `.spec.ts` fájl is beleesik, és a `npm run export:web` erre elhasal.
 * Ez a fájl ezért itt van, és a gate-hez tartozó `export:web` futtatás
 * (lásd a PR-leírást) ezt igazolja vissza.
 */

function kodSzoveg(forras: string): string {
  return forras.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** `#abc`, `#aabbcc`, `#aabbccdd` -- a React Native mindhárom alakot érti. */
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function hexTalalatok(kod: string): string[] {
  return kod.match(HEX) ?? [];
}

const APP = join(process.cwd(), "src", "app");
const UJ_AKVARIUM = join(APP, "aquariums", "new.tsx");
const SCANNER = join(APP, "assets", "scanner.tsx");
const SCAN_EREDMENY = join(APP, "assets", "scan", "[token].tsx");

function olvas(ut: string): string {
  return readFileSync(ut, "utf8");
}

describe("12. kör, 6. csoport -- nincs fix hex a useAppTheme() helyett", () => {
  /**
   * ISMERT POZITÍV KONTROLL: a felismerő TÉNYLEG talál hexet egy olyan
   * mintán, amilyen a javítás ELŐTT állt a három fájlban (pl. `#52d6c7`,
   * a régi akcent-szín). Ha ez a kontroll zöld lenne akkor is, ha a minta
   * semmit nem fogna meg, a lenti hiány-állítások értelmüket vesztenék --
   * ugyanaz az elv, mint a `visual-base.spec.ts`/`portal-shell-theme.spec.ts`
   * családban.
   */
  it("ISMERT POZITÍV KONTROLL: a felismerő fogja a régi, beégetett hexet", () => {
    const regiMinta =
      'const styles = StyleSheet.create({ a: { color: "#52d6c7", backgroundColor: "#071827cc" } });';
    assert.deepEqual(hexTalalatok(kodSzoveg(regiMinta)), [
      "#52d6c7",
      "#071827cc",
    ]);
  });

  it("aquariums/new.tsx: nincs beégetett hex, minden szín useAppTheme()-ből jön", () => {
    const kod = kodSzoveg(olvas(UJ_AKVARIUM));
    assert.deepEqual(
      hexTalalatok(kod),
      [],
      "az Új akvárium képernyőn beégetett hex maradt -- ellenőrizd, hogy createStyles(t) minden színe t.*-ból jön-e",
    );
    // POZITÍV KONTROLL, HOGY A FÁJL TÉNYLEG A TOKENEKET HASZNÁLJA, nem csak
    // a hex hiányzik: a `useAppTheme` és a `createStyles(t)` minta jelen van.
    assert.match(kod, /useAppTheme\(\)/);
    assert.match(kod, /function createStyles\(t: ThemeTokens\)/);
  });

  it("assets/scan/[token].tsx: nincs beégetett hex, minden szín useAppTheme()-ből jön", () => {
    const kod = kodSzoveg(olvas(SCAN_EREDMENY));
    assert.deepEqual(
      hexTalalatok(kod),
      [],
      "a beolvasás-eredmény képernyőn beégetett hex maradt",
    );
    assert.match(kod, /useAppTheme\(\)/);
    assert.match(kod, /function createStyles\(t: ThemeTokens\)/);
  });

  /**
   * A SCANNER.TSX EGYETLEN KIVÉTELE: a kamera-rátét rögzített színei
   * (`CAMERA_MANUAL_PLACEHOLDER`-től a `cameraStyles` blokk végéig,
   * lásd a fájl saját fejlécét) -- a brief kifejezetten kéri, hogy ez
   * maradjon sötét, függetlenül az app témájától. A kivétel a NÉVRE szűr:
   * a régiót kivágom a forrásból, és a MARADÉKOT vizsgálom -- ha valaki a
   * `createStyles(t)`-en belül tenne be fix hexet, azt ez elkapja.
   */
  it("assets/scanner.tsx: a kamera-rátéten KÍVÜL nincs beégetett hex", () => {
    const nyers = kodSzoveg(olvas(SCANNER));
    const kivagva = nyers.replace(
      /const CAMERA_MANUAL_PLACEHOLDER[\s\S]*?\nconst cameraStyles = StyleSheet\.create\(\{[\s\S]*?\n\}\);/,
      "",
    );
    assert.notEqual(
      kivagva.length,
      nyers.length,
      "a kamera-rátét blokkjának kivágása nem talált semmit -- a minta elromlott, a lenti állítás ezért hamisan zöld lehetne",
    );
    assert.deepEqual(
      hexTalalatok(kivagva),
      [],
      "a kamera-rátéten kívül (a Kameraengedély szükséges kártyán) beégetett hex maradt",
    );
    assert.match(kivagva, /useAppTheme\(\)/);
    assert.match(kivagva, /function createStyles\(t: ThemeTokens\)/);
  });

  /**
   * A KIVÉTEL NEM TAKARHAT EL EGY VALÓDI HIÁNYT: ha a `cameraStyles` blokk
   * ÜRES lenne hextől (mert valaki már token-re váltotta, vagy a blokk
   * neve megváltozott, és a fenti kivágás csendben nullát vág ki), ez az
   * állítás szólna. A kamera-rátétnek KELL fix hexet tartalmaznia -- ez a
   * brief kifejezett kérése, nem hiányzó munka.
   */
  it("assets/scanner.tsx: a kamera-rátét blokkja TÉNYLEG fix hexet tartalmaz (a kivétel nem üres)", () => {
    const nyers = kodSzoveg(olvas(SCANNER));
    const match = nyers.match(
      /const CAMERA_MANUAL_PLACEHOLDER[\s\S]*?\nconst cameraStyles = StyleSheet\.create\(\{[\s\S]*?\n\}\);/,
    );
    assert.ok(match, "nem találom a kamera-rátét rögzített blokkját");
    assert.ok(
      hexTalalatok(match![0]).length > 0,
      "a kamera-rátét blokkja üres hextől -- a fenti kivétel most feleslegesen tág",
    );
  });
});
