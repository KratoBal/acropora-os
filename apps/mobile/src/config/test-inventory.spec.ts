import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Minden megírt teszt le is fusson.
 *
 * Ez az app nem a szokásos módon futtat: az Expo forráskódja nem fordul le
 * egyszerű `tsc`-vel (JSX, natív modulok), ezért a `tsconfig.test.json` egy
 * KÉZZEL karbantartott listát tartalmaz arról, mi kerül a teszt-fordításba.
 * Egy új spec, amit valaki elfelejt felvenni, nem hibázik: le sem fordul, nem
 * fut, és a futtató a maradék tesztek zöldjét jelenti.
 *
 * Pontosan ez történt: a mobil push-regisztráció hét tesztje egyetlen egyszer
 * sem futott le, és a "129 teszt zöld" sor ugyanúgy nézett ki, mint előtte.
 * A darabszám nem mondja meg, MI futott - csak azt, hogy ami futott, az jó
 * volt.
 */

const TSCONFIG = "tsconfig.test.json";

function specFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return specFiles(path);
    return path.endsWith(".spec.ts") ? [path] : [];
  });
}

function includedPaths(): string[] {
  const raw = readFileSync(TSCONFIG, "utf8");
  return [...raw.matchAll(/"(src\/[^"]+)"/g)].map((match) => match[1]!);
}

describe("teszt-leltár", () => {
  it("minden megírt spec szerepel a teszt-fordítás listájában", () => {
    const included = new Set(includedPaths());
    const missing = specFiles("src").filter((path) => !included.has(path));

    assert.deepEqual(
      missing,
      [],
      `Ezek a tesztek nem futnak, mert nincsenek a ${TSCONFIG} listájában. Egy le nem futó teszt nem véd semmit, és a darabszámon nem látszik.`,
    );
  });

  /**
   * Fordítva is: egy elgépelt vagy törölt útvonal a listában csendben nem
   * fordít le semmit, és ugyanígy néz ki, mint a helyes állapot.
   */
  it("a listán szereplő minden útvonal létezik", () => {
    const missing = includedPaths().filter((path) => {
      try {
        statSync(path);
        return false;
      } catch {
        return true;
      }
    });

    assert.deepEqual(
      missing,
      [],
      `A ${TSCONFIG} nem létező fájlokra hivatkozik.`,
    );
  });
});
