import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ASSET_STATUS_LABELS,
  ASSET_STATUS_OPTIONS,
  ASSET_STATUS_ORDER,
} from "./asset-status";

/**
 * EGY STATUSZNAK EGY NEVE VAN.
 *
 * A hiba, amit ez a fajl orizni hivatott, NEM elirás volt: harom kepernyo
 * ugyanazt a tablat irta le kulon, es a negyedik helyen (a szerkesztoben) ket
 * ertek elcsuszott. Egy ilyen elcsuszasnak nincs tunete a forditonal, mert
 * mindketto ervenyes string.
 *
 * EZERT KET FAJTA ALLITAS ALL ITT, ES A MASODIK A LENYEG. Az elso a modul
 * viselkedeset meri. A masodik a FORRAST nezi: ha valaki holnap ujra leir egy
 * sajat tablat egy kepernyon, a modul viselkedese valtozatlan marad, tehat egy
 * viselkedes-teszt SOSEM venne eszre. Az egyetlen dolog, ami eszreveszi, az,
 * hogy a cimke-szoveg megjelenik egy masik fajlban.
 */

const SOURCE_ROOT = "src";
const OWNER = "src/lib/assets/asset-status.ts";

function sourceFiles(directory = SOURCE_ROOT): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
    })
    .sort();
}

/**
 * A MAI NEVEK, ES A KET LEVALTOTT is. A levaltottak azert allnak itt, mert egy
 * visszaszivargo `Kivonva` pontosan az a hiba, ami ma volt, es a nevere kell
 * szolnia, nem egy altalanos mondattal.
 */
const STATUS_WORDS = [
  ...Object.values(ASSET_STATUS_LABELS),
  "Üzemel",
  "Kivonva",
];

describe("az állapotnevek modulja", () => {
  it("a sorrend minden állapotot pontosan egyszer sorol fel", () => {
    assert.deepEqual(
      [...ASSET_STATUS_ORDER].sort(),
      Object.keys(ASSET_STATUS_LABELS).sort(),
      "a választó sorrendje és a címke-tábla eltért egymástól",
    );
    assert.equal(new Set(ASSET_STATUS_ORDER).size, ASSET_STATUS_ORDER.length);
  });

  it("a választó a címke-táblából veszi a szöveget, a sorrend szerint", () => {
    assert.deepEqual(
      ASSET_STATUS_OPTIONS,
      ASSET_STATUS_ORDER.map((value) => ({
        value,
        label: ASSET_STATUS_LABELS[value],
      })),
    );
    assert.equal(ASSET_STATUS_OPTIONS[0]?.label, "Aktív");
    assert.equal(ASSET_STATUS_OPTIONS.at(-1)?.label, "Kivezetett");
  });
});

describe("az állapotnevek egy helyen állnak", () => {
  /**
   * A KONTROLL, ES ELOL ALL. Ha a kereses nem talalja meg a szavakat OTT, ahol
   * biztosan ott vannak, akkor az alabbi allitas ures halmazon lesz zold, es
   * pont azt nem veszi eszre, amiert keszult.
   */
  it("megtalálja a neveket a gazdájukban", () => {
    const owner = readFileSync(OWNER, "utf8");
    for (const word of Object.values(ASSET_STATUS_LABELS))
      assert.ok(owner.includes(word), `nem találom a gazdában: ${word}`);
    assert.ok(sourceFiles().includes(OWNER), "a gazda fájl nincs a keresésben");
  });

  it("máshol egyetlen állapotnév sem szerepel", () => {
    const offenders = sourceFiles()
      .filter((path) => path !== OWNER && !path.endsWith(".spec.ts"))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return STATUS_WORDS.filter((word) => source.includes(word)).map(
          (word) => `${path}: ${word}`,
        );
      });
    assert.deepEqual(
      offenders,
      [],
      "Ezek a fájlok saját állapotnevet írnak le; a nevek gazdája az asset-status modul.",
    );
  });
});
