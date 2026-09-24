import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * SÖTÉT MÓDBAN A BEÁGYAZOTT `@acropora/ui` KOMPONENSEK NE MARADJANAK
 * SÖTÉT SZÖVEG SÖTÉT ALAPON.
 *
 * === A MÉRT TÖRÉS (2026-09-24, ennek a körnek a saját mérésekor) ===
 *
 * A pilot oldalak (`pilot-aquarium-editor-page.tsx`,
 * `pilot-aquarium-water-values.tsx`, a `CustomerPicker`-en és a
 * `Pagination`-ön keresztül) a MEGLÉVŐ, KÖZÖS `@acropora/ui`
 * `ConfirmDialog`/`Button`/`FormField`/`Pagination` komponenseket ágyazzák
 * be, nem sajátot. Azok `bg-white`-ot viselnek, amit a
 * `[data-theme="dark"] .bg-white` szabály sötét felületre vált -- de a
 * SAJÁT `text-dusk-*` szövegszínüket ez a szabály NEM éri el, mert az egy
 * MÁSIK osztály. Enélkül sötét módban a doboz sötét, a szövege is sötét
 * marad: gyakorlatilag olvashatatlan.
 *
 * EZ A TESZT NEM SZÍNHELYESSÉGET MÉR (ahhoz valódi böngésző-motor kellene,
 * amit a happy-dom nem ad) -- azt méri, hogy a `figma-theme.css` TÉNYLEG
 * felülírja mindazt a `text-dusk-*` osztályt, amit a ténylegesen beágyazott
 * megosztott komponensek használnak. Ha valaha egy új `@acropora/ui`
 * komponens kerül be egy pilot oldalra egy MÁSIK `dusk-*` szövegszínnel,
 * ez az őrző NEM veszi észre -- az listát kézzel kell bővíteni, ugyanúgy,
 * ahogy ez a kör is kézzel derítette ki (lásd a fájl fejlécét).
 */
describe("figma-theme.css -- beágyazott közös komponensek sötét szövegszíne", () => {
  const css = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "packages",
      "ui",
      "src",
      "figma-theme.css",
    ),
    "utf8",
  );

  const usedByEmbeddedComponents = [
    // ConfirmDialog: title/consequence/recovery
    "dusk-900",
    "dusk-700",
    "dusk-500",
    // Button "secondary" variant
    "dusk-700",
    // Pagination oldalszám-felirat
    "dusk-600",
    // FormField felirata (CustomerPicker rajta keresztül)
    "dusk-800",
  ];

  it.each([...new Set(usedByEmbeddedComponents)])(
    'van [data-theme="dark"] felülírás a .text-%s osztályra',
    (shade) => {
      const pattern = new RegExp(
        `\\[data-theme="dark"\\]\\s*\\.text-${shade}\\s*\\{`,
      );
      expect(css).toMatch(pattern);
    },
  );

  it("a .bg-white felülírás is jelen van (ez viszi sötétbe a dobozokat)", () => {
    expect(css).toMatch(/\[data-theme="dark"\]\s*\.bg-white\s*\{/);
  });
});
