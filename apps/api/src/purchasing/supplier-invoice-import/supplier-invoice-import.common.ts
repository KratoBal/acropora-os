import type {
  SupplierInvoiceImportLine,
  SupplierInvoiceImportResult,
} from "@acropora/types";

/**
 * Pieces every reader shares: the unit names, the charge-line rule, the
 * tax-id shape and the plausibility checks. Nothing here knows a supplier;
 * a supplier-specific rule belongs in that supplier's adapter.
 */

/** UN/ECE Recommendation 20 unit codes, as CII and UBL carry them. */
const UNIT_LABELS: Record<string, string> = {
  C62: "db",
  H87: "db",
  EA: "db",
  PCE: "db",
  PR: "pár",
  SET: "szett",
  KGM: "kg",
  GRM: "g",
  LTR: "l",
  MLT: "ml",
  MTR: "m",
  CMT: "cm",
};

export function unitLabel(code: string | null | undefined): string {
  if (!code) return "db";
  return UNIT_LABELS[code.toUpperCase()] ?? code.toLowerCase();
}

/**
 * A freight, shipping or packaging line: an invoice line, but not goods. It
 * stays on the invoice (it is part of the total) and is never offered for
 * linking to a product.
 */
/*
 * BOVITVE 2026-09-29 (Balazs 11:49 UTC: a szabaly minden szallitora, acrobot
 * 24749: csak MERT alakok):
 *   - "(ki)szállítási díj/költség" -- a "Kiszállítási díj" eddig kimaradt, mert
 *     a szo KOZEPEN nincs szohatar; a "Szállítási költség" nem is szerepelt;
 *   - "postaköltség";
 *   - "delivery": a De Jong 19005741-es szamlajan egy kod nelkuli "Truck
 *     delivery" sor (5 050 EUR) eddig termek-javaslatot kert.
 * A magyar alakok csak a NAV-bol jovo belfoldi szamlakon fordulnak elo.
 */
const CHARGE_WORDS =
  /\b(fracht\w*|versand\w*|porto|shipping|freight|delivery|verpackung\w*|transport\w*|(?:ki)?szállítási (?:díj|költség)|postaköltség|fuvar\w*)\b/i;

export function isChargeDescription(description: string): boolean {
  return CHARGE_WORDS.test(description);
}

/** "DE 342 032 439" -> "DE342032439"; anything not shaped like a VAT id -> null. */
export function normalizeVatId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.replace(/[\s.-]/g, "").toUpperCase();
  return /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(compact) ? compact : null;
}

export function countryFromVatId(vatId: string | null): string | null {
  if (!vatId) return null;
  const prefix = vatId.slice(0, 2);
  // Greece's VAT prefix is EL, its ISO country code GR.
  return prefix === "EL" ? "GR" : prefix;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The net a line should total to from its own quantity, price and discount. */
export function expectedLineNet(line: SupplierInvoiceImportLine): number {
  return round2(
    line.quantity * line.unitNet * (1 - (line.discountPercent ?? 0) / 100),
  );
}

/**
 * The checks a person should see before saving: each line against its own
 * arithmetic, and the lines together against the invoice's net total. A
 * mismatch is a WARNING, not a refusal -- the invoice may round differently,
 * and the person has the paper in front of them.
 */
export function plausibilityWarnings(
  result: SupplierInvoiceImportResult,
): string[] {
  const warnings: string[] = [];
  for (const line of result.lines) {
    const expected = expectedLineNet(line);
    if (Math.abs(expected - line.lineNet) > 0.02)
      warnings.push(
        `${line.lineNumber}. sor: a mennyiség × egységár (${expected.toFixed(2)}) eltér a sor összegétől (${line.lineNet.toFixed(2)}).`,
      );
  }
  if (result.netTotal !== null) {
    const sum = round2(
      result.lines.reduce((acc, line) => acc + line.lineNet, 0),
    );
    if (Math.abs(sum - result.netTotal) > 0.02)
      warnings.push(
        `A sorok összege (${sum.toFixed(2)}) eltér a számla nettó végösszegétől (${result.netTotal.toFixed(2)}).`,
      );
  }
  return warnings;
}
