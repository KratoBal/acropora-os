import type { ParsedPriceEntry } from "./price-list.types.js";
import { normalizeGtin } from "./gtin.js";

/**
 * A BESZÁLLÍTÓI ÁRLISTA SOROINAK TERMÉKPÁROSÍTÁSA, az automatikus rész (task
 * beszallitoi-arlistak-2; terv: agents/murena/atadas/beszallitoi-arlistak-terv-
 * 2026-10-23.md, 4. pont). Tiszta függvény: a lekérdezett adatot kapja, és
 * döntést ad vissza, semmit nem ír.
 *
 * Soronként, ebben a sorrendben:
 *   1. már van `SupplierPriceMatch` (APPROVED vagy AUTO): marad, SOHA nem döntjük újra;
 *   2. a sor vonalkódja (GTIN-14) pontosan EGY termék vonalkódjára illik: új AUTO kötés (EAN);
 *   3. a beszállítói cikkszám már ismert (`SupplierProduct`, csak olvassuk): új AUTO kötés (SUPPLIER_CODE);
 *   4. ha a vonalkód TÖBB termékre mutat, vagy a vonalkód és a cikkszám KÉT különböző
 *      terméket mond: ütközés, nincs kötés, ember dönt;
 *   5. különben nincs kötés (a név-alapú javaslat külön lépés).
 *
 * Egy korábban ELUTASÍTOTT kötés (REJECTED) ugyanarra a termékre nem jön vissza;
 * másik termékre új javaslat írhatja felül.
 */

export type MatchStatus = "AUTO" | "APPROVED" | "REJECTED";
export type MatchMethod = "EAN" | "SUPPLIER_CODE" | "NAME";

export interface ExistingMatch {
  variantId: string;
  status: MatchStatus;
}

export type MatchDecision =
  | { kind: "KEEP"; supplierSku: string; variantId: string }
  | {
      kind: "NEW_AUTO";
      supplierSku: string;
      variantId: string;
      method: "EAN" | "SUPPLIER_CODE";
      /** Igaz, ha egy ELUTASÍTOTT sort ír felül (másik termékre). */
      replacesRejected: boolean;
    }
  | {
      kind: "CONFLICT";
      supplierSku: string;
      reason: "EAN_MANY" | "EAN_VS_CODE";
    }
  | { kind: "UNMATCHED"; supplierSku: string };

export interface MatchingInput {
  entries: readonly ParsedPriceEntry[];
  /** GTIN-14 -> a termékek (változatok), amelyeknek ilyen vonalkódjuk van. */
  variantsByGtin: ReadonlyMap<string, ReadonlySet<string>>;
  /** beszállítói cikkszám -> a már rögzített kötés. */
  existing: ReadonlyMap<string, ExistingMatch>;
  /** beszállítói cikkszám -> a `SupplierProduct` változata (csak olvasva). */
  knownCodes: ReadonlyMap<string, string>;
}

export function decideMatches(input: MatchingInput): MatchDecision[] {
  return input.entries.map((entry): MatchDecision => {
    const sku = entry.supplierSku;
    const existing = input.existing.get(sku);
    if (existing && existing.status !== "REJECTED")
      return { kind: "KEEP", supplierSku: sku, variantId: existing.variantId };
    const rejected =
      existing?.status === "REJECTED" ? existing.variantId : null;

    const byEan = entry.gtin
      ? (input.variantsByGtin.get(entry.gtin) ?? new Set<string>())
      : new Set<string>();
    if (byEan.size > 1)
      return { kind: "CONFLICT", supplierSku: sku, reason: "EAN_MANY" };
    const eanVariant = byEan.size === 1 ? [...byEan][0]! : null;
    const codeVariant = input.knownCodes.get(sku) ?? null;
    if (eanVariant && codeVariant && eanVariant !== codeVariant)
      return { kind: "CONFLICT", supplierSku: sku, reason: "EAN_VS_CODE" };

    const variantId = eanVariant ?? codeVariant;
    if (!variantId || variantId === rejected)
      return { kind: "UNMATCHED", supplierSku: sku };
    return {
      kind: "NEW_AUTO",
      supplierSku: sku,
      variantId,
      method: eanVariant ? "EAN" : "SUPPLIER_CODE",
      replacesRejected: rejected !== null,
    };
  });
}

/**
 * A kódok, amelyekre a `ProductBarcode.code` oszlopot lekérdezzük egy GTIN-14
 * esetén: a tárolt vonalkód lehet EAN-13, UPC-A (12), EAN-8 vagy a teljes 14
 * jegyű alak, vezető nullákkal vagy nélkül. Csak az az alak jön, amely a 14
 * jegyből ZÉRÓK elhagyásával áll elő, és valódi GS1 hosszú.
 */
export function barcodeQueryCodes(gtin14: string): string[] {
  const codes = [gtin14];
  for (const length of [13, 12, 8]) {
    const dropped = gtin14.length - length;
    if (gtin14.slice(0, dropped) === "0".repeat(dropped))
      codes.push(gtin14.slice(dropped));
  }
  return codes;
}

/** A lekérdezett vonalkódok -> GTIN-14 szerinti változat-halmaz (hibás alakú tárolt vonalkód kimarad). */
export function groupVariantsByGtin(
  barcodes: readonly { code: string; variantId: string }[],
): Map<string, Set<string>> {
  const byGtin = new Map<string, Set<string>>();
  for (const { code, variantId } of barcodes) {
    const gtin = normalizeGtin(code);
    if (!gtin) continue;
    byGtin.set(gtin, (byGtin.get(gtin) ?? new Set()).add(variantId));
  }
  return byGtin;
}

export interface MatchingTally {
  alreadyMatched: number;
  autoByEan: number;
  autoByCode: number;
  conflicts: number;
  unmatched: number;
}

export function tallyDecisions(
  decisions: readonly MatchDecision[],
): MatchingTally {
  const tally: MatchingTally = {
    alreadyMatched: 0,
    autoByEan: 0,
    autoByCode: 0,
    conflicts: 0,
    unmatched: 0,
  };
  for (const decision of decisions) {
    if (decision.kind === "KEEP") tally.alreadyMatched += 1;
    else if (decision.kind === "NEW_AUTO")
      decision.method === "EAN"
        ? (tally.autoByEan += 1)
        : (tally.autoByCode += 1);
    else if (decision.kind === "CONFLICT") tally.conflicts += 1;
    else tally.unmatched += 1;
  }
  return tally;
}
