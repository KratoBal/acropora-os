import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

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

/**
 * A forrás úgy, hogy a KOMMENTEK és a SZTRING-TARTALMAK ki vannak fehérítve, de
 * a hossz és minden pozíció VÁLTOZATLAN.
 *
 * UGYANAZ A MASZK, amit a `mobile-api-routes.spec.ts` olvasója kapott a
 * komment-szűrésről szóló körben, és ugyanabból az okból: egy őrző, ami nyers
 * forráson keres, egy MONDATOT a hívásról ugyanolyannak lát, mint magát a
 * hívást. Ott ez mérésből derült ki, egy webes fájlon, ami nulla valódi hívást
 * tartalmaz, mégis megbuktatta az őrzőt.
 *
 * MIÉRT ÁLL ITT MÁSODSZOR IS, és mi a teendő vele: az a változás külön ágon
 * várakozik, és a fájlját két nyitott PR is írja, tehát oda most nem lehet
 * közös helyre kiemelni anélkül, hogy mindkettőt megbolygatnánk. AMIKOR az a
 * kör beolvad, ez a két másolat EGY helyre kerül, és mindkét őrző onnan
 * importálja -- különben a kettő csendben elválik egymástól.
 *
 * MIÉRT MASZK ÉS NEM TÖRLÉS: a keresés a maszkon fut, a KIOLVASÁS az EREDETIN,
 * ugyanazon a pozíción. Törléssel minden későbbi eltolás elcsúszna, és az a
 * hiba néma lenne: rossz szelet, nem hibaüzenet.
 */
function maskCommentsAndStrings(source: string): string {
  const out = source.split("");
  const blank = (index: number): void => {
    if (out[index] !== "\n") out[index] = " ";
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") blank(index++);
      continue;
    }
    if (char === "/" && next === "*") {
      blank(index++);
      blank(index++);
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      )
        blank(index++);
      if (index < source.length) {
        blank(index++);
        blank(index++);
      }
      continue;
    }
    if (char === '"' || char === "'") {
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === "\\") blank(index++);
        if (index < source.length) blank(index++);
      }
      index += 1;
      continue;
    }
    if (char === "`") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          blank(index++);
          if (index < source.length) blank(index++);
          continue;
        }
        if (source[index] === "`") {
          index += 1;
          break;
        }
        // A `${` KÓD, tehát nem fehérítjük ki: ott állhat valódi hivatkozás, és
        // elrejteni a NEM-NÉZÉS irányába tévedés lenne, ami a csendes irány.
        if (source[index] === "$" && source[index + 1] === "{") {
          index += 2;
          let depth = 1;
          while (index < source.length && depth > 0) {
            if (source[index] === "{") depth += 1;
            else if (source[index] === "}") depth -= 1;
            index += 1;
          }
          continue;
        }
        blank(index++);
      }
      continue;
    }
    index += 1;
  }
  return out.join("");
}

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
