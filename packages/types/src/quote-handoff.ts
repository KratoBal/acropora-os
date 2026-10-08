/**
 * #1582 P6: STARTING A PROJECT FROM AN ACCEPTED QUOTE.
 *
 * The preview computes a plan, the execution recomputes it under the stock
 * locks and runs it only if it is still the same (`planHash`). The plan
 * carries no cost: nothing here needs `quotes.costs.view`.
 */

/** One hold the plan takes from one stock row (one warehouse today). */
export interface QuoteHandoffReservationDto {
  quoteBomItemId: string;
  stockItemId: string;
  variantId: string;
  warehouseId: string;
  warehouseName: string;
  /** decimal string */
  quantity: string;
}

/** One BOM line of the accepted items, and what the plan does with it. */
export interface QuoteHandoffLineDto {
  quoteBomItemId: string;
  kind: "PRODUCT" | "CUSTOM" | "SERVICE";
  name: string;
  variantId: string | null;
  unit: string;
  /** decimal strings */
  needed: string;
  /** PRODUCT: held from stock; CUSTOM and SERVICE: "0" */
  fromStock: string;
  /** goes to the project's material request; SERVICE: "0" */
  shortage: string;
}

/** A warehouse the preview drew from, or could; the user may leave one out. */
export interface QuoteHandoffWarehouseDto {
  id: string;
  name: string;
  excluded: boolean;
}

export interface QuoteHandoffPlanDto {
  quoteId: string;
  versionId: string;
  acceptanceId: string;
  /** the project's name: the quote's title */
  projectName: string;
  lines: QuoteHandoffLineDto[];
  reservations: QuoteHandoffReservationDto[];
  warehouses: QuoteHandoffWarehouseDto[];
  /** SHA-256 of the plan; the execution must send it back */
  planHash: string;
}

export interface QuoteHandoffPreviewInput {
  /** warehouses the holds must not come from */
  excludedWarehouseIds?: string[];
}

export interface ExecuteQuoteHandoffInput extends QuoteHandoffPreviewInput {
  planHash: string;
}

/** The started project, on the quote and as the execution's answer. */
export interface QuoteHandoffSummaryDto {
  projectId: string;
  projectNumber: string;
  projectName: string;
  executedAt: string;
  executedByName: string | null;
  /** the project's material request for the shortage, if there was one */
  materialRequestId: string | null;
  reservationCount: number;
}

export interface QuoteHandoffResultDto extends QuoteHandoffSummaryDto {
  /** true when the project already existed (a repeated request) */
  replayed: boolean;
}
