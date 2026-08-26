import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * MINDEN MEGÍRT INTEGRÁCIÓS SPEC LE IS FUSSON VALAHOL.
 *
 * Az integrációs suite adatbázist kíván, ezért nem a `pnpm test` futtatja,
 * hanem külön célok, és azok KÉZZEL FELÍROTT fájllistából dolgoznak. Egy spec,
 * amit valaki elfelejt felvenni, nem hibázik: le sem fordul a futtatásba, nem
 * fut, és a darabszám ugyanúgy néz ki, mint előtte.
 *
 * Pontosan ez történt: tizenhat integrációs spec közül HÁROM egyik listán sem
 * szerepelt (a két Medusa és a termék-írás kapuja), és soha, senkinél nem
 * futott le. Nem voltak pirosak -- meg sem szólaltak. A hiba a mérés hiánya
 * volt, nem a kódé, és pont a Medusa credential-kör élő bizonyítása előtt derült
 * ki, amikor a „a Medusa integrációs tesztek zöldek" mondat már majdnem
 * elhangzott.
 *
 * A minta a mobil oldali `src/config/test-inventory.spec.ts`, szándékosan
 * ugyanaz a fogalom: egy szabály, amit két helyen kétféleképpen fogalmazunk meg,
 * két év múlva két különböző dolgot fog jelenteni.
 */

const PACKAGE_JSON = "package.json";
const SPEC_ROOT = "src";

/** A lemezen lévő integrációs specek, a `test-dist` alakjukra fordítva. */
function integrationSpecsOnDisk(directory = SPEC_ROOT): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return integrationSpecsOnDisk(path);
      return path.endsWith(".integration.spec.ts") ? [path] : [];
    })
    .map((path) => path.replace(/^src\//, "test-dist/").replace(/\.ts$/, ".js"))
    .sort();
}

/** Amit a `package.json` bármelyik szkriptje ténylegesen futtat. */
function integrationSpecsInScripts(): string[] {
  const source = readFileSync(PACKAGE_JSON, "utf8");
  return [
    ...new Set(
      [...source.matchAll(/test-dist\/[\w/.-]*\.integration\.spec\.js/g)].map(
        (match) => match[0],
      ),
    ),
  ].sort();
}

/**
 * A KONTROLL A KERESÉSRE, és ez az állítás a legfontosabb a háromból.
 *
 * Egy leltár, ami ÜRES halmazt vet össze egy listával, zölden hazudik: nem talál
 * hiányt, mert nem talál semmit. Ugyanez a csapda, mint a mobil tükör-tesztnél.
 */
test("finds the specs and the script list it compares", () => {
  const onDisk = integrationSpecsOnDisk();
  const inScripts = integrationSpecsInScripts();

  assert.ok(
    onDisk.length >= 10,
    `Csak ${onDisk.length} integrációs specet találtam a lemezen. Ez a keresés hibája, nem a lefedettségé.`,
  );
  assert.ok(
    inScripts.length >= 10,
    `Csak ${inScripts.length} integrációs spec szerepel a szkriptekben. Ez a keresés hibája.`,
  );
  assert.equal(
    onDisk.includes(
      "test-dist/worksheets/worksheets.repository.integration.spec.js",
    ),
    true,
    "a munkalap integrációs specje nevesítve is legyen a találatok közt",
  );
});

test("runs every integration spec that exists", () => {
  const inScripts = new Set(integrationSpecsInScripts());
  const missing = integrationSpecsOnDisk().filter(
    (spec) => !inScripts.has(spec),
  );

  assert.deepEqual(
    missing,
    [],
    "Ezek az integrációs specek egyetlen szkriptben sem szerepelnek, tehát SEHOL nem futnak: " +
      missing.join(", "),
  );
});

/**
 * ÉS FORDÍTVA: egy elgépelt vagy törölt útvonal a listában csendben nem futtat
 * semmit, és pontosan úgy néz ki, mint a helyes állapot. A szűrő csak azt nézi,
 * mi hiányzik a listáról; ami fölöslegesen ott áll, sosem válna pirosra magától.
 */
test("keeps no script entry for a spec that no longer exists", () => {
  const onDisk = new Set(integrationSpecsOnDisk());
  const stale = integrationSpecsInScripts().filter((spec) => !onDisk.has(spec));

  assert.deepEqual(
    stale,
    [],
    "A package.json nem létező integrációs specekre hivatkozik: " +
      stale.join(", "),
  );
});
