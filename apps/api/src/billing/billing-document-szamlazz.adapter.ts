import {
  getDocumentCapabilities,
  resolveInvoiceFormat,
  type BillingDocumentType,
  type InvoiceFormat,
} from "@acropora/types";

import {
  SZAMLAZZ_INVOICE_LANGUAGES,
  type SzamlazzAgentInvoiceInput,
  type SzamlazzInvoiceLanguage,
} from "../integrations/szamlazz/szamlazz-agent-xml.js";

/**
 * A BILLING DOKUMENTUM -> SZÁMLÁZZ.HU KÉRÉS (Számlázás v0.1, capability report
 * 6.3 pont; brief 31. pont).
 *
 * A négy típus UGYANAZ az `xmlszamla` kérés, ugyanazzal a klienssel: a típus
 * csak a `fejlec` jelzőjét és a kötelező mezők kitöltését változtatja. Ezért ez
 * nem négy adapter, hanem egy leképezés, és a React oldal semmit nem tud róla.
 *
 * AMIT A LEKÉPEZÉS NEM SZÁMOL: az összegeket. A sorok a TÁROLT összegeikkel
 * mennek (a szerver már újraszámolta őket), mert a Számlázz.hu tételenként
 * ellenőrzi az azonosságot (nettó egységár × mennyiség = nettó érték, nettó +
 * ÁFA = bruttó), és a kerekítés szabálya külön döntés.
 */

export interface BillingDocumentLineForIssue {
  position: number;
  kind: "ITEM" | "DISCOUNT";
  /** DISCOUNT sornál: a tétel pozíciója, amely alatt áll. */
  parentPosition: number | null;
  description: string;
  /** A tétel azonosítója a Számlázz.hu-n (`azonosito`), ha van. */
  code: string | null;
  quantity: number;
  unit: string;
  unitNet: number;
  /** A Számlázz.hu `afakulcs` alakja: "27", "5", "0", "AAM", "TAM"... */
  vatRate: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  comment: string | null;
}

export interface BillingDocumentForIssue {
  /** A mi azonosítónk: `szamlaKulsoAzon`. */
  id: string;
  documentType: BillingDocumentType;
  invoiceFormat: InvoiceFormat | null;
  /** yyyy-MM-dd */
  fulfillmentDate: string;
  dueDate: string | null;
  paymentMethod: string | null;
  currency: string;
  language: string | null;
  note: string | null;
  reference: string | null;
  /** A díjbekérő Számlázz.hu-s száma, ha ebből készül. */
  proformaNumber: string | null;
  buyer: {
    name: string;
    country: string | null;
    zip: string;
    city: string;
    address: string;
    email: string | null;
    taxNumber: string | null;
    /** the community (EU) tax number, for `<adoszamEU>` */
    euTaxNumber: string | null;
  };
  lines: readonly BillingDocumentLineForIssue[];
}

export class BillingDocumentAdapterError extends Error {
  constructor(
    readonly code:
      | "BILLING_FORMAT_REQUIRED"
      | "BILLING_FORMAT_NOT_SUPPORTED"
      | "BILLING_PAYMENT_TERMS_REQUIRED"
      | "BILLING_LANGUAGE_NOT_SUPPORTED"
      | "BILLING_NO_LINES"
      | "BILLING_DISCOUNT_WITHOUT_ITEM",
  ) {
    super(code);
    this.name = "BillingDocumentAdapterError";
  }
}

/**
 * A SZÁLLÍTÓLEVÉL FIZETÉSI MEZŐI. Az XSD mindegyik típusnál kötelezőnek jelöli
 * a határidőt és a fizetési módot (104-108. sor), a szállítólevél felülete
 * viszont nem kéri be őket. acrobot döntése a capability report 7.3 pontjára
 * (2026-09-30): a szerver tölti ki. A határidő a teljesítés napja, a mód egy
 * semleges szöveg; egyik sem állít fizetési feltételt, mert a szállítólevél
 * nem fizetendő bizonylat.
 */
const DELIVERY_NOTE_PAYMENT_METHOD = "Átutalás";

function isLanguage(value: string): value is SzamlazzInvoiceLanguage {
  return (SZAMLAZZ_INVOICE_LANGUAGES as readonly string[]).includes(value);
}

/**
 * A sorok a bizonylat sorrendjében, minden kedvezmény-sor KÖZVETLENÜL a
 * tétele alatt (Balázs döntése, 2026-09-30, message_id 1554830166734143498).
 * Egy tétel nélküli kedvezmény-sor hiba, nem csendben átrendezett sor.
 */
function orderedLines(
  lines: readonly BillingDocumentLineForIssue[],
): BillingDocumentLineForIssue[] {
  const items = lines
    .filter((line) => line.kind === "ITEM")
    .sort((a, b) => a.position - b.position);
  const itemPositions = new Set(items.map((line) => line.position));
  const discounts = lines.filter((line) => line.kind === "DISCOUNT");
  if (
    discounts.some(
      (line) =>
        line.parentPosition === null || !itemPositions.has(line.parentPosition),
    )
  )
    throw new BillingDocumentAdapterError("BILLING_DISCOUNT_WITHOUT_ITEM");
  return items.flatMap((item) => [
    item,
    ...discounts
      .filter((line) => line.parentPosition === item.position)
      .sort((a, b) => a.position - b.position),
  ]);
}

export function toSzamlazzAgentInput(
  document: BillingDocumentForIssue,
  options: { agentKey: string; previewOnly: boolean },
): SzamlazzAgentInvoiceInput {
  const format = resolveInvoiceFormat(
    document.documentType,
    document.invoiceFormat,
  );
  if (!format.ok) throw new BillingDocumentAdapterError(format.error);
  if (document.lines.length === 0)
    throw new BillingDocumentAdapterError("BILLING_NO_LINES");

  const language = document.language ?? "hu";
  if (!isLanguage(language))
    throw new BillingDocumentAdapterError("BILLING_LANGUAGE_NOT_SUPPORTED");

  const { showsPaymentFields } = getDocumentCapabilities(document.documentType);
  const dueDate = showsPaymentFields
    ? document.dueDate
    : (document.dueDate ?? document.fulfillmentDate);
  const paymentMethod = showsPaymentFields
    ? document.paymentMethod
    : (document.paymentMethod ?? DELIVERY_NOTE_PAYMENT_METHOD);
  if (!dueDate || !paymentMethod?.trim())
    throw new BillingDocumentAdapterError("BILLING_PAYMENT_TERMS_REQUIRED");

  return {
    agentKey: options.agentKey,
    previewOnly: options.previewOnly,
    documentType: document.documentType,
    // a formátum nélküli típusnál a kötelező `eszamla` semleges értéke
    electronic: format.format === "ELECTRONIC",
    externalId: document.id,
    language,
    fulfillmentDate: document.fulfillmentDate,
    paymentDueDate: dueDate,
    paymentMethod: paymentMethod.trim(),
    currency: document.currency,
    ...(document.note ? { comment: document.note } : {}),
    ...(document.reference ? { orderNumber: document.reference } : {}),
    ...(document.proformaNumber
      ? { proformaNumber: document.proformaNumber }
      : {}),
    seller: {},
    buyer: {
      name: document.buyer.name,
      ...(document.buyer.country ? { country: document.buyer.country } : {}),
      zip: document.buyer.zip,
      city: document.buyer.city,
      address: document.buyer.address,
      ...(document.buyer.email ? { email: document.buyer.email } : {}),
      ...(document.buyer.taxNumber
        ? { taxNumber: document.buyer.taxNumber }
        : {}),
      ...(document.buyer.euTaxNumber
        ? { euTaxNumber: document.buyer.euTaxNumber }
        : {}),
    },
    items: orderedLines(document.lines).map((line) => ({
      name: line.description,
      ...(line.code ? { externalId: line.code } : {}),
      quantity: line.quantity,
      unit: line.unit,
      netUnitPrice: line.unitNet,
      vatRatePercent: line.vatRate,
      netAmount: line.netAmount,
      vatAmount: line.vatAmount,
      grossAmount: line.grossAmount,
      // a tételszintű megjegyzés nem veszhet el (brief 14. és 32. pont)
      ...(line.comment ? { comment: line.comment } : {}),
    })),
  };
}
