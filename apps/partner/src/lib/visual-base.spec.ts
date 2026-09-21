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
   * ES A TUKRE: A DINAMIKUSAN EPULO OSZTALYOK NEM TUNHETNEK EL A STILUSLAPBOL.
   *
   * A hibajegy allapot-cimkeje `status-${allapot.toLowerCase()}` alakban epul,
   * tehat a `.status-new`, `.status-in_progress`, `.status-completed` es
   * `.status-closed` osztalyok SEHOL nem allnak kiirva a forrasban. Egy
   * "hasznalatlan osztaly" takaritas johiszemuen elvinne mind a negyet.
   *
   * EZ A KOR PONTOSAN EZT MERTE MEG: az elso meresem NULLA hivohelyet adott
   * rajuk, es ha akkor megallok, a partner allapot-cimkéi szintelenne valtak
   * volna -- eles feluleten, nema modon.
   */
  it("a dinamikusan épülő állapot-osztályok megvannak", () => {
    const css = readFileSync(join(GYOKER, "app", "globals.css"), "utf8");
    for (const allapot of ["new", "in_progress", "completed", "closed"])
      assert.match(
        css,
        new RegExp(`\\.status-${allapot}\\b`),
        `hiányzik a .status-${allapot} szabály`,
      );
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
});
