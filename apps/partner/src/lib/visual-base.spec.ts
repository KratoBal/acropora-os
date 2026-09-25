import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

/**
 * A PORTAL NEM FUGGHET AZ apps/web-TOL -- ES EZ ORZO, NEM KOMMENT.
 *
 * acrobot 3. kikotese (2026-09-21): a `@acropora/ui` es a `@acropora/types`
 * igen, az `apps/web` SOHA. Azert kell ALLITAS, mert a kovetkezo lap
 * atallitasanal pont ez a kisertes: a belso lap `Service*` kerete keszen all,
 * es egy `../../../web/src/...` alaku import CSENDBEN mukodne is helyben.
 *
 * AMI ELROMLANA TOLE: az `apps/partner` sajat Docker-kepbe epul, ami az
 * `apps/web` forrasat NEM tartalmazza. A hiba tehat nem a fejlesztoi gepen
 * jelenne meg, hanem a telepitesnel -- vagy meg kesobb, futasidoben.
 */
/**
 * A CSOMAG GYOKERÉHEZ KÉPEST, ugyanúgy, mint a szomszéd `portal-wiring.spec.ts`
 * -ben: a `test` script a csomag könyvtárából fut. `__dirname` itt NINCS, mert
 * a csomag ESM (`"type": "module"`), és a lefordított spec is az.
 *
 * A rossz munkakönyvtárat az alatta álló ISMERT POZITÍV KONTROLL fogja meg: egy
 * másik helyről indítva a bejárás dobna vagy üres lenne, és a hiány-állítások
 * attól lennének zöldek.
 */
const GYOKER = "src";

/** Minden `.ts` es `.tsx` a portal forrasaban, a specek NELKUL. */
/**
 * A KOMMENTEK NELKULI KOD.
 *
 * Ugyanaz az alak, mint a mobil forras-olvaso specjeiben: a sajat magyarazo
 * szovegunk tartalmazza azt, amit a meres keres, tehat egy nyers illesztes a
 * DOKUMENTACIOT venne leletnek.
 */
function kodSzoveg(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

function forrasok(konyvtar: string, gyujto: string[] = []): string[] {
  for (const b of readdirSync(konyvtar, { withFileTypes: true })) {
    const ut = join(konyvtar, b.name);
    if (b.isDirectory()) forrasok(ut, gyujto);
    else if (
      (b.name.endsWith(".ts") || b.name.endsWith(".tsx")) &&
      !b.name.endsWith(".spec.ts")
    )
      gyujto.push(ut);
  }
  return gyujto;
}

describe("a portál vizuális alapja", () => {
  const fajlok = forrasok(GYOKER);

  /**
   * ISMERT POZITIV KONTROLL. Egy ures bejarason MINDEN hiany-allitas zold
   * lenne, es epp a hiany-allitasok adjak ennek a specnek az ertelmet.
   */
  it("a bejárás lát forrásfájlokat", () => {
    assert.ok(
      fajlok.length >= 10,
      `gyanúsan kevés forrásfájl: ${fajlok.length}`,
    );
  });

  /**
   * A FELOLDOTT UTAT MERJUK, NEM A LEIRT SZOVEGET.
   *
   * AZ ELSO VALTOZATOM A LITERALIS `apps/web` SZOVEGRE ILLESZTETT, es a
   * kalibracio megmutatta, hogy NEM SUL EL: a valodi kisertes nem az az alak,
   * hanem a RELATIV ut (`../../../web/src/components/...`), amiben ez a ket szo
   * egyutt elo sem fordul. A szerkeszto magatol ezt kinalja fel, tehat pont ez
   * a forma, ami ellen az orzo letezik.
   *
   * Ezert minden relativ importot FELOLDUNK, es azt kerdezzuk, KILEP-E a
   * csomagbol. Ez tagabb a kertnel (barmelyik szomszed csomagot elkapja, nem
   * csak az `apps/web`-et), es ez szandekos: az `apps/mobile` vagy az
   * `apps/api` forrasa ugyanugy nincs benne a portal Docker-kepeben.
   */
  it("egyetlen import sem lép ki a csomagból", () => {
    const csomagGyoker = resolve(GYOKER, "..");
    const vetkesek: string[] = [];
    for (const ut of fajlok) {
      const kod = readFileSync(ut, "utf8");
      for (const m of kod.matchAll(/from\s+["']([^"']+)["']/g)) {
        const cel = m[1] as string;
        if (cel.startsWith(".")) {
          const feloldott = resolve(dirname(ut), cel);
          if (!feloldott.startsWith(csomagGyoker))
            vetkesek.push(`${ut} -> ${cel}`);
        } else if (/^(@acropora\/web|apps\/)/.test(cel)) {
          vetkesek.push(`${ut} -> ${cel}`);
        }
      }
    }
    assert.deepEqual(vetkesek, []);
  });

  /**
   * ES A TILTAS PARJA: a KOZOS csomag hasznalata IGENIS all.
   *
   * Enelkul a fenti allitas akkor is zold lenne, ha a portal SEMMILYEN kozos
   * komponenst nem hasznalna -- vagyis a kapu nem tudna megkulonboztetni a
   * "helyesen a kozos csomagot hasznalja" es a "semmit nem hasznal" esetet.
   * Ez a par az, ami a 3. kikotest merhetove teszi, nem a tiltas onmagaban.
   */
  it("az eszköz-adatlap a közös UI-ból épül", () => {
    const lap = readFileSync(
      join(GYOKER, "components", "asset-detail.tsx"),
      "utf8",
    );
    assert.match(lap, /from\s+"@acropora\/ui"/);
  });

  /**
   * A KERET OSZTALYAI NEM JOHETNEK VISSZA.
   *
   * Ot osztaly kerult el a stiluslapbol (2026-09-21), mert a keret atallt a
   * `frame.ts` konstansaira. Ha barmelyik VISSZAKERUL egy uj lapra, a stilusa
   * MAR NINCS MEG -- es ez NEMA: az elem megjelenik, csak keret, kitoltes es
   * szin nelkul. Sem fordito, sem futasido nem szol.
   */
  it("a keret régi osztályai nem térnek vissza", () => {
    const eltavolitott = [
      "panel",
      "page-header",
      "eyebrow",
      "back-link",
      "muted",
      // A `status` 2026-09-24-ig KIVÉTEL volt ezen a listán, mert saját
      // dinamikus CSS-szabályai éltek (lásd lent) -- azóta ez a hat osztály
      // egy csoportba tartozik, mind a `frame.tsx`/`ServiceStatusBadge`
      // váltotta fel őket (murena mérése).
      "status",
      // A FELSO SAVAS KERET ES A REGI BEJELENTKEZO LAP OSZTALYAI (2026-09-25,
      // Figma 9. kor): a `portal-shell.tsx` bal oldalsavra allt, a
      // `login/page.tsx` a `pilot-aqua-*`/`pilot-grey-*` tokenekre. A bare
      // "error" NEM tevesztendo ossze a `Message` komponens `className={\`message
      // ${MESSAGE_TONE_CLASS[tone]}\`}` alakjaval: a `${...}` interpolacio a
      // fenti `kodSzoveg`/csere lepesben kiürül, tehat onnan literalis "error"
      // token sosem szarmazik -- csak a mostmar torolt, nyers
      // `className="error"` login-hibaszoveg adott ilyet.
      "topbar",
      "brand",
      "account",
      "navigation",
      "login-page",
      "login-card",
      "error",
      // A `DocumentPanel` OSZTÁLYAI (2026-09-25, Figma 9. kör): a
      // hibajegy-, eszköz- és munkalap-adatlap (mind pilot-aqua) után ez
      // volt az utolsó violet hívóhely -- `PilotCard`/`PilotFormField`/
      // `PilotInput`/`PilotButton` és Tailwind-osztályok váltották fel.
      "document-panel",
      "document-grid",
      "document-card",
      "document-thumb",
      "document-upload",
      "image-overlay",
    ];
    const vetkesek: string[] = [];
    for (const ut of fajlok) {
      /*
        A KOMMENTEKET KI KELL SZEDNI, ES EZT A KALIBRACIO MUTATTA MEG.

        Az elso valtozatom KET talalatot adott, mindkettot a `frame.tsx`
        SAJAT DOKUMENTACIOJABOL: ott szo szerint all, hogy `className="form
        panel"` es `className="muted"` -- epp azert, hogy a kovetkezo olvaso
        lassa, mi volt a regi alak. A merohely a magyarazo szoveget vette
        leletnek.
      */
      const kod = kodSzoveg(readFileSync(ut, "utf8"));
      for (const m of kod.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const nyers = (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
        for (const osztaly of nyers.split(/\s+/))
          if (eltavolitott.includes(osztaly))
            vetkesek.push(`${ut}: ${osztaly}`);
      }
    }
    assert.deepEqual(vetkesek, []);
  });

  /**
   * A `status-${...}` DINAMIKUS MINTA SOSEM LÉTEZETT A KÓDBAN -- ÚJRAMÉRVE
   * (murena, 2026-09-24, barracuda korábbi mérése alapján).
   *
   * Ez az állítás korábban PONT AZ ELLENKEZŐJÉT védte: hogy a hibajegy
   * állapot-címkéje `status-${allapot.toLowerCase()}` alakban épül, tehát a
   * `.status-new`, `.status-in_progress`, `.status-completed` és
   * `.status-closed` CSS-szabályokat egy "használatlan osztály" takarítás
   * jóhiszeműen elvinné. EZ A FELTEVÉS HAMIS VOLT: a mintát a TELJES
   * monorepón (`apps/api`, `apps/mobile`, `apps/partner`, `apps/web`,
   * `packages/ui`) sehol nem használja semmilyen forrás -- csak ez a teszt
   * idézte és építette meg egy regexben. A hibajegy állapota ma a megosztott
   * `ServiceStatusBadge`-en (`@acropora/ui`) át jelenik meg, saját
   * `serviceToneClass` térképpel, és a `.status`/`.status-*`
   * CSS-szabályokat a takarítás emiatt elvitte a `globals.css`-ből
   * (2026-09-24, lásd a "keret régi osztályai" állítást fent, ami mostantól
   * a `status`-t is védi).
   */
  it("a status-${...} dinamikus minta valóban nem létezik sehol", () => {
    const vetkesek: string[] = [];
    for (const ut of fajlok) {
      const kod = kodSzoveg(readFileSync(ut, "utf8"));
      if (kod.includes("status-${")) vetkesek.push(ut);
    }
    assert.deepEqual(vetkesek, []);
  });

  /**
   * A TAILWIND FORRAS-SORA NEM ELHAGYHATO, ES A HIANYA NEMA.
   *
   * A `@acropora/ui` komponensei Tailwind-osztalyokkal dolgoznak. A `@source`
   * sor nelkul a Tailwind nem latja a forrasukat, tehat azok az osztalyok
   * kimaradnak a kimenetbol: a lap BETOLTODIK, csak stilus nelkul. Nincs
   * forditasi hiba, es nincs futasideju kivetel -- semmi nem szolna.
   */
  it("a Tailwind látja a közös UI forrását", () => {
    const css = readFileSync(join(GYOKER, "app", "globals.css"), "utf8");
    assert.match(css, /@import\s+"tailwindcss";/);
    assert.match(css, /@source\s+"\.\.\/\.\.\/\.\.\/\.\.\/packages\/ui\/src";/);
  });

  /**
   * A KÖZÖS TÉMA TÉNYLEG IDE JUT, ÉS A DEFINÍCIÓ VALÓDI, NEM CSAK ÍGÉRT.
   *
   * Balázs kérése, 2026-09-24 07:28 UTC: a partner portál eszközkezelője
   * ugyanúgy nézzen ki, mint az app.acropora.hu. Idáig ez a fájl EGY
   * MEGJEGYZÉSBEN ígérte a "közös vizuális alapot" (2026-09-21), de a
   * TÉNYLEGES `@theme` tokenek sosem érkeztek meg -- ez az állítás pont ezt
   * a különbséget zárja le: nem elég, hogy az import-sor ott áll, a
   * hivatkozott fájlnak TÉNYLEG tartalmaznia kell a tokent, amire a
   * `@acropora/ui` komponensei (pl. a `Badge` `bg-brand-*` osztályai)
   * támaszkodnak.
   *
   * A WEBES OLDAL ELLENŐRZÉSE KÜLÖN FÁJLBAN ÁLL
   * (`apps/web/src/app/globals-theme.test.ts`), NEM ITT: ez a csomag SOSEM
   * hivatkozhat `apps/web`-re (lásd a fenti "egyetlen import sem lép ki a
   * csomagból" állítást) -- egy ide írt, `apps/web`-et olvasó teszt pontosan
   * azt a határt mosná el, amit ez a spec véd.
   */
  it("a közös témát importálja, és a téma valóban definiálja a brand-600 tokent", () => {
    const css = readFileSync(join(GYOKER, "app", "globals.css"), "utf8");
    assert.match(
      css,
      /@import\s+"\.\.\/\.\.\/\.\.\/\.\.\/packages\/ui\/src\/theme\.css";/,
    );
    const theme = readFileSync(
      resolve(GYOKER, "..", "..", "..", "packages", "ui", "src", "theme.css"),
      "utf8",
    );
    assert.match(theme, /--color-brand-600:/);
  });

  /**
   * A "PILOT" (FIGMA-TERV) TEMA-RETEG IS TENYLEG IDE JUT (2026-09-25, Figma
   * 9. kor). Ugyanaz a szerkezet, mint a fenti `theme.css` allitasnal: nem
   * eleg, hogy az import-sor ott all, a hivatkozott fajlnak TENYLEG
   * tartalmaznia kell a tokent, amire a bal oldalsav es a bejelentkezes
   * (`pilot-aqua-*`/`pilot-grey-*` osztalyok) tamaszkodnak.
   */
  it("a pilot témát importálja, és a téma valóban definiálja a pilot-aqua-600 tokent", () => {
    const css = readFileSync(join(GYOKER, "app", "globals.css"), "utf8");
    assert.match(
      css,
      /@import\s+"\.\.\/\.\.\/\.\.\/\.\.\/packages\/ui\/src\/figma-theme\.css";/,
    );
    const figmaTheme = readFileSync(
      resolve(
        GYOKER,
        "..",
        "..",
        "..",
        "packages",
        "ui",
        "src",
        "figma-theme.css",
      ),
      "utf8",
    );
    assert.match(figmaTheme, /--color-pilot-aqua-600:/);
  });
});
