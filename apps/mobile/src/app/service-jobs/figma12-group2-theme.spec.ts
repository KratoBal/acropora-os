import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * FIGMA 12. KÖR, 2. CSOPORT (Hibajegyek: lista, adatlap, új) -- MINDEN
 * KÉPERNYŐNEK EGY ÁLLÍTÁS, hogy a színek a közös `useAppTheme()`-ből
 * jönnek, nincs fix hex, a kamera/fénykép-rátétek kivételével
 * (`exchange/figma-telefon-atultetes-brief-2026-09-25.md`, "Ellenőrzés"
 * szakasz).
 *
 * A `[id].tsx`-EN KÉT MEGENGEDETT HEX ÁLL: a teljes képernyős fénykép-nézet
 * fekete alapja (`nagyRatet`) és a rajta álló felirat (`nagyFelirat`) --
 * ugyanaz az indok, mint a `document-panel.tsx`/`assets/[id].tsx` saját
 * fénykép-nézőjénél: ez a réteg mindig egy élő fénykép fölé kerül, nem a
 * téma része.
 *
 * A `hexSzinLiteralok` FÜGGVÉNY HELYBEN ÁLL, NEM EGY KÖZÖS MODULBÓL JÖN:
 * ez a spec egy önálló PR-csoport (2/6), friss mainról, a többi csoporttól
 * FÜGGETLENÜL mergelhetően -- egy megosztott `lib/theme/no-fixed-hex.ts`
 * modul az 1. csoport (még nem beolvadt) ágán élne, és ez a fájl attól
 * függne. Egy tíz soros regex-függvény duplikálása olcsóbb, mint a
 * hat "friss mainról, egymásra nem építve" PR közötti láncolás.
 */
function hexSzinLiteralok(forras: string): string[] {
  const kod = forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
  return [
    ...kod.matchAll(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g),
  ].map((m) => m[0]);
}
const SRC = join(__dirname, "..", "..", "..", "src", "app", "service-jobs");

const KEPERNYOK: { fajl: string; nev: string; megengedettHex?: string[] }[] = [
  { fajl: "index.tsx", nev: "Hibajegyek lista" },
  {
    fajl: "[id].tsx",
    nev: "Hibajegy adatlap",
    megengedettHex: ["#eaf4fa", "#03101acc"],
  },
  { fajl: "new.tsx", nev: "Új hibajegy" },
];

describe("Figma 12. kör, 2. csoport: nincs fix hex (a fénykép-rátét kivételével), useAppTheme mindenütt", () => {
  it("ISMERT POZITÍV KONTROLL: a kontroll-lista tényleg nem üres", () => {
    assert.ok(KEPERNYOK.length >= 3);
  });

  for (const { fajl, nev, megengedettHex = [] } of KEPERNYOK) {
    it(`${nev} (${fajl}): nincs fix hex szín a fénykép-rátéten kívül, és a useAppTheme-et hívja`, () => {
      let forras: string;
      try {
        forras = readFileSync(join(SRC, fajl), "utf8");
      } catch {
        throw new Error(
          `Nem tudtam elolvasni: ${join(SRC, fajl)}. Ez a KERESÉS hibája, nem a lefedettségé.`,
        );
      }
      const talalatok = hexSzinLiteralok(forras).filter(
        (hex) => !megengedettHex.includes(hex),
      );
      assert.deepEqual(
        talalatok,
        [],
        `${fajl} nem megengedett fix hex színt tartalmaz: ${talalatok.join(", ")}`,
      );
      assert.match(
        forras,
        /useAppTheme\(\)/,
        `${fajl} nem hívja a useAppTheme()-et`,
      );
    });
  }
});
