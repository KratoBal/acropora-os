import { ACROPORA_COMPANY } from "@acropora/types";

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
 */
export function payeeFromText(text: string): Payee {
  if (!text.trim()) return "UNKNOWN";
  const pattern = new RegExp(
    `(?<!\\d)${ACROPORA_COMPANY.taxNumberBase}(?!\\d)`,
  );
  return pattern.test(text.replace(/[  ]/g, "")) ? "COMPANY" : "NOT_COMPANY";
}
