import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * FIGMA 12. KÖR, 3. CSOPORT (Anyagigények, Partnerek lista+adatlap) -- MINDEN
 * KÉPERNYŐNEK EGY ÁLLÍTÁS, hogy a színek a közös `useAppTheme()`-ből
 * jönnek, nincs fix hex
 * (`exchange/figma-telefon-atultetes-brief-2026-09-25.md`, "Ellenőrzés"
 * szakasz).
 *
 * A `material-requests/[id].tsx` NEM SZEREPEL A LISTÁN: az a képernyő
 * kizárólag egy `<Redirect>`-et ad vissza (lásd a saját fejlécét), nincs
 * benne SEM stílus, SEM `useAppTheme()`-re való szükség -- egy állítás,
 * ami ezt kérné rajta, önmagában hamis elvárást fogalmazna meg.
 *
 * A `hexSzinLiteralok` FÜGGVÉNY HELYBEN ÁLL, NEM EGY KÖZÖS MODULBÓL JÖN --
 * lásd a `service-jobs/figma12-group2-theme.spec.ts` azonos indoklását: hat
 * független, egymásra nem épülő PR-csoport nem oszthat meg egy be nem
 * olvadt modult.
 */
function hexSzinLiteralok(forras: string): string[] {
  const kod = forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
  return [
    ...kod.matchAll(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g),
  ].map((m) => m[0]);
}

const SRC = join(__dirname, "..", "..", "src", "app");

const KEPERNYOK = [
  { fajl: join("material-requests", "index.tsx"), nev: "Anyagigények" },
  { fajl: join("partners", "index.tsx"), nev: "Partnerek lista" },
  { fajl: join("partners", "[id].tsx"), nev: "Partner adatlap" },
];

describe("Figma 12. kör, 3. csoport: nincs fix hex, useAppTheme mindenütt", () => {
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
