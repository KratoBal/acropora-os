import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * FIGMA 12. KÖR, 4. CSOPORT (feltöltési sor: queue.tsx, queue-fix/[id].tsx,
 * queue-resolve/[id].tsx) -- MINDEN KÉPERNYŐNEK EGY ÁLLÍTÁS, hogy a színek a
 * közös `useAppTheme()`-ből jönnek, nincs fix hex
 * (`exchange/figma-telefon-atultetes-brief-2026-09-25.md`, "Ellenőrzés"
 * szakasz).
 *
 * A `hexSzinLiteralok` FÜGGVÉNY HELYBEN ÁLL, NEM EGY KÖZÖS MODULBÓL JÖN --
 * lásd a `service-jobs/figma12-group2-theme.spec.ts` és a
 * `figma12-group3-theme.spec.ts` azonos indoklását: hat független, egymásra
 * nem épülő PR-csoport nem oszthat meg egy be nem olvadt modult.
 *
 * A SPEC ITT ÁLL, NEM A `src/app` ALATT (acrobot mérése, 2026-09-25 17:03):
 * az Expo Router a `src/app` MINDEN fájlját útvonalként próbálja buildelni,
 * és a `node:test` importot az `expo export` nem tudja feloldani -- a
 * "Static verification" CI-lépés emiatt bukott a korábbi csoportoknál is
 * (#1146, #1147, #1149).
 */
function hexSzinLiteralok(forras: string): string[] {
  const kod = forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
  return [
    ...kod.matchAll(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g),
  ].map((m) => m[0]);
}

const SRC = join(__dirname, "..", "..", "..", "src", "app");

const KEPERNYOK = [
  { fajl: join("queue.tsx"), nev: "Feltöltésre váró felvitelek" },
  { fajl: join("queue-fix", "[id].tsx"), nev: "Elakadt felvitel javítása" },
  {
    fajl: join("queue-resolve", "[id].tsx"),
    nev: "Elakadt módosítás feloldása",
  },
];

describe("Figma 12. kör, 4. csoport: nincs fix hex, useAppTheme mindenütt", () => {
  it("ISMERT POZITÍV KONTROLL: a kontroll-lista tényleg nem üres", () => {
    assert.ok(KEPERNYOK.length >= 3);
  });

  for (const { fajl, nev } of KEPERNYOK) {
    it(`${nev} (${fajl}): nincs fix hex szín, és a useAppTheme-et hívja`, () => {
      let forras: string;
      try {
        forras = readFileSync(join(SRC, fajl), "utf8");
      } catch {
        throw new Error(
          `Nem tudtam elolvasni: ${join(SRC, fajl)}. Ez a KERESÉS hibája, nem a lefedettségé.`,
        );
      }
      assert.deepEqual(
        hexSzinLiteralok(forras),
        [],
        `${fajl} fix hex színt tartalmaz`,
      );
      assert.match(
        forras,
        /useAppTheme\(\)/,
        `${fajl} nem hívja a useAppTheme()-et`,
      );
    });
  }
});
