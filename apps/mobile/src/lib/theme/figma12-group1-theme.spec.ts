import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { hexSzinLiteralok } from "./no-fixed-hex";

/**
 * FIGMA 12. KÖR, 1. CSOPORT (kezdőlap, bejelentkezés, Beállítások, `_layout`) --
 * MINDEN KÉPERNYŐNEK EGY ÁLLÍTÁS, hogy a színek a közös `useAppTheme()`-ből
 * jönnek, nincs fix hex (`exchange/figma-telefon-atultetes-brief-2026-09-25.md`,
 * "Ellenőrzés" szakasz). Ebben a négy fájlban nincs kamera-rátét, tehát a
 * mérce egyszerű: NULLA hex-literál.
 *
 * A SPEC ITT ÁLL, NEM A `src/app` ALATT (acrobot mérése, 2026-09-25 17:03):
 * az Expo Router a `src/app` MINDEN fájlját útvonalként próbálja buildelni,
 * és a `node:test` importot az `expo export` nem tudja feloldani -- a
 * "Static verification" CI-lépés emiatt bukott. A `no-fixed-hex.ts` is már
 * itt állt, tehát a spec csak követi a saját segédjét.
 *
 * A `__dirname` A `test-dist`-BEN A LEFORDÍTOTT FÁJL MELLETT ÁLL, DE A
 * FORRÁSFÁT OLVASSUK -- ugyanaz a minta, mint a `worksheet-assets.spec.ts`
 * `KEPERNYO` állandójánál: a `.tsx` fájl a `test-dist`-ben nincs is meg.
 */
const SRC = join(__dirname, "..", "..", "..", "src", "app");

const KEPERNYOK = [
  { fajl: "index.tsx", nev: "Kezdőlap" },
  { fajl: "login.tsx", nev: "Bejelentkezés" },
  { fajl: "settings.tsx", nev: "Beállítások" },
  { fajl: "_layout.tsx", nev: "_layout" },
];

describe("Figma 12. kör, 1. csoport: nincs fix hex, useAppTheme mindenütt", () => {
  it("ISMERT POZITÍV KONTROLL: a kontroll-lista tényleg nem üres", () => {
    assert.ok(KEPERNYOK.length >= 4);
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
