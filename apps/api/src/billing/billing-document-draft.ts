import {
  billingEmailDelivery,
  computeBillingDocumentAmounts,
  getDocumentCapabilities,
  resolveInvoiceFormat,
  type BillingDocumentDraftInput,
  type BillingEmailStatus,
  type DecimalText,
  type InvoiceFormat,
} from "@acropora/types";

/**
 * A VÁZLAT NORMALIZÁLÁSA A TÁROLÁS ELŐTT, adatbázis nélkül.
 *
 * Itt dől el minden, amit a szerver a böngésző helyett eldönt (brief 15. és
 * 32. pont):
 *   - a formátum a típus képessége szerint (`resolveInvoiceFormat`): ahol
 *     nincs formátum, egy odaküldött érték HIBA, nem csendben elejtett mező;
 *   - az összegek a közös modullal, a kedvezmény külön negatív sorként;
 *   - a fizetési mezők csak ott maradnak, ahol a típus mutatja őket (a
 *     kiállításkor a szerver tölti ki, capability report 7.3);
 *   - az e-mail állapot a típus és a formátum szerint.
 */
export interface NormalizedBillingLine {
  id: string;
  kind: "ITEM" | "DISCOUNT";
  parentLineId: string | null;
  position: number;
  productId: string | null;
  variantId: string | null;
  description: string;
  quantity: DecimalText;
  unit: string | null;
  unitNet: DecimalText;
  vatRatePercent: DecimalText;
  discountPercent: DecimalText | null;
  netAmount: DecimalText;
  vatAmount: DecimalText;
  grossAmount: DecimalText;
  comment: string | null;
}

export interface NormalizedBillingDraft {
  documentType: BillingDocumentDraftInput["documentType"];
  invoiceFormat: InvoiceFormat | null;
  customerId: string;
  fulfillmentDate: Date | null;
  dueDate: Date | null;
  paymentMethod: string | null;
  currency: string;
  language: string;
  reference: string | null;
  note: string | null;
  sourceType: NonNullable<BillingDocumentDraftInput["sourceType"]>;
  sourceId: string | null;
  emailStatus: BillingEmailStatus;
  netAmount: DecimalText;
  vatAmount: DecimalText;
  grossAmount: DecimalText;
  lines: NormalizedBillingLine[];
}

export type BillingDraftError =
  | { code: "FORMAT"; message: string }
  | { code: "AMOUNT"; message: string; lineIndex: number; field: string };

const FIELD_LABELS: Record<string, string> = {
  quantity: "mennyiség",
  unitNet: "nettó egységár",
  vatRatePercent: "ÁFA-kulcs",
  discountPercent: "kedvezmény",
};

/** Üres szöveg -> `null`: a hiányt egyféle alak jelölje. */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function day(value: string | null | undefined): Date | null {
  const trimmed = text(value);
  return trimmed === null ? null : new Date(`${trimmed}T00:00:00.000Z`);
}

export function normalizeBillingDraft(
  input: BillingDocumentDraftInput,
  newId: () => string,
):
  | { ok: true; draft: NormalizedBillingDraft }
  | { ok: false; error: BillingDraftError } {
  const format = resolveInvoiceFormat(input.documentType, input.invoiceFormat);
  if (!format.ok)
    return {
      ok: false,
      error: {
        code: "FORMAT",
        message:
          format.error === "BILLING_FORMAT_REQUIRED"
            ? "Ennél a bizonylattípusnál a formátumot (papír vagy e-számla) meg kell adni."
            : "Ennél a bizonylattípusnál ez a formátum nem választható.",
      },
    };

  const amounts = computeBillingDocumentAmounts(
    input.lines.map((line) => ({
      quantity: line.quantity,
      unitNet: line.unitNet,
      vatRatePercent: line.vatRatePercent,
      discountPercent: line.discountPercent,
    })),
  );
  if (!amounts.ok)
    return {
      ok: false,
      error: {
        code: "AMOUNT",
        lineIndex: amounts.lineIndex,
        field: amounts.field,
        message: `A(z) ${amounts.lineIndex + 1}. tétel ${FIELD_LABELS[amounts.field]} mezője ${
          amounts.error === "BILLING_AMOUNT_TOO_PRECISE"
            ? "túl sok tizedesjegyet tartalmaz"
            : "nem érvényes szám"
        }.`,
      },
    };

  const lines: NormalizedBillingLine[] = [];
  input.lines.forEach((line, index) => {
    const computed = amounts.amounts.lines[index]!;
    const itemId = text(line.id) ?? newId();
    lines.push({
      id: itemId,
      kind: "ITEM",
      parentLineId: null,
      position: lines.length + 1,
      productId: text(line.productId),
      // a változat csak a termékhez tartozik: termék nélkül eldobjuk
      variantId: text(line.productId) ? text(line.variantId) : null,
      description: line.description.trim(),
      quantity: line.quantity.trim().replace(",", "."),
      unit: text(line.unit),
      unitNet: line.unitNet.trim().replace(",", "."),
      vatRatePercent: line.vatRatePercent.trim().replace(",", "."),
      discountPercent: computed.discount?.discountPercent ?? null,
      netAmount: computed.netAmount,
      vatAmount: computed.vatAmount,
      grossAmount: computed.grossAmount,
      comment: text(line.comment),
    });
    if (computed.discount)
      lines.push({
        id: newId(),
        kind: "DISCOUNT",
        parentLineId: itemId,
        position: lines.length + 1,
        productId: null,
        variantId: null,
        description: `Kedvezmény (${computed.discount.discountPercent.replace(/\.?0+$/, "")}%)`,
        quantity: "1",
        unit: null,
        unitNet: computed.discount.netAmount,
        vatRatePercent: line.vatRatePercent.trim().replace(",", "."),
        discountPercent: computed.discount.discountPercent,
        netAmount: computed.discount.netAmount,
        vatAmount: computed.discount.vatAmount,
        grossAmount: computed.discount.grossAmount,
        comment: null,
      });
  });

  const { showsPaymentFields } = getDocumentCapabilities(input.documentType);
  const delivery = billingEmailDelivery(input.documentType, format.format);

  return {
    ok: true,
    draft: {
      documentType: input.documentType,
      invoiceFormat: format.format,
      customerId: input.customerId,
      fulfillmentDate: day(input.fulfillmentDate),
      dueDate: showsPaymentFields ? day(input.dueDate) : null,
      paymentMethod: showsPaymentFields ? text(input.paymentMethod) : null,
      currency: input.currency.trim().toUpperCase(),
      language: input.language.trim().toLowerCase(),
      reference: text(input.reference),
      note: text(input.note),
      sourceType: input.sourceType ?? "MANUAL",
      sourceId: text(input.sourceId),
      emailStatus: delivery === "REQUIRED" ? "PENDING" : "NOT_REQUIRED",
      netAmount: amounts.amounts.totals.netAmount,
      vatAmount: amounts.amounts.totals.vatAmount,
      grossAmount: amounts.amounts.totals.grossAmount,
      lines,
    },
  };
}
