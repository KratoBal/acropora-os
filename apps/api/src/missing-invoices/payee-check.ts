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
 * HA ADÓSZÁM NINCS, A CÉG NEVE IS ELÉG (acrobot 25640, éles: a Magic Patterns
 * amerikai számláján „Bill to Acropora Kft. Budapest …” áll, adószám nélkül, és
 * NOT_COMPANY lett). A név szóhatáron, kis-nagybetű és ékezet nélkül:
 * „Acropora Kft”, „ACROPORA KFT.”, „Acropora Korlátolt Felelősségű Társaság”.
 * A puszta „Acropora” nem elég (az egy márkanév is, más cégek is használják).
 * A saját kimenő számláinkon a név eladóként áll; azokat a begyűjtő előbb
 * kiszűri, és az adószámunk miatt eddig is COMPANY-k voltak.
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
  if (pattern.test(content.replace(/[  ]/g, ""))) return "COMPANY";
  const words = ` ${plain(content)} `;
  return COMPANY_NAMES.some((name) => words.includes(` ${name} `))
    ? "COMPANY"
    : "NOT_COMPANY";
}

/** Kisbetű, ékezet nélkül, minden nem betű-szám jel helyén egy szóköz. */
function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A cég neve a rövid és a teljes cégforma-alakkal. */
const COMPANY_NAMES = [
  plain(ACROPORA_COMPANY.name),
  plain(
    ACROPORA_COMPANY.name.replace(
      /\bKft\.?$/i,
      "Korlátolt Felelősségű Társaság",
    ),
  ),
];
