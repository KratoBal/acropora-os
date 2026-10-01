import { ACROPORA_COMPANY } from "@acropora/types";

import { PAGE_END_MARKER } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import type { Payee } from "./missing-invoice-matching.js";

/**
 * KINEK SZÓL A SZÁMLA (brief 4. pont, acrobot 25262/2): a szövegében szerepel-e
 * a cég adószámának törzsszáma. A mért adapterek kommentjei szerint a vevő
 * adószáma szövegként áll a számlán akkor is, ha a fejléc kép (Menzel,
 * Aquarioom), és a magánszemélyre szóló számlán (OpenAI) nincs adószám.
 *
 *   benne van          -> COMPANY
 *   van szöveg, nincs   -> NOT_COMPANY  (Nem a cégre szól: újra kell kérni)
 *   nincs szöveg (kép)  -> UNKNOWN      (a drawerben kézzel jelölendő)
 *
 * A törzsszámot számjegy-határon keressük: „HU23916229” és „23916229-2-13”
 * egyaránt talál, egy hosszabb számsor belseje nem.
 *
 * A `pdfTextLines` minden oldal után oldalvég-jelet ír, a beszkennelt,
 * szövegréteg nélküli PDF után is. A jel nem a számla szövege: ha csak az áll
 * benne, a számla képként jött, és UNKNOWN. (Mérve 2026-10-01, éles: egy
 * beszkennelt Sopro-számla feltöltése „Nem a cégre szól” lett, mert a jel
 * miatt a szöveg nem volt üres.)
 */
export function payeeFromText(text: string): Payee {
  const content = text
    .split("\n")
    .filter((line) => line.trim() !== PAGE_END_MARKER)
    .join("\n");
  if (!content.trim()) return "UNKNOWN";
  const pattern = new RegExp(
    `(?<!\\d)${ACROPORA_COMPANY.taxNumberBase}(?!\\d)`,
  );
  return pattern.test(content.replace(/[  ]/g, "")) ? "COMPANY" : "NOT_COMPANY";
}
