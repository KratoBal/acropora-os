import type { GlsCodLineError, GlsCodResolutionSource } from "@acropora/types";

import { classifyCodReference, orderKeyOf } from "./gls-cod-reference.js";

/**
 * WHICH OUTGOING INVOICE A GLS COD LINE PAID. Local data only: no webshop
 * call (the webshop is frozen, acrobot 2026-09-29). What cannot be resolved
 * here goes to a person, with a suggestion where there is one.
 *
 * The order, per line:
 *   1. the COD reference itself: invoice number(s) that exist as outgoing
 *      invoices resolve the line;
 *   2. an order key, from the COD reference or else from the client
 *      reference of the GLS invoice attachment, through the local mirror
 *      (webshop order -> its invoices);
 *   3. otherwise review. The error names what the reference itself was, so a
 *      missing invoice is not reported as a missing order.
 */

export interface GlsResolutionLookups {
  /** Outgoing invoice numbers that exist. */
  readonly existingInvoiceNumbers: ReadonlySet<string>;
  /** Order key -> its invoice numbers; a key missing here has no order. */
  readonly orderInvoiceNumbers: ReadonlyMap<string, readonly string[]>;
}

export type GlsLineResolution =
  | {
      status: "RESOLVED";
      source: Exclude<GlsCodResolutionSource, "MANUAL">;
      invoiceNumbers: string[];
    }
  | {
      status: "NEEDS_REVIEW";
      errorCode: GlsCodLineError;
      suggestedInvoiceNumber: string | null;
    };

export function resolveGlsCodLine(
  line: { codReference: string | null; clientReference: string | null },
  lookups: GlsResolutionLookups,
): GlsLineResolution {
  const reference = classifyCodReference(line.codReference);
  let referenceError: GlsCodLineError | null = null;
  let suggestion: string | null = null;

  if (reference.kind === "INVOICES") {
    if (
      reference.invoiceNumbers.every((number) =>
        lookups.existingInvoiceNumbers.has(number),
      )
    )
      return {
        status: "RESOLVED",
        source: "INVOICE_NUMBER",
        invoiceNumbers: reference.invoiceNumbers,
      };
    referenceError = "INVOICE_NOT_FOUND";
    suggestion = reference.invoiceNumbers.join(", ");
  } else if (reference.kind === "BARE_INVOICE") {
    referenceError = "PREFIX_MISSING";
    suggestion = reference.suggestion;
  }

  const orderKey =
    reference.kind === "ORDER_KEY"
      ? reference.orderKey
      : orderKeyOf(line.clientReference);
  let orderError: GlsCodLineError | null = null;
  if (orderKey) {
    const invoices = lookups.orderInvoiceNumbers.get(orderKey);
    if (invoices && invoices.length > 0)
      return {
        status: "RESOLVED",
        source: "ORDER_KEY",
        invoiceNumbers: [...invoices],
      };
    orderError = invoices ? "ORDER_NOT_INVOICED" : "ORDER_NOT_FOUND";
  }

  return {
    status: "NEEDS_REVIEW",
    errorCode: referenceError ?? orderError ?? "REFERENCE_UNKNOWN",
    suggestedInvoiceNumber: suggestion,
  };
}
