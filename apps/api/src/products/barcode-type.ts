import { validateGtin } from "@acropora/jev/product-enrichment";
import type { ProductBarcodeType } from "@acropora/database";

/**
 * A VONALKÓD TÍPUSA (SEO P0 PR 4, C3; döntések: D3, D4, acrobot 27695).
 *
 * A JEV `validateGtin` dönt (hossz, ellenőrző számjegy, bolti tartomány), nem egy
 * második ellenőrző: ugyanaz a kód sorolja be a vonalkódot, amelyik a JEV-ben a
 * GTIN-t elfogadja, tehát a kettő nem csúszhat el.
 *
 * - érvényes, termék-tartományú kód: a HOSSZA szerint EAN13, EAN8, UPCA, GTIN14;
 * - **a 13 jegyű UPC-A (vezető 0) EAN13 (D4)**: a tárolt alak dönt, mert a bolt
 *   mezőjét is a hossz választja ki (13 jegy `ean`), és a vezető nullás `gtin13`
 *   érvényes;
 * - **kiadvány-tartomány (977, 978, 979) INTERNAL (D3)**: érvényes GTIN, de a mért
 *   katalógusban generált kód, nem könyv (`medusa-barcode.policy.ts`);
 * - bolti tartomány (2x, 02, 04) INTERNAL: saját bolti szám;
 * - hibás ellenőrző számjegy vagy nem GTIN alakú kód INTERNAL. A stage-en ilyen
 *   ma nincs (0/763, 2026-10-07): az import már kiszűrte, de a POS-on felvett
 *   saját kód ide esik.
 */
export const KIADVANY_ELOTAGOK = ["977", "978", "979"] as const;

const GTIN_TIPUS = {
  "GTIN-8": "EAN8",
  "GTIN-12": "UPCA",
  "GTIN-13": "EAN13",
  "GTIN-14": "GTIN14",
} as const;

export function barcodeType(code: string): ProductBarcodeType {
  const v = validateGtin(code);
  if (!v.ok || v.restrictedCirculation) return "INTERNAL";
  if (v.kind === "GTIN-13" && KIADVANY_ELOTAGOK.some((e) => code.startsWith(e)))
    return "INTERNAL";
  return GTIN_TIPUS[v.kind];
}

/** Termék-GTIN-e (a vetítés csak ezt viszi a bolt `ean`/`upc` mezőjébe). */
export const isProductGtin = (type: ProductBarcodeType | null): boolean =>
  type !== null && type !== "INTERNAL";
