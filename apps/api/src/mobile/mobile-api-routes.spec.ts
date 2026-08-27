import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A TELEFON ÁLTAL HÍVOTT CÍM LÉTEZZEN A SZERVEREN.
 *
 * MÉRVE 2026-08-27, éles hibából: a mobil munkalap-képernyő teljesen
 * használhatatlan volt, mert a kliens `/worksheets` alá hívott, a controller
 * viszont a `service/worksheets` előtag alatt ül. A telefon képernyőjén ennyi
 * látszott: `Cannot GET /worksheets?page=1&pageSize=25`.
 *
 * ÉS MINDEN KAPU ZÖLD VOLT. A mobil tesztek a képernyőt nézik, az API tesztek
 * az útvonalat, és a kettő között nem volt olyan ellenőrzés, ami összevetette
 * volna őket. Ugyanabban a mappában az `assets.ts` végig helyesen hívott
 * (`/service/assets`), ezért működött az eszköz rész és nem működött a munkalap:
 * a hiba egyetlen fájlra korlátozódott, és semmi nem szólt róla.
 *
 * EZ A SPEC AZ API OLDALÁN ÁLL, NEM A MOBILBAN, és ez nem elhelyezési ízlés.
 * Ma délután pontosan az sült el, hogy egy őrző abban a fordítási halmazban
 * élt, amit őriznie kellett volna: a halmaz szűkítésekor kiesett vele együtt,
 * és zöld maradt. Innen mind a két oldal kívülről látszik.
 *
 * AMIT EZ AZ ŐRZŐ NEM NÉZ, és ezért itt áll kiírva, nem a PR-ben elrejtve:
 *
 * - A HTTP METÓDUST nem veti össze. A mobil oldalon a metódus a hívás második
 *   argumentumában áll, és a kiolvasása külön elemzést kívánna. Ha valaki
 *   `POST`-tal hív egy csak `GET`-re létező címet, azt ez nem fogja meg.
 * - A LEKÉRDEZŐ RÉSZT (`?...`) levágja: az nem az útvonal része.
 * - CSAK a `lib/api` mappa kliens-fájljait nézi. Ha valaki a képernyőn
 *   közvetlenül hív `fetch`-et, az ezen kívül esik.
 *
 * Amit viszont NEM tesz: nem hallgat el egy fájlt, amit nem tudott elemezni.
 * Ha egy `apiRequest` hívásból nem olvasható ki az útvonal, az BUKÁS, nem néma
 * kihagyás -- különben az őrző pont azon az új alakon vakulna meg, amit
 * őriznie kellene.
 */

const MOBILE_API_DIR = "../mobile/src/lib/api";
const API_SRC = "src";

/** A kliens maga és a hitelesítés nem hív végpontot, csak becsomagolja. */
const NOT_A_CLIENT = new Set(["client.ts", "request-auth.ts"]);

interface MobileCall {
  file: string;
  raw: string;
  pattern: string;
}

/**
 * Egy útvonal összehasonlítható alakja: vezető `/` nélkül, lekérdező rész
 * nélkül, és minden behelyettesítés `:param` alakban. A szerver `:id` és a
 * mobil `${id}` ugyanazt jelenti, csak máshogy írják.
 */
function toPattern(path: string): string {
  return path
    .replace(/\?.*$/, "")
    .replace(/\$\{[^}]*\}/g, ":param")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .map((segment) => (segment.startsWith(":") ? ":param" : segment))
    .join("/");
}

function mobileCalls(): MobileCall[] {
  const calls: MobileCall[] = [];
  for (const file of readdirSync(MOBILE_API_DIR).sort()) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    if (NOT_A_CLIENT.has(file)) continue;
    const source = readFileSync(join(MOBILE_API_DIR, file), "utf8");
    // A hívás lehet többsoros: a generikus paraméter és a nyitó zárójel után
    // az útvonal a következő nem üres jel.
    for (const match of source.matchAll(/apiRequest\s*(?:<[^>]*>)?\s*\(\s*/g)) {
      const rest = source.slice(match.index + match[0].length);
      const literal = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1/.exec(rest);
      assert.ok(
        literal,
        `${file}: egy apiRequest hívásból nem olvasható ki az útvonal. Az őrző nem hagyhatja ki némán -- vagy az alak új, vagy a hívás nem literálból építi az utat.`,
      );
      calls.push({
        file,
        raw: literal[2]!,
        pattern: toPattern(literal[2]!),
      });
    }
  }
  return calls;
}

function serverPatterns(): Set<string> {
  const patterns = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".controller.ts")) {
        const source = readFileSync(full, "utf8");
        const controller = /@Controller\(\s*(?:["']([^"']*)["'])?\s*\)/.exec(
          source,
        );
        if (!controller) continue;
        const prefix = controller[1] ?? "";
        for (const route of source.matchAll(
          /@(?:Get|Post|Patch|Put|Delete)\(\s*(?:["']([^"']*)["'])?\s*[,)]/g,
        )) {
          const joined = [prefix, route[1] ?? ""].filter(Boolean).join("/");
          patterns.add(toPattern(joined));
        }
      }
    }
  };
  walk(API_SRC);
  return patterns;
}

describe("a telefon csak létező szerver-végpontot hív", () => {
  /**
   * A KONTROLL: mind a két oldalról tényleg jön adat, és a mennyiség
   * nagyságrendileg stimmel. Enélkül két üres halmaz is "egyezne", és a teszt
   * zölden hallgatna arról, hogy nem nézett meg semmit.
   */
  it("reads both sides", () => {
    const calls = mobileCalls();
    const patterns = serverPatterns();
    assert.ok(calls.length >= 10, `kevés mobil hívás: ${calls.length}`);
    assert.ok(patterns.size >= 50, `kevés szerver-útvonal: ${patterns.size}`);
    // A kontroll másik fele: egy útvonal, amiről tudjuk, hogy mindkét oldalon
    // létezik. Ha ez sem található, a kereső romlott el, nem a kód.
    assert.ok(
      patterns.has("service/assets"),
      "a service/assets nincs a szerver mintái közt",
    );
    assert.ok(
      calls.some((call) => call.pattern === "service/assets"),
      "a service/assets nincs a mobil hívások közt",
    );
  });

  it("every mobile path has a server route", () => {
    const patterns = serverPatterns();
    const missing = mobileCalls().filter((call) => !patterns.has(call.pattern));
    assert.deepEqual(
      missing.map((call) => `${call.file}: ${call.raw}`),
      [],
      "a telefon olyan címet hív, ami a szerveren nem létezik",
    );
  });
});
