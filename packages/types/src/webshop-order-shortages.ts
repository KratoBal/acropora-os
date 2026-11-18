/**
 * THE RECORD OF A STOCK SHORTAGE FOUND AFTER A WEBSHOP ORDER (card ac167fc2, task t-20261118-keszlethiany-rogzites).
 *
 * Balázs's rule gives the buyer three choices: split the order, replace the missing line, or drop it. The record keeps what was agreed:
 * it does NOT edit the order (the line edit and the split stay the way to change it) and it keys on the Medusa order id, because a
 * webshop order is not a SalesOrder (ADR-015).
 */
export const WEBSHOP_SHORTAGE_STATUSES = [
  "OPEN",
  "AGREED",
  "DONE",
  "WITHDRAWN",
] as const;
export type WebshopShortageStatus = (typeof WEBSHOP_SHORTAGE_STATUSES)[number];

export const WEBSHOP_SHORTAGE_CHOICES = ["SPLIT", "REPLACE", "REMOVE"] as const;
export type WebshopShortageChoice = (typeof WEBSHOP_SHORTAGE_CHOICES)[number];

export const WEBSHOP_SHORTAGE_CHANNELS = ["PHONE", "EMAIL", "OTHER"] as const;
export type WebshopShortageChannel = (typeof WEBSHOP_SHORTAGE_CHANNELS)[number];

export interface WebshopOrderShortageLineView {
  id: string;
  /** The Medusa order item. */
  itemId: string;
  /** A snapshot at the time of the record: the line may change or disappear later. */
  sku: string | null;
  title: string;
  /** The quantity the buyer originally ordered (the server reads it from the order). */
  orderedQuantity: number;
  /** The quantity actually in stock, when known. */
  availableQuantity: number | null;
  /**
   * The quantity the buyer accepts to get NOW in this order. The rest (ordered minus agreed) goes to a linked order (SPLIT), to the
   * replacement variant (REPLACE) or is dropped (REMOVE). Null until the agreement is recorded.
   */
  agreedQuantity: number | null;
  replacementVariantId: string | null;
  replacementSku: string | null;
}

export interface WebshopOrderShortageView {
  id: string;
  orderId: string;
  status: WebshopShortageStatus;
  choice: WebshopShortageChoice | null;
  channel: WebshopShortageChannel | null;
  agreedAt: string | null;
  agreementNote: string | null;
  /** The new, linked order a SPLIT created. */
  splitOrderId: string | null;
  resolutionNote: string | null;
  detectedAt: string;
  detectedByUserId: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  lines: WebshopOrderShortageLineView[];
}

export interface WebshopOrderShortageOpenInput {
  lines: { itemId: string; availableQuantity?: number }[];
}

export interface WebshopOrderShortageAgreementInput {
  choice: WebshopShortageChoice;
  channel: WebshopShortageChannel;
  /** ISO time; the moment of the recording when absent. */
  agreedAt?: string;
  /** What was said: required, the point of the record. */
  note: string;
  lines: {
    itemId: string;
    agreedQuantity: number;
    replacementVariantId?: string;
    replacementSku?: string;
  }[];
}

export interface WebshopOrderShortageResolveInput {
  outcome: "done" | "withdrawn";
  /** Required when the choice was SPLIT and the outcome is done. */
  splitOrderId?: string;
  /** Required when the outcome is withdrawn. */
  note?: string;
}
