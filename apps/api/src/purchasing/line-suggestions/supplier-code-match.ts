/**
 * THE SUPPLIER'S CODE IS OUR CODE: a deterministic suggestion, no Jev.
 *
 * Part of our catalogue SKUs (and manufacturer part numbers) were made from
 * the supplier's own article codes, so a code on the invoice line can name
 * the product outright. Measured on the De Jong archive (barracuda,
 * 2026-09-29, `exchange/a008-dejong/jelentes/parositasi-szabalyok.md`): 15 of
 * 1020 codes match a SKU or MPN letter for letter, 14 of them right. The
 * rules below are that report's, each one from a measured wrong match:
 *
 *   1. a brand prefix ("BRAND-") may be cut off only when what remains has a
 *      letter in it: a bare number is one of our livestock SKUs by accident
 *      (BLUELIFE-355 "Phos FX 250ml" -> our 355 is a cleaner wrasse);
 *   2. the pack size in the line's text must not contradict the product's
 *      name: a code match is not stronger than the name (XEPTA-1002 "1000ml"
 *      sits on our 500ml variant);
 *   3. a clearance, short-dated or used product is never a receiving target;
 *   and only ONE product may remain: a code that names two is no answer.
 */

export interface CodeCandidate {
  readonly variantId: string;
  readonly sku: string;
  readonly manufacturerPartNumber: string | null;
  /** Product name and variant name together, as the catalogue shows it. */
  readonly name: string;
}

/** The codes to look up for one invoice code: itself, and its tail (rule 1). */
export function codeLookupKeys(supplierSku: string): string[] {
  const code = supplierSku.trim();
  if (!code) return [];
  const keys = [code];
  const dash = code.indexOf("-");
  if (dash > 0) {
    const tail = code.slice(dash + 1);
    if (/[a-z]/i.test(tail)) keys.push(tail);
  }
  return keys;
}

const QUANTITY =
  /(\d+(?:[.,]\d+)?)\s*(ml|l|ltr|litre|liter|g|gr|kg)(?![a-z])/gi;

/** The pack sizes a text names, as millilitres or grams: "1 litre" -> "1000ml". */
export function packSizes(text: string): Set<string> {
  const sizes = new Set<string>();
  for (const [, amount, unit] of text.matchAll(QUANTITY)) {
    const value = Number(amount!.replace(",", "."));
    if (!Number.isFinite(value)) continue;
    const lower = unit!.toLowerCase();
    if (["ml"].includes(lower)) sizes.add(`${value}ml`);
    else if (["l", "ltr", "litre", "liter"].includes(lower))
      sizes.add(`${Math.round(value * 1000)}ml`);
    else if (["g", "gr"].includes(lower)) sizes.add(`${value}g`);
    else if (lower === "kg") sizes.add(`${Math.round(value * 1000)}g`);
  }
  return sizes;
}

const NOT_A_TARGET = /k[öo]zeli\s+lej[áa]rat|kiárus|kiarus|haszn[áa]lt/i;

/**
 * The one product the code names, or null. `candidates` are the catalogue
 * variants whose SKU or MPN equals one of `codeLookupKeys`.
 */
export function acceptCodeMatch<T extends CodeCandidate>(
  description: string,
  candidates: readonly T[],
): T | null {
  const lineSizes = packSizes(description);
  const kept = candidates.filter((candidate) => {
    if (NOT_A_TARGET.test(candidate.name)) return false;
    if (lineSizes.size === 0) return true;
    const own = packSizes(candidate.name);
    // no size on the product: nothing to contradict
    return own.size === 0 || [...own].some((size) => lineSizes.has(size));
  });
  const distinct = new Map(
    kept.map((candidate) => [candidate.variantId, candidate]),
  );
  return distinct.size === 1 ? [...distinct.values()][0]! : null;
}
