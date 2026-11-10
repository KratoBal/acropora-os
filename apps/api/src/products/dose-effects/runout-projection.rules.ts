import { runOutDays } from "@acropora/jev/product-enrichment";

/**
 * THE RUN-OUT REMINDER'S PRODUCT LIST FOR THE REEFCLUB ROLE (ReefClub V3.2, card cd94ed11, slice 4): the pure part. From the
 * accepted product knowledge facts, ONE ROW PER PRODUCT that the reminder can count, and nothing for the rest; the service
 * rebuilds the table with the dose list (`dose-projection.service.ts`), in the same transaction and run.
 *
 * A product is counted when, at the PRODUCT level (a variant's fact is not the product's pack):
 *   - it is ACTIVE (acrobot 45512: no reminder for what cannot be bought; the schema has no separate discontinued mark, and
 *     `webshopSellable` is not asked, because a pack bought in the shop counts too),
 *   - its `dosing` fact has a value (an accepted dose; a conflict is NULL and stays out),
 *   - its `packSize` fact has a value,
 *   - its `dosingMode`, when there is one, is FIXED (a test-dependent dose has no fixed ratio to count with),
 *   - and `runOutDays` accepts the pair (a millilitre dose against a pack of one number and one volume unit). It is asked for a
 *     100-litre aquarium only to check the pair: the member's own litres are counted at the reminder, not here.
 *
 * A fact whose status is SUGGESTED is not taken (acrobot 45512: a suggestion, not a fact); an accepted rule fact (AUTO_V1) is,
 * because Balázs's 2026-10-21 permission is exactly about accepting the manufacturer's dose by rule, and a wrong dose only moves
 * the reminder's day.
 *
 * Everything else is left out WITHOUT a guess: a product the member cannot get a correct reminder for gets no button.
 */
export const RUN_OUT_FACT_FIELDS = [
  "dosing",
  "packSize",
  "dosingMode",
] as const;

export interface RunOutFact {
  productId: string;
  productName: string;
  productActive: boolean;
  field: string;
  value: string | null;
  /** The JEV status the fact was accepted with (VERIFIED, SUGGESTED, CONFLICTING_SOURCES after a person's resolution). */
  status: string;
}

export interface RunOutProductRow {
  productId: string;
  productName: string;
  dose: string;
  packageText: string;
  packageMl: number;
}

export function toRunOutProducts(
  facts: readonly RunOutFact[],
): RunOutProductRow[] {
  const byProduct = new Map<
    string,
    { name: string; values: Map<string, string> }
  >();
  for (const fact of facts) {
    if (!fact.productActive) continue;
    if (fact.status === "SUGGESTED") continue;
    if (fact.value === null || fact.value.trim() === "") continue;
    const entry = byProduct.get(fact.productId) ?? {
      name: fact.productName,
      values: new Map<string, string>(),
    };
    entry.values.set(fact.field, fact.value);
    byProduct.set(fact.productId, entry);
  }
  const rows: RunOutProductRow[] = [];
  for (const [productId, { name, values }] of byProduct) {
    const dose = values.get("dosing");
    const packageText = values.get("packSize");
    const mode = values.get("dosingMode");
    if (!dose || !packageText) continue;
    if (mode !== undefined && mode !== "FIXED") continue;
    const counted = runOutDays({ dose, packageText, aquariumLitres: 100 });
    if (!counted.ok) continue;
    rows.push({
      productId,
      productName: name,
      dose,
      packageText,
      packageMl: counted.packageMl,
    });
  }
  return rows.sort((a, b) => a.productId.localeCompare(b.productId));
}
