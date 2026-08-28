import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { maskCommentsAndStrings } from "../testing/source-mask.js";

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
 * - A KLIENS SAJÁT WRAPPERÉT (`lib/api/client.ts`, `lib/api/request-auth.ts`)
 *   kihagyja: az nem hív, hanem becsomagol, és az útvonala függvény-paraméter.
 * - A MÁS HOSZTRA menő hívást kihagyja. Egy `fetch` mehet külső címre, és egy
 *   "létezzen a szerverünkön" állítás egy `https://…` címre tévesen pirulna. A
 *   kizárás a sémából statikusan eldönthető, nem ítélet kérdése. (Mérve
 *   2026-08-28: ma egyetlen ilyen hívás sincs.)
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

const API_SRC = "src";

/**
 * Egy kliens-halmaz: honnan olvassunk, és meddig.
 *
 * A `recursive` mező azért van kiírva halmazonként, és nem globálisan, mert a
 * két oldal MÁS állapotban van, és a különbségnek látszania kell.
 */
interface ClientSet {
  root: string;
  label: string;
  recursive: boolean;
  /** A gyökérhez képesti utak, amik a hívást BECSOMAGOLJÁK, nem hívják. */
  wrappers: ReadonlySet<string>;
  /**
   * Amit a kliens MINDEN útvonal elé tesz, és ami NEM a szerver útvonalának
   * része. A weben ez az `/api`: a `client.ts` így épít
   * (`fetch(\`/api${path}\`)`), miközben a hívók `/service/assets` alakot adnak
   * át. E nélkül MINDEN webes hívás nem-illeszkedőként jönne vissza, és az úgy
   * nézne ki, mintha az egész web rossz lenne.
   */
  apiPrefix?: string;
}

/**
 * A TELEFON: a teljes forrás, nem egyetlen mappa.
 *
 * MÉRVE 2026-08-28: az előző alak csak a `lib/api` mappát olvasta, egy szintet.
 * A `lib/auth/api.ts` közvetlenül mellette áll, ugyanazt az `apiRequest`-et
 * hívja, és négy helyen írta ki az `/auth` előtagot -- vagyis pont abban az
 * alakban, ami a 2026-08-27-i éles hibát okozta. KÉT SZÁNDÉKOS RONTÁS döntötte
 * el, hogy tényleg kívül esett: a `worksheets.ts` előtagját elrontva az őrző
 * PIROS lett, a `lib/auth/api.ts` útvonalát elrontva ZÖLD MARADT.
 *
 * A mappa-alapú hatókör tehát nem szűkítés volt, hanem vakfolt: nem a kód
 * alakjából következett, hanem abból, hova tettük a fájlt.
 */
const MOBILE: ClientSet = {
  root: "../mobile/src",
  label: "mobil",
  recursive: true,
  wrappers: new Set(["lib/api/client.ts", "lib/api/request-auth.ts"]),
};

/**
 * A WEB: a teljes forrás, `/api` előtaggal.
 *
 * A KETTŐ EGY LÉPÉS VOLT, nem kettő. A mappa kiszélesítése önmagában nem lett
 * volna elég: a hat auth-hívás a `lib/api` mappán KÍVÜL áll, viszont a három
 * bináris letöltés (foxpost riport, leltár-sablon, eszköz-dokumentum) MÁR
 * BENT VOLT a nézett mappában, és mégsem látszott -- mert nem az `apiRequest`
 * wrapperen át hívnak. A vakfolt tehát nem a MAPPA volt, hanem a CSATORNA.
 *
 * Az `apiPrefix` pedig mindkettőnek előfeltétele: a web `client.ts`-e `/api`
 * előtagot tesz minden útvonal elé, és azt az összevetésnek le kell vágnia. E
 * nélkül MINDEN webes hívás nem-illeszkedőként jönne vissza, és úgy nézne ki,
 * mintha az egész webes kliens rossz lenne.
 */
const WEB: ClientSet = {
  root: "../web/src",
  label: "web",
  recursive: true,
  wrappers: new Set(["lib/api/client.ts", "lib/api/request-auth.ts"]),
  apiPrefix: "/api",
};

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
    /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(["'])((?:\\.|(?!\2)[^\\])*)\2\s*;/gm,
  ))
    constants.set(match[1]!, match[3]!);
  return constants;
}

/**
 * Egy forrásfájl `apiRequest` hívásai. Kifejtve, hogy fájl nélkül is mérhető
 * legyen: a komment- és sztring-szűrés MŰKÖDÉSÉT csak így lehet bizonyítani,
 * nem csak a meglétét állítani.
 */
/**
 * A KÉT CSATORNA, amin a kliens a szerverhez beszél.
 *
 * MÉRVE 2026-08-28: az őrző eddig CSAK az `apiRequest`-en át menő forgalmat
 * mérte, és emiatt HÁROM valódi szerver-útvonal átment minden összevetésen --
 * a foxpost letöltés, az inventory sablon és az eszköz-dokumentum. Mindhárom a
 * MÁR NÉZETT mappában áll: a vak folt tehát nem a MAPPA volt, hanem a CSATORNA.
 * Mind a három bináris letöltés, és SZÁNDÉKOSAN kerüli a JSON-t váró wrappert.
 *
 * A `fetch` mintája nem fogja meg a `refetch(`-et és a `.fetch(` alakot: a
 * megelőző jel nem lehet pont vagy szó-karakter.
 */
const CHANNELS: readonly RegExp[] = [
  /apiRequest\s*(?:<[^>]*>)?\s*\(\s*/g,
  /(?<![.\w])fetch\s*\(\s*/g,
];

/** Külső címre menő hívás: nem a mi szerverünk, tehát nem is a mi dolgunk. */
function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

export function callsInSource(
  source: string,
  where: string,
  apiPrefix = "",
  imported: ReadonlyMap<string, string> = new Map(),
): ClientCall[] {
  const calls: ClientCall[] = [];
  // A MÁSIK FÁJLBÓL HOZOTT konstansok ADATKÉNT érkeznek, nem fájlként. Ez a
  // függvény szándékosan nem nyúl a lemezhez: csak így mérhető a saját
  // bemenetén. Az import feloldása a hívó dolga, ahol a fájl útja amúgy is
  // megvan.
  const constants = new Map([...imported, ...constantsOf(source)]);
  const helpers = helpersOf(source);
  // A KERESÉS a maszkon fut, a KIOLVASÁS az eredetin, azonos pozíción.
  const masked = maskCommentsAndStrings(source);
  for (const channel of CHANNELS) {
    // A hívás lehet többsoros: a generikus paraméter és a nyitó zárójel után
    // az útvonal a következő nem üres jel.
    for (const match of masked.matchAll(channel)) {
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
        `${where}: egy hívásból nem olvasható ki az útvonal. Az őrző nem hagyhatja ki némán -- az alak új, vagy a hívás olyan konstansból vagy helperből épít, amit ez a fájl nem deklarál (importált, vagy a helper nem egyetlen return template literál).`,
      );
      /**
       * KÜLSŐ CÍM: átugorjuk, és ez NEM kivétel, hanem a hatókör kimondása. A
       * `fetch` más hosztra is mehet, és egy „létezzen a szerverünkön" állítás
       * egy `https://…` címre tévesen pirulna. Mérve 2026-08-28: ma egyetlen
       * ilyen sincs -- de a szabálynak előre kell tudnia róla, és ez a döntés
       * STATIKUSAN eldönthető, nem ítélet kérdése.
       */
      if (isAbsoluteUrl(raw)) continue;
      // A fájlon belüli konstansok behelyettesítése; ami marad, azt a toPattern
      // teszi `:param` alakúvá.
      let resolved = raw.replace(
        /\$\{([A-Za-z_$][\w$]*)\}/g,
        (whole, name: string) => constants.get(name) ?? whole,
      );
      /**
       * A VEZETŐ BEHELYETTESÍTÉS FELOLDATLANSÁGA KÜLÖN HIBA, és nem az, hogy a
       * cím nem létezik.
       *
       * MÉRVE 2026-08-28: amikor a webes hívások `/api` literálja konstansra
       * cserélődött, a nyers alak `${API_PREFIX}/auth/me` lett. A behelyettesítés
       * feloldatlanul maradt, a `toPattern` `:param` alakúvá tette, és hat
       * LÉTEZŐ útvonal jött vissza „a szerveren nem létezik" üzenettel. A jelzés
       * nem hamis volt, hanem ROSSZ IRÁNYBA mutatott: aki látta, útvonalat
       * keresett volna, nem konfigurációt.
       *
       * A megkülönböztető jel a POZÍCIÓ: minden valódi útvonal `/` jellel
       * kezdődik, tehát ami az elejéről marad feloldatlanul, az előtag, nem
       * paraméter. A `${encodeURIComponent(id)}` alak a szegmens BELSEJÉBEN áll,
       * és érintetlen marad.
       */
      assert.ok(
        resolved.startsWith("/"),
        `${where}: egy hívás vezető konstansa nem oldható fel (${raw}). Ez NEM azt jelenti, hogy a cím nem létezik: az őrző nem tudta kiolvasni az előtagot. Ha másik fájlból importált konstansról van szó, a hívó adja át a feloldásához.`,
      );
      // A kliens saját előtagja NEM a szerver útvonalának része.
      if (apiPrefix && resolved.startsWith(apiPrefix))
        resolved = resolved.slice(apiPrefix.length);
      calls.push({ file: where, raw, pattern: toPattern(resolved) });
    }
  }
  return calls;
}

/**
 * A halmaz forrásfájljai, a gyökérhez képesti úttal.
 *
 * A kizárás ÚTVONALRA megy, nem fájlnévre: rekurzív bejárásban egy puszta
 * `client.ts` név egy jövőbeli, MÁSIK mappában lévő klienst is némán kihagyna,
 * és épp azt, amit az új hatókör miatt nézni kellene.
 */
function sourceFiles(set: ClientSet): string[] {
  const files: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!set.recursive || entry.name === "node_modules") continue;
        walk(join(dir, entry.name), relative);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.(spec|test)\.tsx?$/.test(entry.name)) continue;
      if (set.wrappers.has(relative)) continue;
      files.push(relative);
    }
  };
  walk(set.root, "");
  return files;
}

/**
 * A fájl SAJÁT importjaiból hozott string-konstansok.
 *
 * MIÉRT KELL: a `/api` előtag 2026-08-28 óta egy megosztott konstansban áll a
 * webes kliensben, tehát a hívások `${API_PREFIX}/auth/me` alakban írják. A
 * fájlon belüli feloldás ezt nem éri el, és a feloldatlan előtagból `:param`
 * lenne -- vagyis LÉTEZŐ útvonalak jönnének vissza nem létezőként.
 *
 * SZÁNDÉKOSAN SZŰK: csak a fájl saját, RELATÍV importjait követi, egy szintet,
 * és csak string értékű `const`-okat vesz át. Egy nem létező vagy nem
 * olvasható modul nem hiba itt -- ha a konstans tényleg kell, a hívás helyén
 * fog hangosan elbukni, ott, ahol az üzenet is értelmes.
 */
function importedConstants(set: ClientSet, file: string): Map<string, string> {
  const source = readFileSync(join(set.root, file), "utf8");
  const directory = dirname(file);
  const constants = new Map<string, string>();
  for (const match of source.matchAll(
    /^import\s*\{([^}]*)\}\s*from\s*"(\.[^"]*)"/gm,
  )) {
    const names = match[1]!
      .split(",")
      .map((name) => name.replace(/^\s*type\s+/, "").trim())
      .filter(Boolean);
    if (names.length === 0) continue;
    const target = join(set.root, directory, `${match[2]!}.ts`);
    let moduleSource: string;
    try {
      moduleSource = readFileSync(target, "utf8");
    } catch {
      continue;
    }
    const exported = constantsOf(moduleSource);
    for (const name of names) {
      const value = exported.get(name);
      if (value !== undefined) constants.set(name, value);
    }
  }
  return constants;
}

function clientCalls(set: ClientSet): ClientCall[] {
  const calls: ClientCall[] = [];
  for (const file of sourceFiles(set)) {
    const source = readFileSync(join(set.root, file), "utf8");
    if (!source.includes("apiRequest") && !source.includes("fetch")) continue;
    calls.push(
      ...callsInSource(
        source,
        `${set.label}/${file}`,
        set.apiPrefix ?? "",
        importedConstants(set, file),
      ),
    );
  }
  return calls;
}

/** A KÉT kliens együtt: a telefoné és a webes felületé. */
function allCalls(): ClientCall[] {
  return [...clientCalls(MOBILE), ...clientCalls(WEB)];
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

/**
 * A HIVATKOZOTT, DE NEM LÉTEZŐ ÚTVONALAK -- az őrző tényleges állítása.
 *
 * KÜLÖN FÜGGVÉNY, ÉS EZ NEM STÍLUS. Amíg a szűrés az `it` törzsében állt, az
 * állítás CSAK a mai kódon volt mérve: azt bizonyította, hogy ma nincs hibás
 * cím, nem azt, hogy egy hibás címet MEGTALÁLNA. A kettő különbsége akkor derül
 * ki, amikor tényleg elromlik valami -- vagyis a legrosszabbkor.
 *
 * A NYERS ALAK ÉS A FELOLDOTT MINTA IS KELL a jelentésbe. A nyers megmondja,
 * MELYIK SORT kell megnyitni; a feloldott azt, MI LETT belőle -- és egy
 * konstansból épülő hívásnál a kettő nem ugyanaz. Csak a nyerssel a hibaüzenet
 * `${BASE}/owners` lenne, amiből nem derül ki, mi a rossz előtag.
 */
export function missingRoutes(
  calls: readonly ClientCall[],
  patterns: ReadonlySet<string>,
): string[] {
  return calls
    .filter((call) => !patterns.has(call.pattern))
    .map((call) => `${call.file}: ${call.raw}  ->  ${call.pattern}`);
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
    // ÉS MIND A KÉT CSATORNÁBÓL. Ez a három útvonal KIZÁRÓLAG közvetlen
    // `fetch`-en át hívódik (bináris letöltések, amik szándékosan kerülik a
    // JSON-t váró wrappert), tehát ha a `fetch` csatorna elnémul, itt tűnnek el
    // először.
    //
    // AMIÉRT KELL: a lefedettség-állítás zöldje MONOTON abban, hány hívást
    // ismerünk fel -- kevesebb felismert hívás kevesebb assert. Mérve
    // 2026-08-28: a `fetch` mintát a CHANNELS listából kivéve az egész suite
    // zölden maradt. Egy őrző, ami abbahagyja a nézést, nem hangosabb lesz,
    // hanem csendesebb, és ezt csak egy NEVESÍTETT elvárás fogja meg.
    for (const pattern of [
      "integrations/foxpost/reports/:param/:param/download",
      "inventory/counts/:param/template.xlsx",
      "service/assets/:param/documents/:param",
    ])
      assert.ok(
        calls.some((call) => call.pattern === pattern),
        `a(z) ${pattern} útvonal nem olvasódott ki: a közvetlen fetch csatorna nem mér`,
      );
  });

  it("every mobile path has a server route", () => {
    assert.deepEqual(
      missingRoutes(allCalls(), serverPatterns()),
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

describe("a fetch csatorna is mérve van", () => {
  it("a nyers fetch hívást megtalálja, és a kliens előtagját levágja", () => {
    // EZ AZ A TESZT, AMI NÉLKÜL A CSATORNA BEVEZETÉSE BIZONYÍTATLAN LENNE.
    // Mérve 2026-08-28: a fetch mintát a lefordított tesztből teljesen kivéve
    // a suite 9/9 zölden maradt. Az ok szerkezeti: a lefedettség-állítás
    // KEVESEBB hívásra fut, és a kevesebb assert nem tud pirosítani. Egy őrző
    // zöldje tehát a KÓD állapotát mutatja, nem azt, hogy az őrző odanéz-e.
    const source = [
      "export async function download() {",
      '  return fetch("/api/service/assets");',
      "}",
    ].join("\n");
    const calls = callsInSource(source, "fixture.ts", "/api");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.pattern, "service/assets");
  });

  it("az előtag levágása a paramétertől függ, nem beégetett", () => {
    // PIROSÍT: ha valaki az `/api` előtagot a függvénybe égetné. Akkor ez a
    // hívás is `service/assets` alakot adna, holott előtag nélkül hívtuk --
    // és a mobil oldalon, ahol nincs előtag, egy `/api` kezdetű valódi út
    // csendben elveszítené az első szegmensét.
    const source = 'export const a = fetch("/api/service/assets");\n';
    const calls = callsInSource(source, "fixture.ts");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.pattern, "api/service/assets");
  });

  it("a refetch és a .fetch NEM hívás", () => {
    // PIROSÍT: ha a negatív lookbehind kiesne a mintából. Nem csendben
    // pirosítana: mindkét alak útvonal nélkül áll, tehát a "nem olvasható ki
    // az útvonal" ág HANGOSAN dobna. Ez a jó irány, de a tesztnek ki kell
    // mondania, hogy ezek szándékosan nem hívások.
    const source = [
      "export function a() { refetch(); }",
      "export function b() { client.fetch(); }",
    ].join("\n");
    assert.deepEqual(callsInSource(source, "fixture.ts"), []);
  });

  it("a külső címre menő hívás nem a mi útvonalunk", () => {
    // A hatókör kimondása, nem kivétel: a `fetch` más hosztra is mehet, és egy
    // "létezzen a szerverünkön" állítás egy abszolút címre tévesen pirulna.
    const source = 'export const a = fetch("https://example.test/v1/ping");\n';
    assert.deepEqual(callsInSource(source, "fixture.ts"), []);
  });
});

/**
 * AZ ÁLLÍTÁS MŰKÖDÉSE, NEM A MEGLÉTE.
 *
 * A fenti `every mobile path has a server route` zöldje azt mondja, hogy MA
 * nincs hibás cím. Azt NEM mondja, hogy egy hibás címet megtalálna: ha az
 * összevetés elromlana (üres mintahalmaz, mindenre igazat adó `has`, elnyelt
 * találat), pontosan ugyanúgy zöld maradna. Ezért itt a `missingRoutes` a SAJÁT
 * bemenetén van megmérve, mesterséges adaton.
 */
describe("a nem létező útvonalra mutató hívás pirosít", () => {
  const patterns = new Set(["service/assets", "worksheets/:param"]);

  it("a hiányzó útvonalat JELENTI", () => {
    // PIROSÍT: ha az összevetés bármikor üres listát adna vissza. Ez az egyetlen
    // teszt, ami az őrző TULAJDONKÉPPENI állítását méri: hogy a hiányt észreveszi.
    const missing = missingRoutes(
      [
        {
          file: "web/lib/api/x.ts",
          raw: "/api/nincs-ilyen",
          pattern: "nincs-ilyen",
        },
      ],
      patterns,
    );
    assert.equal(missing.length, 1);
  });

  it("a jelentésben a NYERS alak és a feloldott minta is benne van", () => {
    // PIROSÍT: ha valaki a hibaüzenetet a mintára egyszerűsítené. A nyers alak
    // mondja meg, MELYIK SORT kell megnyitni; egy konstansból épülő hívásnál a
    // kettő nem ugyanaz, és a minta önmagában nem vezet vissza a forráshoz.
    const missing = missingRoutes(
      [{ file: "web/lib/api/x.ts", raw: "${BASE}/owners", pattern: "owners" }],
      patterns,
    );
    assert.match(missing[0]!, /web\/lib\/api\/x\.ts/);
    assert.match(missing[0]!, /\$\{BASE\}\/owners/);
    assert.match(missing[0]!, /owners$/);
  });

  it("a létező útvonalat NEM jelenti", () => {
    // PIROSÍT: ha az összevetés mindent hiányzónak látna (például mert a minták
    // más alakban állnak elő, mint a hívások). Az ilyen őrző jogos kódra pirul,
    // és fél éven belül valaki kikapcsolja.
    const missing = missingRoutes(
      [
        {
          file: "web/lib/api/x.ts",
          raw: "/api/service/assets",
          pattern: "service/assets",
        },
        {
          file: "mobil/y.ts",
          raw: "/worksheets/${id}",
          pattern: "worksheets/:param",
        },
      ],
      patterns,
    );
    assert.deepEqual(missing, []);
  });
});

/**
 * A MÁSIK FÁJLBÓL HOZOTT ELŐTAG.
 *
 * MÉRVE 2026-08-28, két ág egyesítésén: a webes kliens `/api` literálja
 * megosztott konstansba került, és a két változás KÜLÖN FÁJLOKBAN állt -- nulla
 * közös fájl, mégis két bukó teszt. Ez az a fajta kölcsönhatás, amit a szokásos
 * ellenőrzés (van-e közös fájl) zöldnek mutat.
 */
describe("az importált előtag-konstans", () => {
  const source = [
    'import { API_PREFIX } from "./api-prefix";',
    "",
    "export const me = () => fetch(`${API_PREFIX}/auth/me`);",
  ].join("\n");

  it("feloldva a szerver útvonalára vezet", () => {
    // PIROSÍT: ha a hívó nem adná át a másik fájl konstansait. Akkor az előtag
    // feloldatlan marad, és a hívás úgy jönne vissza, mintha nem létezne.
    const calls = callsInSource(
      source,
      "web/lib/auth/x.ts",
      "/api",
      new Map([["API_PREFIX", "/api"]]),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.pattern, "auth/me");
  });

  it("feloldatlanul HANGOSAN bukik, és NEM hiányzó útvonalat állít", () => {
    // EZ A LÉNYEG. Feloldás nélkül a `toPattern` `:param` alakot csinálna
    // belőle, és a lefedettségi állítás azt mondaná, hogy a cím nem létezik --
    // LÉTEZŐ útvonalra. A jelzés nem hamis lenne, hanem ROSSZ IRÁNYBA mutatna:
    // aki látja, útvonalat keresne, nem konfigurációt.
    assert.throws(
      () => callsInSource(source, "web/lib/auth/x.ts", "/api"),
      /vezető konstansa nem oldható fel/,
    );
  });

  it("a szegmensen BELÜLI behelyettesítés továbbra is paraméter", () => {
    // PIROSÍT: ha a szabály minden feloldatlan behelyettesítésre bukna. A
    // `${encodeURIComponent(id)}` alak valódi paraméter, és a megkülönböztető
    // jel a POZÍCIÓ: az útvonal `/` jellel kezdődik, tehát az eleje nem hiányzik.
    const calls = callsInSource(
      "export const one = () => fetch(`/service/assets/${encodeURIComponent(id)}`);",
      "web/x.ts",
      "",
    );
    assert.equal(calls[0]!.pattern, "service/assets/:param");
  });
});
