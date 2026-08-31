import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * AMI TESZTET IR, AZT A FUTTATO MEG IS TALALJA.
 *
 * A teszt-szkriptek FELDERITESSEL dolgoznak (`find test-dist -name '*.spec.js'`),
 * es a felderites egyetlen dolgon all: a fajl NEVEN. Egy spec, ami lefordul, de
 * a nevevel nem illeszkedik a mintara, CSENDBEN kimarad a kozos futasbol -- a
 * fordito nem szol, a futtato nem szol, es a fajlban allo allitasok ugyanugy ott
 * allnak, mintha ornenek valamit.
 *
 * EZ A HEZAG NEVEN VOLT NEVEZVE, ES NEM VOLT LEZARVA. A testver-lap
 * (`integration-spec-inventory.spec.ts`) azt orzi, hogy a felderites ELE nem
 * kerul kezzel irt lista, es hogy amit kizarunk, annak legyen hol futnia. Amit
 * egyik sem nezett: hogy a lemezen allo tesztek NEVE illeszkedik-e egyaltalan
 * ahhoz a mintahoz, amivel keresunk.
 *
 * A JELZES, AMIRE EPIT: a `node:test` modul behuzasa. Egy fajl, ami ezt
 * behozza, tesztet ir; nincs mas oka behozni. Ez fuggetlen a fajl NEVETOL,
 * tehat pont azt a kerdest tudja feltenni, amit a nev alapu kereses nem.
 */

const SPEC_ROOT = "src";
const PACKAGE_JSON = "package.json";
const DISCOVERY_SCRIPT = "test";

/**
 * A SMOKE SPEC a kozos futasbol a NEVEVEL esik ki (`! -name '*.smoke.spec.js'`),
 * tehat sajat szkript nelkul sehol nem futna. Az INTEGRACIOS agat szandekosan
 * NEM nezem itt: azt a testver-lap mar orzi, ket iranyba is, es egy masodik,
 * kicsit maskepp fogalmazott masolat elobb-utobb massal jonne ki.
 */
const EXCLUDED_BY_NAME = ".smoke.spec.ts";

function sourceFiles(directory = SPEC_ROOT): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return path.endsWith(".ts") ? [path] : [];
    })
    .sort();
}

/** Ami a `node:test` modult behozza, az tesztet ir, barhogy hivjak. */
function writesTests(path: string): boolean {
  return /from ["']node:test["']/.test(readFileSync(path, "utf8"));
}

function scripts(): Record<string, string> {
  return (
    JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;
}

const compiledName = (path: string) =>
  path.split("/").pop()?.replace(/\.ts$/, ".js") ?? "";

/**
 * A KONTROLL, ES ELOL ALL.
 *
 * Egy halmaz-egyenloseg KET URES halmaz kozott is teljesul: ha a `node:test`
 * keresese valaha nullat ad (mas import-alak, athelyezett fak, elirt minta), az
 * alabbi ket allitas ROSSZ OKBOL lesz zold, es pont azt a vedelmet veszitjuk el,
 * amiert ez a fajl keszult. Ezert a szam ELOSZOR szolal meg.
 *
 * Az also hatar SZANDEKOSAN durva: nem a mai darabszamot rogziti (az minden uj
 * teszttel elmozdulna, es akkor ez a sor a valtoztatas adoja lenne), csak azt,
 * hogy a kereses NAGYSAGRENDILEG lat.
 */
test("lát tesztfájlokat és látja a szkriptet, amivel összeveti", () => {
  const writers = sourceFiles().filter(writesTests);
  assert.ok(
    writers.length >= 100,
    `Csak ${writers.length} fájl hozza be a node:test modult; a keresés valószínűleg elavult.`,
  );
  assert.ok(
    scripts()[DISCOVERY_SCRIPT]?.includes("find test-dist"),
    `A ${DISCOVERY_SCRIPT} szkript nem felderítéssel dolgozik; ez a fájl a felderítést őrzi.`,
  );
});

/**
 * A LEZART HEZAG. A felderites `*.spec.js` alakot keres, tehat egy `foo.test.ts`
 * vagy `foo-tests.ts` nevu fajl lefordul, betolt, es SOSEM fut le.
 */
test("minden tesztfájl neve illeszkedik a felderítés mintájára", () => {
  assert.deepEqual(
    sourceFiles()
      .filter(writesTests)
      .filter((path) => !path.endsWith(".spec.ts")),
    [],
    "Ezek a fájlok tesztet írnak, de a nevükkel kimaradnak a közös futásból.",
  );
});

/**
 * ES A MASIK IRANY, a testver-lap szabalya a smoke agra: amit a kozos futas a
 * NEVEVEL kizar, annak legyen sajat szkriptje. A testver-lap ezt az integracios
 * agra mondja ki, a smoke ag eddig egyik lapon sem allt.
 */
test("amit a közös futás kizár, annak van hol futnia", () => {
  const commands = Object.values(scripts());
  assert.deepEqual(
    sourceFiles()
      .filter(writesTests)
      .filter((path) => path.endsWith(EXCLUDED_BY_NAME))
      .filter((path) =>
        commands.every((command) => !command.includes(compiledName(path))),
      ),
    [],
    "Ezek a specek kimaradnak a közös futásból, és nincs szkript, ami futtatná őket.",
  );
});
