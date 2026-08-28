import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A KLIENSEK ÁLTAL HÍVOTT CÍM LÉTEZZEN A SZERVEREN (telefon ÉS webes felület).
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
 * A path-helpert is feloldja, ha az EGYETLEN `return` template literálból áll -- ez a
 * webes kliens alakja (`worksheetPath(id, "/close")`), és a template literálon BELÜL
 * álló helper-hívást (`` `${worksheetPath(id)}/continue` ``) ugyanúgy kezeli.
 *
 * AMIT NEM LÁT: a MÁSIK fájlból importált konstanst, és az olyan helpert, aminek a
 * törzse nem egyetlen `return`. Ilyenkor nem hallgat, hanem BUKIK -- lásd fent.
 *
 * A WEBES KLIENST 2026-08-27 ÓTA NÉZI. A kiterjesztés előtt tizenhárom hívást nem
 * tudott kiolvasni (hét konstansból, hat helperből épült), és mind a tizenhárom HELYES
 * volt; a feloldás nélkül tehát tizenhárom hamis pirosat adott volna.
 *
 * A KÖTELEZETTSÉG, AMI EBBŐL KÖVETKEZIK, és amiért ez a bekezdés itt áll: ha a
 * kliensek alakja megint változik, ezt a specet UGYANABBAN A VÁLTOZÁSBAN kell
 * átalakítani. Külön lépésben az őrző hamisan pirosodna, és a következő ember
 * azt hinné, hogy ő rontott el valamit. (Ez a bekezdés maga is így készült: az
 * átállás és ez az átalakítás egy ágon ment.)
 */

const MOBILE_API_DIR = "../mobile/src/lib/api";
const WEB_API_DIR = "../web/src/lib/api";
const API_SRC = "src";

/** A kliens maga és a hitelesítés nem hív végpontot, csak becsomagolja. */
const NOT_A_CLIENT = new Set(["client.ts", "request-auth.ts"]);

interface ClientCall {
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
  const PLACEHOLDER = "\u0000";
  return path
    .replace(/\?.*$/, "")
    .replace(/\$\{[^}]*\}/g, PLACEHOLDER)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .map((segment) => {
      // KÜLÖN SZEGMENS a behelyettesítés -> paraméter. Ha viszont TAPAD egy
      // szöveghez (`owners${query}`), akkor a szegmens azonosítható része az
      // `owners`, a maradék pedig lekérdező rész vagy toldalék.
      //
      // AMIT EZ NEM FOG MEG, és ezért áll itt kiírva: ha valaki egy VALÓDI
      // útvonal-részt ragaszt egy szegmenshez (`/tasks/${kind}sort`), az őrző
      // a `tasks/sort` mintát látja, és ha az véletlenül létezik a szerveren,
      // átengedi. A repóban ma nincs ilyen alak; ha lesz, ez a sor a helye.
      if (segment === PLACEHOLDER) return ":param";
      const withoutPlaceholders = segment.split(PLACEHOLDER).join("");
      return withoutPlaceholders.startsWith(":")
        ? ":param"
        : withoutPlaceholders;
    })
    .filter((segment) => segment.length > 0)
    .join("/");
}

/**
 * Egyetlen `return` template literálból álló útvonal-helper, a paraméterei nevével és
 * alapértékeivel. A WEBES kliens ezt az alakot használja:
 *
 *     function worksheetPath(id: string, suffix = "") {
 *       return `${base}/${encodeURIComponent(id)}${suffix}`;
 *     }
 *
 * SZÁNDÉKOSAN SZŰK: csak az egy-`return` alakot ismeri fel. Egy összetettebb helper nem
 * "ismeretlen, hagyjuk" lesz, hanem BUKÁS a hívás helyén -- ugyanaz a hangos irány, mint a
 * fel nem oldható konstansnál.
 */
interface PathHelper {
  params: { name: string; fallback: string | null }[];
  template: string;
}

function helpersOf(source: string): Map<string, PathHelper> {
  const helpers = new Map<string, PathHelper>();
  for (const match of source.matchAll(
    /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{\s*return\s+`([^`]*)`;\s*\}/g,
  )) {
    const params = match[2]!
      .split(",")
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((raw) => {
        const [left, right] = raw.split("=").map((part) => part.trim());
        const name = left!.split(":")[0]!.trim();
        const literal = right ? /^(["'`])(.*)\1$/.exec(right) : null;
        return { name, fallback: literal ? literal[2]! : null };
      });
    helpers.set(match[1]!, { params, template: match[3]! });
  }
  return helpers;
}

/** A hívás argumentumai, vesszőnként, a LEGFELSŐ szinten -- a zárójelekbe nem lépünk be. */
function splitArguments(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of raw) {
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    if ("([{".includes(character)) depth += 1;
    if (")]}".includes(character)) depth -= 1;
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
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

/**
 * A forrás úgy, hogy a KOMMENTEK és a SZTRING-TARTALMAK ki vannak fehérítve,
 * de a hossz és minden pozíció VÁLTOZATLAN.
 *
 * MIÉRT KELL, és miért mérésből: az őrző nyers forráson keres, tehát egy
 * dokumentációs komment, ami leírja a hívás alakját, pontosan úgy néz ki neki,
 * mint egy hívás. Mérve 2026-08-28 a webes forráson: a
 * `lib/auth/production-auth.ts` NULLA valódi hívást tartalmaz, mégis megbuktatta
 * az őrzőt, mert egy doc-komment leírja, hogy `apiRequest()`. Az őrző ilyenkor a
 * saját szabálya szerint hangosan elhal -- ami helyes szabály, csak egy mondatra
 * alkalmazza.
 *
 * A MOBIL OLDAL MA CSAK A FOGALMAZÁSON MÚLIK: ott egyetlen komment sem írja le
 * az `apiRequest(` alakot (mérve ugyanaznap), tehát zöld. Egy holnap beírt
 * mondat pirosra vinné, jogos kód mellett -- és egy őrző, ami jogos kódra
 * pirosodik, az, amit valaki előbb-utóbb kikapcsol.
 *
 * MIÉRT MASZK, ÉS NEM TÖRLÉS: a keresés a maszkon fut, a KIOLVASÁS viszont az
 * EREDETI forráson, ugyanazon a pozíción. Ezért kell a hosszt megőrizni. Törléssel
 * minden ezt követő eltolás elcsúszna.
 *
 * MIÉRT A SZTRINGEK IS: egy hibaüzenet, ami leírja az `apiRequest(` alakot,
 * ugyanolyan hamis találat, mint a komment. A sztringeket viszont CSAK a
 * kereséshez fehérítjük ki -- az útvonal maga is sztring, és azt az eredetiből
 * olvassuk.
 *
 * A template `${...}` KIFEJEZÉSE KÓD MARAD, nem maszkolódik: ott állhat valódi
 * hívás, és egy elrejtett hívás a NEM-nézés irányába tévedne, ami a csendes
 * irány.
 */
export function maskCommentsAndStrings(source: string): string {
  const out = source.split("");
  const blank = (index: number): void => {
    if (out[index] !== "\n") out[index] = " ";
  };
  /** A template literálok, amikbe `${` kifejezésen át visszatérünk. */
  const templates: number[] = [];
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
      templates.push(index);
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          blank(index++);
          if (index < source.length) blank(index++);
          continue;
        }
        if (source[index] === "`") {
          index += 1;
          templates.pop();
          break;
        }
        // A `${` KÓD, tehát nem fehérítjük ki: átugorjuk a záró `}`-ig, és
        // közben a benne álló hívások láthatók maradnak.
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

/**
 * Egy forrásfájl `apiRequest` hívásai. Kifejtve, hogy fájl nélkül is mérhető
 * legyen: a komment- és sztring-szűrés MŰKÖDÉSÉT csak így lehet bizonyítani,
 * nem csak a meglétét állítani.
 */
export function callsInSource(source: string, where: string): ClientCall[] {
  const calls: ClientCall[] = [];
  const constants = constantsOf(source);
  const helpers = helpersOf(source);
  // A KERESÉS a maszkon fut, a KIOLVASÁS az eredetin, azonos pozíción.
  const masked = maskCommentsAndStrings(source);
  {
    // A hívás lehet többsoros: a generikus paraméter és a nyitó zárójel után
    // az útvonal a következő nem üres jel.
    for (const match of masked.matchAll(/apiRequest\s*(?:<[^>]*>)?\s*\(\s*/g)) {
      const rest = source.slice(match.index + match[0].length);
      const literal = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1/.exec(rest);
      // A csupasz azonosító alak: `apiRequest(BASE, { method: "POST" })`.
      const bare = /^([A-Za-z_$][\w$]*)\s*[,)]/.exec(rest);
      // A helper-hívás alak: `apiRequest(worksheetPath(id, "/close"), token)`.
      const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(rest);
      const helper = call && helpers.get(call[1]!);
      let raw: string | null = null;
      if (literal) raw = literal[2]!;
      else if (bare && constants.has(bare[1]!)) raw = constants.get(bare[1]!)!;
      else if (helper) {
        const inner = rest.slice(call![0].length);
        raw = expandHelper(helper, inner.slice(0, matchingParenthesis(inner)));
      }
      // A helper a template literálon BELÜL is állhat: `${worksheetPath(id)}/continue`.
      if (raw !== null)
        raw = raw.replace(
          /\$\{([A-Za-z_$][\w$]*)\(([^)]*)\)\}/g,
          (whole, name: string, args: string) => {
            const nested = helpers.get(name);
            return nested ? expandHelper(nested, args) : whole;
          },
        );
      assert.ok(
        raw !== null,
        `${where}: egy apiRequest hívásból nem olvasható ki az útvonal. Az őrző nem hagyhatja ki némán -- az alak új, vagy a hívás olyan konstansból vagy helperből épít, amit ez a fájl nem deklarál (importált, vagy a helper nem egyetlen return template literál).`,
      );
      // A fájlon belüli konstansok behelyettesítése; ami marad, azt a toPattern
      // teszi `:param` alakúvá.
      const resolved = raw.replace(
        /\$\{([A-Za-z_$][\w$]*)\}/g,
        (whole, name: string) => constants.get(name) ?? whole,
      );
      calls.push({ file: where, raw, pattern: toPattern(resolved) });
    }
  }
  return calls;
}

function clientCalls(directory: string, label: string): ClientCall[] {
  const calls: ClientCall[] = [];
  for (const file of readdirSync(directory).sort()) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    if (file.endsWith(".test.ts") || NOT_A_CLIENT.has(file)) continue;
    const source = readFileSync(join(directory, file), "utf8");
    calls.push(...callsInSource(source, `${label}/${file}`));
  }
  return calls;
}

/** A KÉT kliens együtt: a telefoné és a webes felületé. */
function allCalls(): ClientCall[] {
  return [
    ...clientCalls(MOBILE_API_DIR, "mobil"),
    ...clientCalls(WEB_API_DIR, "web"),
  ];
}

/** A helper template literálja, a hívás argumentumaival behelyettesítve. */
function expandHelper(helper: PathHelper, rawArguments: string): string {
  const args = splitArguments(rawArguments);
  return helper.template.replace(
    /\$\{([A-Za-z_$][\w$]*)\}/g,
    (whole, name: string) => {
      const index = helper.params.findIndex(
        (parameter) => parameter.name === name,
      );
      if (index === -1) return whole;
      const given = args[index];
      if (given === undefined) return helper.params[index]!.fallback ?? whole;
      const asLiteral = /^(["'`])(.*)\1$/.exec(given);
      return asLiteral ? asLiteral[2]! : ":param";
    },
  );
}

/** A nyitó zárójel UTÁNI szövegben a hozzá tartozó záró zárójel indexe. */
function matchingParenthesis(afterOpening: string): number {
  let depth = 0;
  for (let index = 0; index < afterOpening.length; index += 1) {
    const character = afterOpening[index]!;
    if (character === "(") depth += 1;
    else if (character === ")") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return afterOpening.length;
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
    const calls = allCalls();
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
    // ÉS MIND A KÉT KLIENSBŐL jöjjön hívás. Enélkül az egyik mappa elnevezése
    // elromolhatna, a teszt pedig a másik találataival zölden maradna -- épp az
    // a néma szűkülés, ami ellen ez az őrző készült.
    for (const label of ["mobil/", "web/"])
      assert.ok(
        calls.some((call) => call.file.startsWith(label)),
        `a(z) ${label} kliensből egyetlen hívás sem olvasódott ki`,
      );
  });

  it("every mobile path has a server route", () => {
    const patterns = serverPatterns();
    const missing = allCalls().filter((call) => !patterns.has(call.pattern));
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

/**
 * AZ OLVASÓ MŰKÖDÉSE, NEM A MEGLÉTE.
 *
 * Egy komment-szűrés, amit csak a valódi forráson futtatunk, arról szól, hogy a
 * MAI kód nem tartalmaz olyan mondatot, ami megzavarná -- nem arról, hogy a
 * szűrés működik. A kettő különbsége akkor derülne ki, amikor valaki beír egy
 * ilyen mondatot, és a kapu jogos kódra pirosodik ki.
 *
 * Ezért itt a szűrés a SAJÁT bemenetén van megmérve, és minden esethez oda van
 * írva, MI PIROSÍTANÁ.
 */
describe("a komment és a sztring nem hívás", () => {
  it("a doc-komment említése nem számít hívásnak", () => {
    // PIROSÍT: ha az olvasó nyers forráson keresne. Pontosan ez buktatta meg a
    // webes mérést 2026-08-28-án: a production-auth.ts NULLA valódi hívást
    // tartalmaz, mégis elhalt rajta az őrző.
    const source = [
      "/**",
      " * this path (apiRequest() already treats a missing token as absent)",
      " */",
      "export const nothing = 1;",
    ].join("\n");
    assert.deepEqual(callsInSource(source, "fixture.ts"), []);
  });

  it("a sor végi komment említése sem", () => {
    // PIROSÍT: ha a szűrés csak a `/* */` alakot ismerné.
    const source =
      'export const x = 1; // apiRequest("/service/assets") itt csak szó\n';
    assert.deepEqual(callsInSource(source, "fixture.ts"), []);
  });

  it("a sztringben álló említés sem", () => {
    // PIROSÍT: ha csak a kommentek lennének kiszűrve. Egy hibaüzenet, ami leírja
    // a hívás alakját, ugyanolyan hamis találat, mint egy komment.
    const source =
      'throw new Error("hívd inkább az apiRequest(\\"/health\\") alakot");\n';
    assert.deepEqual(callsInSource(source, "fixture.ts"), []);
  });

  it("a komment mellett álló VALÓDI hívást viszont megtalálja", () => {
    // EZ A FONTOSABB IRÁNY. Az előző három azt bizonyítja, hogy nem lát
    // többet; ez azt, hogy nem lát KEVESEBBET. Egy szűrés, ami a valódi hívást
    // is elnyelné, csendben vakká tenné az őrzőt -- és zöld maradna.
    const source = [
      "// apiRequest(BASE) -- csak egy említés",
      'const BASE = "/service/assets";',
      "export async function list() {",
      "  return apiRequest(BASE);",
      "}",
    ].join("\n");
    const calls = callsInSource(source, "fixture.ts");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.pattern, "service/assets");
  });

  it("a template `${...}` kifejezésében álló hívás KÓD marad", () => {
    // PIROSÍT: ha a template literál teljes törzsét kifehéríteném. Az a
    // NEM-NÉZÉS irányába tévedne, ami a csendes irány: egy valódi hívás tűnne
    // el, és az őrző zöld maradna.
    const source = [
      'const BASE = "/service/assets";',
      "export const weird = `${apiRequest(BASE)}`;",
    ].join("\n");
    const calls = callsInSource(source, "fixture.ts");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.pattern, "service/assets");
  });

  it("a maszk megőrzi a hosszt és a sorokat", () => {
    // PIROSÍT: ha a szűrés törölne a kifehérítés helyett. A kiolvasás az
    // EREDETI forráson megy, ugyanazon a pozíción -- egy rövidebb maszk minden
    // ezt követő eltolást elcsúsztatna, és a hiba néma lenne: rossz szeletet
    // olvasnánk ki, nem hibaüzenetet kapnánk.
    const source = '// apiRequest("/a")\nconst x = "/b";\n';
    const masked = maskCommentsAndStrings(source);
    assert.equal(masked.length, source.length);
    assert.equal(
      masked.split("\n").length,
      source.split("\n").length,
      "a sortörések nem tűnhetnek el",
    );
  });

  it("az olvashatatlan útvonal továbbra is HANGOSAN bukik", () => {
    // PIROSÍT: ha a maszkolás mellékhatásaként az őrző elkezdene némán
    // kihagyni. A "nem hallgatunk el egy hívást, amit nem tudtunk elemezni"
    // szabály a szűrés bevezetésével nem veszhet el.
    const source = "export const a = apiRequest(importedPath);\n";
    assert.throws(() => callsInSource(source, "fixture.ts"));
  });
});
