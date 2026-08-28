import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";

import { maskCommentsAndStrings } from "../testing/source-mask.js";

/**
 * A `src/testing` MAPPÁT CSAK SPEC FÁJL HASZNÁLHATJA.
 *
 * MÉRVE 2026-08-28, és ez az őrző oka: a `tsconfig.build.json` kizárja a mappát
 * a futtatható képből (`src/testing/**`), DE A KIZÁRÁS NEM TILTÁS, CSAK
 * ALAPÉRTELMEZÉS. Próbafájllal mérve: ha egy PRODUKCIÓS fájl importálja, a
 * TypeScript a kizárt fájlt is lefordítja, és a segéd megjelenik a `dist` alatt.
 * Vagyis a „teszt-segéd nem utazik az API képébe" állítás addig áll, amíg senki
 * nem importálja produkciós kódból -- és ha valaki mégis, az NEM hibaüzenettel
 * jelentkezik, hanem azzal, hogy csendben ott lesz a képben.
 *
 * MIÉRT SPEC ÉS NEM LINT-SZABÁLY. Az eredeti javaslat lint-szabály volt, azzal
 * az érvvel, hogy az ELŐBB szól: a szerkesztőben, nem a teszt futtatásakor. Ez
 * igaz, és ezt a formát fel is adjuk vele. De mérve: az `apps/api` alatt NINCS
 * eslint (a `lint` szkriptje `tsc --noEmit`), és a teljes munkatérben egyetlen
 * eslint fut, az `apps/mobile`-é. A szabály bevezetése tehát előbb az eslint
 * bevezetését kívánná az API-ba, ami egyszerre hozna szabályokat minden meglévő
 * forrásra. Az ár nagyobb, mint a nyereség; ez a forma gyengébb abban, amiért a
 * lintet választottuk volna, és elég abban, ami számít: a hibás állapot nem jut
 * át a kapun.
 *
 * A KÉT ENGEDETT HELY, INDOKKAL -- egyik sem kivétel, hanem a szabály másik
 * fele:
 *
 * - A SPEC FÁJLOK. A mappa pontosan azért létezik, hogy spec importálja. A
 *   szabály nem az, hogy „senki", hanem az, hogy „csak spec".
 * - A MAPPÁN BELÜLI IMPORT. Egy segéd, ami másik segédet használ, különben
 *   saját magának lenne tilos.
 *
 * EZ AZ ŐRZŐ NEM A `src/testing` MAPPÁBAN ÉL, és ez nem elhelyezési ízlés: egy
 * őrző, ami abban a halmazban lakik, amit őriznie kell, a halmaz szűkítésekor
 * kiesik vele együtt, és zöld marad.
 *
 * A KERESÉS A MASZKON FUT, nem a nyers forráson: egy komment, ami leírja a
 * tiltott importot, nem hívás. Ugyanaz a maszk, amit a két útvonal-őrző is
 * használ -- és ez a harmadik használata.
 */

const API_SRC = "src";
const TESTING_DIR = resolve(API_SRC, "testing");

/** Minden forrásfájl az `src` alatt, a gyökérhez képesti úttal. */
function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(API_SRC);
  return files;
}

/**
 * A fájl importjai, amik a `src/testing` alá mutatnak.
 *
 * A specifikátort a FÁJL MAPPÁJÁHOZ képest oldjuk fel, tehát mindegy, hány
 * szinttel feljebbről jön (`../testing/…`, `../../testing/…`): ami oda mutat,
 * az megjelenik.
 */
function testingImports(file: string, source: string): string[] {
  const masked = maskCommentsAndStrings(source);
  const hits: string[] = [];
  for (const match of masked.matchAll(/\bfrom\s+["'`]/g)) {
    const rest = source.slice(match.index + match[0].length);
    const literal = /^([^"'`]*)["'`]/.exec(rest);
    if (!literal) continue;
    const specifier = literal[1]!;
    if (!specifier.startsWith(".")) continue;
    const target = resolve(file, "..", specifier);
    if (target === TESTING_DIR || target.startsWith(TESTING_DIR + "/"))
      hits.push(specifier);
  }
  return hits;
}

/** Akinek szabad: a spec fájlok, és maga a mappa. */
function mayImportTesting(file: string): boolean {
  return (
    file.endsWith(".spec.ts") ||
    resolve(file).startsWith(TESTING_DIR + "/") ||
    resolve(file) === TESTING_DIR
  );
}

describe("a src/testing mappa csak a teszteké", () => {
  it("olvas is valamit, nem csak zöld", () => {
    /**
     * MIÉRT KELL EZ AZ ÁLLÍTÁS. Ha a bejárás egyszer nem talál semmit -- mert a
     * mappa átkerült, vagy a felismerés elromlott --, a másik teszt ATTÓL IS
     * zöld lenne, hogy nincs mit vizsgálnia. Ez a sor megkülönbözteti a
     * „megnéztem és rendben" állapotot a „nem néztem meg" állapottól.
     */
    const importers = sourceFiles().filter(
      (file) => testingImports(file, readFileSync(file, "utf8")).length > 0,
    );
    assert.ok(
      importers.length > 0,
      "egyetlen fájl sem importál a src/testing alól -- vagy a mappa üres, vagy a felismerés romlott el, és akkor ez az őrző semmit nem őriz",
    );
  });

  it("produkciós fájl nem importál a src/testing alól", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (mayImportTesting(file)) continue;
      for (const specifier of testingImports(file, readFileSync(file, "utf8")))
        offenders.push(`${relative(API_SRC, file)} -> ${specifier}`);
    }
    assert.deepEqual(
      offenders,
      [],
      "produkciós fájl importál a src/testing alól. A kizárás a build-ből NEM tiltás: egy ilyen import behúzza a teszt-segédet a futtatható képbe, és ez nem hibaüzenettel, hanem csendben történik",
    );
  });
});
