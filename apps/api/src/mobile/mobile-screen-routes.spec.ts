import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
 * AMIT EZ AZ ŐRZŐ SZÁNDÉKOSAN NEM ÁLLÍT: nem követeli meg, hogy MINDEN
 * képernyő-fájlhoz legyen `Stack.Screen` bejegyzés. A MECHANIZMUS változatlan
 * és mért: az útvonalakat a fájlrendszer adja, a bejegyzés csak a
 * fejléc-beállítást viszi, tehát a képernyő bejegyzés nélkül is elérhető.
 *
 * AZ INDOK VISZONT MEGVÁLTOZOTT, ÉS EZT KI KELL MONDANI. Eddig itt az állt,
 * hogy egy ilyen szabály MA IS kipirulna jogos kódon, és erre a `partners`
 * két képernyője volt a bizonyíték: bejegyzés nélkül működtek. 2026-08-28-án
 * megkapták a bejegyzésüket (a fejlécükben az útvonal állt egy magyar felület
 * fölött), tehát az az egyetlen ellenpélda ELFOGYOTT: ma mind a tizenöt
 * útvonal-fájlhoz tartozik bejegyzés.
 *
 * EBBŐL NEM KÖVETKEZIK MAGÁTÓL, hogy a szabályt be kell vezetni -- az döntés,
 * és annak az ára, hogy minden új képernyő kötelezően bejegyzést kér. Csak
 * annyi következik, hogy a régi indok („jogos kódra pirulna") már NEM igaz.
 * Aki a szabályt fontolgatja, ezt a bekezdést mérje újra, ne ezt a mondatot
 * idézze.
 *
 * EBBŐL KÖVETKEZIK EGY MEGLEPŐ, DE HELYES VISELKEDÉS: ha valaki kiveszi a
 * beállítások `Stack.Screen` sorát, ez az őrző ZÖLD MARAD. Nem mulasztás: a
 * képernyő attól még elérhető, csak az alapértelmezett fejlécet kapja. Az
 * elérhetőséget a MÁSODIK állítás őrzi, és az két dolgon áll -- a fájlon és a
 * rá mutató hivatkozáson --, nem a bejegyzésen.
 */

const APP_DIR = "../mobile/src/app";
const MOBILE_SRC = "../mobile/src";
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
    // A HARMADIK ALAK, ÉS EZ VISZI A DINAMIKUS CÉLOKAT. A fenti kettő csak
    // akkor ad célt, ha közvetlenül literál következik. A paraméteres
    // navigáció viszont OBJEKTUMMAL megy
    // (`router.push({ pathname: "/assets/[id]", params: { id } })`), ott a
    // nyitó kapcsos zárójel áll a literál helyén, és a cél csendben kimarad.
    // Mérve 2026-08-28: tizenhat cél állt ebben az alakban, tizenöt közülük
    // paraméteres -- vagyis PONT az a halmaz, amit egy fájl-átnevezés eltör.
    /\bpathname\s*:\s*/g,
  ];
  for (const pattern of patterns)
    for (const match of masked.matchAll(pattern)) {
      const target = literalAt(source, match.index + match[0].length);
      if (target) targets.push(target);
    }
  return targets;
}

/**
 * MINDEN útvonal-fájl az `app` mappa alatt, útvonallá alakítva.
 *
 * Az expo-router a fájlrendszerből képezi az útvonalakat, tehát a lemezen álló
 * fájl a FORRÁS, nem a `_layout.tsx`. Az `index.tsx` a mappa maga, a
 * `[valami].tsx` paraméteres szegmens, és a `_`-sal kezdődő fájl (`_layout`)
 * nem útvonal.
 */
export function routeFiles(dir: string, prefix = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith("_")) continue;
    if (entry.isDirectory()) {
      routes.push(
        ...routeFiles(join(dir, entry.name), `${prefix}/${entry.name}`),
      );
      continue;
    }
    if (!entry.name.endsWith(".tsx")) continue;
    const base = entry.name.slice(0, -".tsx".length);
    routes.push(base === "index" ? prefix || "/" : `${prefix}/${base}`);
  }
  return routes;
}

/**
 * Az összehasonlítható alak. MINDKÉT oldal ugyanezen megy át, mert a két oldal
 * ugyanazt a szegmenst KÉTFÉLEKÉPPEN írja le: a fájl `[id].tsx` néven, a hívó
 * vagy ugyanígy (`pathname: "/assets/[id]"`), vagy behelyettesítéssel
 * (`` `/worksheets/${id}` ``). Aki csak az egyik alakot normalizálja, az a
 * másikat nem létező útvonalnak látja.
 */
export function toRoutePattern(raw: string): string {
  const path = raw.split(/[?#]/)[0] ?? "";
  const segments = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      /^\[.*\]$/.test(segment) || segment.includes("${") ? ":param" : segment,
    );
  return `/${segments.join("/")}`;
}

/** Ami egyik útvonal-fájlra sem illeszkedik. A sorrend a bemenetét követi. */
export function unknownTargets(
  targets: readonly string[],
  routes: readonly string[],
): string[] {
  const known = new Set(routes.map(toRoutePattern));
  return targets
    .filter((target) => target.startsWith("/"))
    .filter((target) => !known.has(toRoutePattern(target)));
}

/** A mobil forrás minden `.ts`/`.tsx` fájlja, a gyökérhez képesti úttal. */
function mobileSources(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const here = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...mobileSources(join(dir, entry.name), here));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      files.push(here);
  }
  return files;
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

/**
 * MINDEN NAVIGÁCIÓS CÉL LÉTEZŐ ÚTVONALRA MUTASSON.
 *
 * A fenti két állítás EGY képernyőről szól (a beállításokról), és a
 * `_layout.tsx` bejegyzéseiről. Ez a harmadik a másik irányból nézi ugyanazt: a
 * forrásban KIÍRT célokat veti össze a lemezen álló útvonal-fájlokkal.
 *
 * AMIÉRT EZ MOST KELL, ÉS AMI A FELMÉRÉSEMBŐL KIMARADT: a célok
 * HARMADÁT eddig egyik olvasó sem látta. A paraméteres navigáció objektummal
 * megy (`router.push({ pathname: "/assets/[id]", params: { id } })`), és a
 * `pathname` alak nélkül a lista huszonkilenc célt adott negyvenöt helyett. A
 * hiányzó tizenhat közül tizenöt PARAMÉTERES -- vagyis pont az a halmaz,
 * amelyiket egy fájl-átnevezés eltöri, és amelyik ma futásidőben derülne ki, a
 * telefonon. Az `/assets/[id]` egymagában hat helyen áll.
 *
 * AMIT EZ AZ ŐRZŐ SZÁNDÉKOSAN NEM ÁLLÍT:
 *
 * - NEM követeli meg, hogy minden útvonal-fájlra mutasson valami. Egy képernyő
 *   elérhető mélylinkről vagy paraméterrel is; a fordított irányú szabály ma is
 *   kipirulna jogos kódon.
 * - CSAK a `/`-sal kezdődő célt nézi. Ami nem azzal kezdődik, az külső cím
 *   (`https:`, `mailto:`) vagy relatív hivatkozás, és arról ez az őrző nem tud
 *   állítani semmit -- a szűrés tehát KIMONDOTT hatókör, nem elnézés.
 * - NEM old fel változót. Egy `${...}` szegmens paraméterként számít, ahogy a
 *   fájl `[id]` szegmense is: a kettő ugyanaz a hely, két írásmóddal.
 *
 * HA CSOPORT-MAPPA (`(tabs)`) KERÜL A FÁBA, ez az őrző kipirul, mert a csoport
 * neve nem része az útvonalnak. Az nem hamis riasztás lesz, hanem ennek a
 * specnek a dolga: ugyanabban a változásban kell átalakítani.
 *
 * ---
 *
 * ÉS A LEGFONTOSABB, AMIT EBBŐL NEM SZABAD KIOLVASNI: attól, hogy ez az állítás
 * zöld, a mobil útvonalak NINCSENEK tipizáltan kapuzva. Ez az őrző a navigációs
 * CÉLT méri -- azt, hogy van-e hozzá képernyő-fájl --, a PARAMÉTEREKET és a
 * lekérdező rész alakját nem. Egy `params: { id }` helyett írt `params: { ID }`
 * ugyanúgy átmegy rajta, mint egy hiányzó kötelező paraméter.
 *
 * A tipizált útvonalak (`experiments.typedRoutes`) TÖBBET tudnának, és a
 * kapcsoló be is van kapcsolva -- de nem kapuznak, mert a generált típusok
 * nincsenek verziókezelésben. Az `apps/mobile/app.config.js` fájlban, a
 * kapcsoló mellett ott áll, hogy miért, és hogy melyik EGYETLEN tény nyitja fel
 * ezt az utat. Ez a spec a szűkebb részt fedi le, ma, mérhetően; nem a
 * tipizálás helyett áll, hanem addig is.
 */
describe("a telefon minden navigációs célja létező útvonalra mutat", () => {
  it("nincs olyan cél, amihez ne lenne útvonal-fájl", () => {
    const routes = routeFiles(APP_DIR);
    assert.ok(
      routes.length > 0,
      "egyetlen útvonal-fájlt sem olvastam ki az app mappából -- vagy a mappa alakja változott, és akkor EZT a specet kell átalakítani ugyanabban a változásban",
    );

    const found: string[] = [];
    for (const file of mobileSources(MOBILE_SRC)) {
      const source = readFileSync(join(MOBILE_SRC, file), "utf8");
      for (const target of unknownTargets(navigationTargets(source), routes))
        found.push(`${file} -> ${target}`);
    }

    assert.deepEqual(
      found.sort(),
      [],
      "a telefon olyan útvonalra navigál, amihez nincs képernyő-fájl. Ez futásidőben üres képernyő vagy hibaüzenet, és csak akkor derül ki, ha valaki pont oda lép",
    );
  });

  it("a paraméteres célt és a paraméteres fájlt ugyanannak látja", () => {
    // PIROSÍT: ha bármelyik oldal normalizálása kimarad. A három írásmód
    // ugyanarra a képernyőre mutat, és a fájl neve a harmadik alak.
    const routes = ["/assets/[id]"];
    assert.deepEqual(
      unknownTargets(
        ["/assets/[id]", "/assets/${id}", "/assets/${asset.id}?tab=log"],
        routes,
      ),
      [],
    );
  });

  it("a nem létező útvonalat jelenti, és a nyers alakot mondja", () => {
    // AZ ÁLLÍTÁST MAGÁT MÉRI. A fenti éles zöld csak annyit mond, hogy MA
    // minden cél illeszkedik; azt nem, hogy egy nem illeszkedőt megtalálna.
    assert.deepEqual(unknownTargets(["/nincs-ilyen"], ["/assets/[id]"]), [
      "/nincs-ilyen",
    ]);
  });

  it("a külső cím nem navigációs cél", () => {
    // PIROSÍT: ha a hatókör-szűrés kimarad. Egy `https:` cím nem útvonal, és
    // nem-illeszkedőként jelentve az őrző jogos kódra pirulna.
    assert.deepEqual(
      unknownTargets(
        ["https://acropora.hu", "mailto:a@b.hu"],
        ["/assets/[id]"],
      ),
      [],
    );
  });

  it("az objektum alakú hívás célja is előkerül", () => {
    // A LEGFONTOSABB IRÁNY. E nélkül a paraméteres navigáció teljes halmaza
    // láthatatlan, és az őrző zöldje a KÓD állapotáról szólna, nem arról,
    // hogy odanéz-e.
    const source = [
      "export const open = (id: string) =>",
      '  router.push({ pathname: "/assets/[id]", params: { id } });',
    ].join("\n");
    assert.deepEqual(navigationTargets(source), ["/assets/[id]"]);
  });

  it("az index.tsx a mappa útvonala, nem külön szegmens", () => {
    // PIROSÍT: ha a fájlnév nyersen kerülne az útvonalba. Akkor az
    // `/assets` cél nem illeszkedne az `assets/index.tsx` fájlra.
    assert.ok(routeFiles(APP_DIR).includes("/assets"));
    assert.ok(!routeFiles(APP_DIR).includes("/assets/index"));
  });
});
