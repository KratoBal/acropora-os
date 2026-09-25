import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hexSzinLiteralok } from "./no-fixed-hex";

describe("hexSzinLiteralok", () => {
  it("megtalálja a 3, 6 és 8 jegyű hex színeket", () => {
    const forras = `
      const styles = {
        a: { color: "#fff" },
        b: { color: "#071827" },
        c: { color: "#0b263dcc" },
      };
    `;
    assert.deepEqual(hexSzinLiteralok(forras), [
      "#fff",
      "#071827",
      "#0b263dcc",
    ]);
  });

  it("nem talál semmit, ha a fájl csak tokent használ", () => {
    const forras = `
      function createStyles(t) {
        return { a: { color: t.textPrimary } };
      }
    `;
    assert.deepEqual(hexSzinLiteralok(forras), []);
  });

  /**
   * A KOMMENTBEN ÁLLÓ HEX NEM LELET -- egy fejléc-komment gyakran idézi a
   * RÉGI, már lecserélt hex-et (lásd ennek a fájlnak a saját párja,
   * `login.tsx` fejléce), és egy nyers illesztés azt is elkapná.
   */
  it("nem talál hexet blokk- vagy sor-kommentben", () => {
    assert.deepEqual(
      hexSzinLiteralok(`/* korábban #071827 volt */\nconst x = 1;`),
      [],
    );
    assert.deepEqual(
      hexSzinLiteralok(`// korábban #071827 volt\nconst x = 1;`),
      [],
    );
  });

  it("egy sima szót nem hex-ként ismer fel", () => {
    assert.deepEqual(hexSzinLiteralok(`const cim = "#hashtag";`), []);
  });
});
