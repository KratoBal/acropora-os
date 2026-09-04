import { webshopSellableFromUnas } from "./unas-product-sync.repository.js";

export interface SellableBackfillRow {
  id: string;
  webshopSellable: boolean;
  externalStatus: string | null;
  rawPayload: Record<string, unknown>;
}

export interface SellableBackfillSummary {
  inspected: number;
  updated: number;
  remainedFalse: number;
}

/** A már eltárolt UNAS nyers érték ugyanazt a flag-alakot követi, mint a kliens. */
function inquiryOnly(rawPayload: Record<string, unknown>): boolean {
  const value = rawPayload.Inquire;
  return value === true || value === 1 || value === "1";
}

/** A szabály egyetlen forrása a szinkronban is használt függvény. */
export function decideSellableBackfill(rows: readonly SellableBackfillRow[]) {
  return rows.map((row) => ({
    id: row.id,
    webshopSellable: webshopSellableFromUnas({
      externalStatus: row.externalStatus,
      inquireOnly: inquiryOnly(row.rawPayload),
    }),
  }));
}

export function summarizeSellableBackfill(
  rows: readonly SellableBackfillRow[],
): SellableBackfillSummary {
  const decisions = decideSellableBackfill(rows);
  return {
    inspected: rows.length,
    updated: decisions.filter(
      (decision, index) =>
        decision.webshopSellable !== rows[index]!.webshopSellable,
    ).length,
    remainedFalse: decisions.filter((decision) => !decision.webshopSellable)
      .length,
  };
}
