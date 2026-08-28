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
 * - A közvetlen `fetch` hívást nem nézi. Ez az őrző az `apiRequest`-en át menő
 *   forgalmat méri; aki megkerüli, azt nem látja. (Mérve 2026-08-28: ma a
 *   mobilban nincs ilyen hívás.)
 *
 * Amit viszont NEM tesz: nem hallgat el egy fájlt, amit nem tudott elemezni.
 * Ha egy `apiRequest` hívásból nem olvasható ki az útvonal, az BUKÁS, nem néma
 * kihagyás -- különben az őrző pont azon az új alakon vakulna meg, amit
 * őriznie kellene.
 *
 * ---
 *
 * AMIT EZ AZ ŐRZŐ FEL TUD OLDANI, ÉS AMIT NEM:
 *
 * Az útvonal jöhet LITERÁLBÓL a hívás helyén, vagy a fájl saját, string értékű
 * `const` deklarációjából -- akár csupasz azonosítóként (`apiRequest(BASE, …)`),
 * akár behelyettesítve (`` `${BASE}/owners` ``). A kliensek 2026-08-27 óta ezt a
 * második alakot használják: az előtag fájlonként EGY helyen áll.
 *
 * AMIT NEM LÁT: a MÁSIK fájlból importált konstanst és a path-helper függvényt.
 * Ilyenkor nem hallgat, hanem BUKIK -- lásd fent. A webes kliens ma helpert is
 * használ, ezért egy webre kiterjesztés előbb a helper-feloldást kívánná meg;
 * mérve 2026-08-27, a webes mappán ez a logika tizenhárom ilyen hívást talál.
 *
 * A KÖTELEZETTSÉG, AMI EBBŐL KÖVETKEZIK, és amiért ez a bekezdés itt áll: ha a
 * kliensek alakja megint változik, ezt a specet UGYANABBAN A VÁLTOZÁSBAN kell
 * átalakítani. Külön lépésben az őrző hamisan pirosodna, és a következő ember
 * azt hinné, hogy ő rontott el valamit. (Ez a bekezdés maga is így készült: az
 * átállás és ez az átalakítás egy ágon ment.)
 */

/**
 * A TELJES mobil forrás, nem egyetlen mappa.
 *
 * MÉRVE 2026-08-28: az első alak csak a `lib/api` mappát olvasta, egy szintet.
 * A `lib/auth/api.ts` közvetlenül mellette áll, ugyanazt az `apiRequest`-et
 * hívja, és négy helyen írja ki az `/auth` előtagot -- vagyis pont abban az
 * alakban, ami az előző esti éles hibát okozta. Két szándékos rontás döntötte
 * el, hogy tényleg kívül esett: a `worksheets.ts` előtagját elrontva az őrző
 * PIROS lett, a `lib/auth/api.ts` útvonalát elrontva ZÖLD MARADT.
 *
 * A mappa-alapú hatókör ezért nem szűkítés volt, hanem vakfolt: nem a kód
 * alakjából következett, hanem abból, hogy hova tettük a fájlt.
 */
const MOBILE_SRC = "../mobile/src";
const API_SRC = "src";

/**
 * Az `apiRequest` maga és a hitelesítő fejléce nem hív végpontot, csak
 * becsomagolja. ÚTVONALLAL, nem fájlnévvel: rekurzív bejárásban egy puszta
 * `client.ts` név egy jövőbeli, MÁSIK mappában lévő klienst is némán kihagyna.
 */
const NOT_A_CLIENT = new Set(["lib/api/client.ts", "lib/api/request-auth.ts"]);

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

/** A fájl saját, string értékű `const` deklarációi: `const BASE = "/service/assets";`. */
function constantsOf(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(
    /^const\s+([A-Za-z_$][\w$]*)\s*=\s*(["'])((?:\\.|(?!\2)[^\\])*)\2\s*;/gm,
  ))
    constants.set(match[1]!, match[3]!);
  return constants;
}

/** Minden forrásfájl a mobilban, a gyökérhez képesti úttal. */
function mobileSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(join(dir, entry.name), relative);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.spec\.tsx?$/.test(entry.name)) continue;
      if (NOT_A_CLIENT.has(relative)) continue;
      files.push(relative);
    }
  };
  walk(MOBILE_SRC, "");
  return files;
}

function mobileCalls(): MobileCall[] {
  const calls: MobileCall[] = [];
  for (const file of mobileSourceFiles()) {
    const source = readFileSync(join(MOBILE_SRC, file), "utf8");
    if (!source.includes("apiRequest")) continue;
    const constants = constantsOf(source);
    // A hívás lehet többsoros: a generikus paraméter és a nyitó zárójel után
    // az útvonal a következő nem üres jel.
    for (const match of source.matchAll(/apiRequest\s*(?:<[^>]*>)?\s*\(\s*/g)) {
      const rest = source.slice(match.index + match[0].length);
      const literal = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1/.exec(rest);
      // A csupasz azonosító alak: `apiRequest(BASE, { method: "POST" })`.
      const bare = /^([A-Za-z_$][\w$]*)\s*[,)]/.exec(rest);
      const raw = literal
        ? literal[2]!
        : bare && constants.has(bare[1]!)
          ? constants.get(bare[1]!)!
          : null;
      assert.ok(
        raw !== null,
        `${file}: egy apiRequest hívásból nem olvasható ki az útvonal. Az őrző nem hagyhatja ki némán -- vagy az alak új, vagy a hívás olyan konstansból épít, amit ez a fájl nem deklarál (például importáltból vagy helperből).`,
      );
      // A fájlon belüli konstansok behelyettesítése; ami marad, azt a toPattern
      // teszi `:param` alakúvá.
      const resolved = raw.replace(
        /\$\{([A-Za-z_$][\w$]*)\}/g,
        (whole, name: string) => constants.get(name) ?? whole,
      );
      calls.push({ file, raw, pattern: toPattern(resolved) });
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
    // A NYERS ALAK ÉS A FELOLDOTT MINTA IS KELL. A nyers megmondja, MELYIK SORT
    // kell megnyitni; a feloldott azt, MI LETT belőle -- és egy konstansból épülő
    // hívásnál a kettő nem ugyanaz. Csak a nyerssel a hibaüzenet `${BASE}/owners`
    // lenne, amiből nem derül ki, mi a rossz előtag.
    assert.deepEqual(
      missing.map((call) => `${call.file}: ${call.raw}  ->  ${call.pattern}`),
      [],
      "a telefon olyan címet hív, ami a szerveren nem létezik",
    );
  });
});
