import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { maskCommentsAndStrings } from "../testing/source-mask.js";

/**
 * A TELEFON KÉPERNYŐI LÉTEZZENEK, ÉS A BEÁLLÍTÁSOK LEGYEN ELÉRHETŐ.
 *
 * MÉRVE 2026-08-28: a beállítás képernyő kész, a nyitólap alján a névre
 * koppintva nyílik -- és EZT SEMMI NEM TARTJA. Az `apps/mobile/src/app` mappa
 * alatt nulla teszt-fájl van, a telefon harmincegy specje mind logikát mér,
 * képernyőt egy sem, és nincs semmi, ami a `_layout.tsx` bejegyzéseit a
 * tényleges fájlokkal vetné össze.
 *
 * A HÁROM CSENDES TÖRÉS, ami emiatt lehetséges volt:
 * valaki átalakítja a nyitólap alját, és a `/settings` hivatkozás kimarad (a
 * képernyő ott marad, csak nem lehet odajutni); valaki átnevezi a fájlt, és a
 * hivatkozás elavul; vagy egy bejegyzés olyan nevet visel, amihez nincs fájl.
 * Egyik sem pirosított volna kaput: mind FUTÁSIDŐBEN derülne ki, telefonon.
 *
 * EZ A SPEC AZ API OLDALÁN ÁLL, NEM A TELEFONBAN, ugyanabból az okból, amiért a
 * `mobile-api-routes.spec.ts` is: egy őrző, ami abban a fordítási halmazban él,
 * amit őriznie kell, a halmaz szűkítésekor kiesik vele együtt, és zöld marad.
 *
 * ---
 *
 * A KÉT ÁLLÍTÁS NEM EGYFORMÁN FONTOS, és ha valaha vágni kell, az ELSŐ menjen.
 * Egy hiányzó képernyő azonnal feltűnik; egy ELÉRHETETLEN képernyő csak akkor,
 * ha valaki keresi.
 *
 * AMIT EZ AZ ŐRZŐ SZÁNDÉKOSAN NEM ÁLLÍT, és ez mérésen alapul, nem ízlésen:
 * nem követeli meg, hogy MINDEN képernyő-fájlhoz legyen `Stack.Screen`
 * bejegyzés. A telefonban ma a `partners/index` és a `partners/[id]` bejegyzés
 * NÉLKÜL működik (mérve ugyanaznap): az útvonalakat a fájlrendszer adja, a
 * bejegyzés csak a fejléc-beállítást. Egy ilyen szabály tehát MA IS kipirulna,
 * jogos kódon -- és egy őrző, ami jogos kódra pirosodik, az, amit valaki
 * előbb-utóbb kikapcsol.
 *
 * EBBŐL KÖVETKEZIK EGY MEGLEPŐ, DE HELYES VISELKEDÉS: ha valaki kiveszi a
 * beállítások `Stack.Screen` sorát, ez az őrző ZÖLD MARAD. Nem mulasztás: a
 * képernyő attól még elérhető, csak az alapértelmezett fejlécet kapja. Az
 * elérhetőséget a MÁSODIK állítás őrzi, és az két dolgon áll -- a fájlon és a
 * rá mutató hivatkozáson --, nem a bejegyzésen.
 */

const APP_DIR = "../mobile/src/app";
const LAYOUT = join(APP_DIR, "_layout.tsx");
const HOME = join(APP_DIR, "index.tsx");
const SETTINGS_ROUTE = "/settings";

/** Az első string- vagy template-literál a megadott pozíciótól, vagy `null`. */
function literalAt(source: string, at: number): string | null {
  const rest = source.slice(at);
  const match = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1/.exec(rest);
  return match ? match[2]! : null;
}

/**
 * A `_layout.tsx` bejegyzései. A keresés a maszkon fut, a NÉV kiolvasása az
 * eredetiből, azonos pozíción.
 */
export function registeredScreens(source: string): string[] {
  const masked = maskCommentsAndStrings(source);
  const names: string[] = [];
  for (const element of masked.matchAll(/<Stack\.Screen\b/g)) {
    const from = element.index;
    const end = masked.indexOf(">", from);
    const chunk = masked.slice(from, end === -1 ? masked.length : end);
    const attribute = /\bname\s*=\s*/.exec(chunk);
    if (!attribute) continue;
    const name = literalAt(
      source,
      from + attribute.index + attribute[0].length,
    );
    if (name) names.push(name);
  }
  return names;
}

/**
 * Amire egy képernyő NAVIGÁL. A hívás alakját a maszkon keressük, a CÉLT az
 * eredetiből olvassuk -- az útvonal maga is sztring, tehát a maszkban már nincs
 * meg.
 */
export function navigationTargets(source: string): string[] {
  const masked = maskCommentsAndStrings(source);
  const targets: string[] = [];
  const patterns = [
    /router\s*\.\s*(?:push|replace|navigate)\s*\(\s*/g,
    /\bhref\s*=\s*\{?\s*/g,
  ];
  for (const pattern of patterns)
    for (const match of masked.matchAll(pattern)) {
      const target = literalAt(source, match.index + match[0].length);
      if (target) targets.push(target);
    }
  return targets;
}

/** Van-e fájl ehhez a bejegyzés-névhez. Az expo-router mindkét alakot ismeri. */
function screenFileExists(name: string): boolean {
  return (
    existsSync(join(APP_DIR, `${name}.tsx`)) ||
    existsSync(join(APP_DIR, name, "index.tsx"))
  );
}

describe("a telefon képernyői a helyükön vannak", () => {
  it("minden Stack.Screen bejegyzéshez van képernyő-fájl", () => {
    const names = registeredScreens(readFileSync(LAYOUT, "utf8"));
    assert.ok(
      names.length > 0,
      "egyetlen Stack.Screen bejegyzés sem olvasódott ki -- vagy a fájl alakja változott, és akkor EZT a specet kell átalakítani ugyanabban a változásban",
    );
    assert.deepEqual(
      names.filter((name) => !screenFileExists(name)),
      [],
      "a _layout.tsx olyan képernyőt nevez meg, amihez nincs fájl",
    );
  });

  /**
   * A FONTOSABB ÁLLÍTÁS. Két dolgon áll, és mindkettő kell: a képernyő fájlja
   * létezik, és a nyitólap navigál rá. Bármelyik hiánya elérhetetlen
   * képernyőt hagy, ami rosszabb, mint a hiányzó -- azt ugyanis senki nem
   * keresi, tehát senki nem is jelenti.
   */
  it("a beállítások képernyő elérhető a nyitólapról", () => {
    assert.ok(
      screenFileExists("settings"),
      "nincs beállítások képernyő-fájl az app mappában",
    );
    const targets = navigationTargets(readFileSync(HOME, "utf8"));
    assert.ok(
      targets.includes(SETTINGS_ROUTE),
      `a nyitólap nem navigál a ${SETTINGS_ROUTE} útvonalra. A gazda kérése szerint a lap alján a névre koppintva kell nyílnia; a képernyő megléte önmagában nem elég, mert oda nem vezetne út. A nyitólapon talált célok: ${targets.join(", ") || "(egy sem)"}`,
    );
  });
});
