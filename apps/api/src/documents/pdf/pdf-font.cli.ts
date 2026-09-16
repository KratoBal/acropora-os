import { statSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { PDF_FONT_FILENAME, resolvePdfFontPath } from "./pdf-font.js";

/**
 * A BEÁGYAZOTT BETŰ MEGVAN-E A TELEPÍTETT KÉPBEN -- egyetlen paranccsal.
 *
 * === MIÉRT KELL EGYÁLTALÁN, ÉS MIÉRT NEM AZ INDÍTÁSI ÚTON ===
 *
 * A `tsconfig` csak `src/**\/*.ts` fájlokat fordít, tehát a `.ttf` fájlt nem a
 * fordító viszi a `dist` mellé, hanem a csomag telepítése (`pnpm deploy --prod`).
 * Hogy ez a képben is így áll, azt a képen kell megmérni.
 *
 * NEM a bootstrapban, és ez acrobot kikötése (2026-09-16): ha az indulás dobná
 * el magát a hiányzó betűn, akkor az API NEM INDULNA EL egy olyan fájl miatt,
 * ami egyetlen mellékfunkciót szolgál ki. Egy hiányzó PDF-lap kellemetlen; egy
 * nem induló API üzemszünet. Ezt a cserét nem kötjük meg.
 *
 * === MIÉRT A VALÓDI FELOLDÓT HÍVJA, ÉS NEM EGY ÚTVONALAT ELLENŐRIZ ===
 *
 * Egy kézzel felírt útvonal-ellenőrzés a SAJÁT feltevését mérné: ha a feloldó
 * máshol keres, mint amit a CI-lépésbe beírtunk, a lépés zöldet adna egy olyan
 * képre, amiben a betű elérhetetlen. Ezért ugyanaz a függvény fut itt, ami az
 * éles úton is keresi a betűt.
 *
 * Használat (a képben, a belépési pontot megkerülve):
 *   docker run --rm --entrypoint node acropora-api:ci dist/documents/pdf/pdf-font.cli.js
 *
 * Megtalálva: kiírja a végleges utat és a méretet, és nullával lép ki.
 * Hiányzik:   a feloldó HANGOSAN áll meg, a végigpróbált utak felsorolásával,
 *             és a folyamat nem nullával lép ki -- ettől pirosodik a CI-lépés.
 */
export function reportPdfFontLocation(): string {
  const fontPath = resolvePdfFontPath();
  const { size } = statSync(fontPath);
  return `${PDF_FONT_FILENAME}: ${fontPath} (${size} bajt)`;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // A hiba szándékosan NEM elkapott: a feloldó üzenete (a végigpróbált utakkal)
  // a stderr-re megy, és a nem nulla kilépési kód buktatja a CI-lépést.
  console.log(reportPdfFontLocation());
}
