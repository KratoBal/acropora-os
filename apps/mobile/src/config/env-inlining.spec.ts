import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Ez a teszt a FORRÁST olvassa, nem a viselkedést, és ez szándékos: az a hiba,
 * amit őriz, futásidőben NEM fogható meg fejlesztés közben.
 *
 * Az `EXPO_PUBLIC_*` értékek kész buildben nem a környezetből érkeznek. A
 * `babel-preset-expo` fordításkor helyettesíti be őket, és a bővítménye CSAK a
 * `process.env.EXPO_PUBLIC_X` pontos alakot ismeri fel (a tagválasztás
 * objektuma maga a `process.env`). Ha az objektumot továbbadjuk, semmi nem
 * illeszkedik, semmi nem helyettesítődik, és a kész binárisban minden mező
 * `undefined`.
 *
 * Metro alatt viszont VAN valódi környezet, tehát a hibás alak fejlesztés
 * közben tökéletesen működik. Kizárólag élesben derül ki, egy fél órás build
 * után - kétszer így is történt.
 */

const FILE = readFileSync("src/config/env.ts", "utf8");

/**
 * A kommentek kikerülnek, mielőtt keresnénk. A fájl jegyzete SZÁNDÉKOSAN
 * leírja a hibás alakot is, hogy a következő olvasó értse, mit nem szabad -
 * egy nyers szövegkeresés viszont azt is találatnak venné, és a teszt a saját
 * magyarázatán bukna el.
 */
const SOURCE = FILE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("EXPO_PUBLIC beégetés a kész buildben", () => {
  it("a teszt tényleg a helyes fájlt olvassa", () => {
    assert.match(SOURCE, /export function readEnvironment/);
  });

  /**
   * A teljes objektum átadása az a hívás, ami kétszer megállította az
   * alkalmazást indításkor.
   */
  it("nem adja át a teljes process.env objektumot", () => {
    assert.equal(
      /readEnvironment\(\s*process\.env\s*\)/.test(SOURCE),
      false,
      "readEnvironment(process.env): a fordító ilyenkor semmit nem éget be",
    );
  });

  /**
   * A valódi őrzés: amit a függvény OLVAS, azt a hívásnak nevesítve kell
   * átadnia. Így egy új változó bevezetése nem tud csendben kimaradni - a
   * kimaradás pontosan úgy nézne ki, mintha a beállítás hiányozna.
   */
  it("minden olvasott változót nevesítve, közvetlen alakban ad át", () => {
    const read = new Set(
      [...SOURCE.matchAll(/source\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)].map(
        (match) => match[1]!,
      ),
    );
    assert.ok(
      read.size > 0,
      "a függvény egyetlen EXPO_PUBLIC változót sem olvas",
    );

    for (const name of read) {
      const inlined = new RegExp(
        `${name}:\\s*\\n?\\s*process\\.env\\.${name}\\b`,
      );
      assert.ok(
        inlined.test(SOURCE),
        `${name}: a hívásban process.env.${name} alakban kell átadni, különben a kész buildben undefined`,
      );
    }
  });
});
