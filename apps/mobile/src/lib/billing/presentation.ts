import type { BillingDocumentKind } from "./paths";
import { formatMoney } from "../orders/presentation";
import type {
  BillingDocumentStatus,
  BillingDocumentType,
  BillingPaymentState,
  ExternalDocumentDetail,
  IncomingDocumentDetail,
  IncomingDocumentListItem,
  OutgoingDocumentListItem,
  OwnDocumentDetail,
} from "./types";

/**
 * A SZÁMLÁK MEGJELENÍTÉSE, TISZTA FÜGGVÉNYEKBEN: a képernyő ezekből rajzol, és itt dől el, mit lehet megnyitni. A
 * feliratok a web közös csomagjáéval azonosak (`packages/types`: billing-document.ts, billing-document-labels.ts,
 * billing-incoming.ts).
 */
export const DOCUMENT_TYPE_LABELS: Readonly<
  Record<BillingDocumentType, string>
> = {
  INVOICE: "Számla",
  PROFORMA: "Díjbekérő",
  ADVANCE_INVOICE: "Előlegszámla",
  DELIVERY_NOTE: "Szállítólevél",
  FINAL_INVOICE: "Végszámla",
};

export const DOCUMENT_STATUS_LABELS: Readonly<
  Record<BillingDocumentStatus, string>
> = {
  DRAFT: "Piszkozat",
  ISSUING: "Kiállítás alatt",
  ISSUED: "Kiállítva",
  ISSUE_FAILED: "Kiállítás sikertelen",
};

export const PAYMENT_STATE_LABELS: Readonly<
  Record<BillingPaymentState, string>
> = {
  PAID: "Fizetve",
  PARTIAL: "Részben fizetve",
  UNPAID: "Nincs fizetve",
  UNKNOWN: "Nincs adat",
};

export type Tone = "neutral" | "success" | "warning" | "danger";

/** `YYYY-MM-DD` -> `2026. 11. 03.`; hiányzó vagy rossz alakú dátumnál gondolatjel nélküli „nincs”. */
export function formatDay(value: string | null | undefined): string {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[1]}. ${match[2]}. ${match[3]}.` : "nincs";
}

/** Az összeg a pénznemmel; hiányzó összegnél „nincs összeg”. */
export function formatAmount(value: string | null, currency: string): string {
  return value === null ? "nincs összeg" : formatMoney(value, currency);
}

export interface ListRow {
  id: string;
  /** A sor címe: a bizonylatszám, vázlatnál a típus és a „piszkozat”. */
  title: string;
  /** A partner neve (kimenőn a vevő, bejövőn a szállító). */
  partner: string;
  /** A típus és a kelt, egy sorban. */
  meta: string;
  amount: string;
  badge: { label: string; tone: Tone };
  /** Hova nyit; `null`: telefonon nem nyitható, és `closedReason` mondja meg, miért. */
  opens: BillingDocumentKind | null;
  closedReason: string | null;
}

function paymentBadge(
  state: BillingPaymentState | null,
): { label: string; tone: Tone } | null {
  if (state === null) return null;
  return {
    label: PAYMENT_STATE_LABELS[state],
    tone:
      state === "PAID"
        ? "success"
        : state === "PARTIAL"
          ? "warning"
          : state === "UNPAID"
            ? "danger"
            : "neutral",
  };
}

/**
 * A KIMENŐ SOR. A vázlat (`opens: EDITOR`) a weben a szerkesztőbe nyit; telefonon szerkesztés nincs, ezért nem nyitható
 * (kimondva a sorban). A sztornózott számla jelzése a fizetési állapot elé kerül: az a fontosabb.
 */
export function outgoingRow(item: OutgoingDocumentListItem): ListRow {
  const type =
    item.externalKindLabel ?? DOCUMENT_TYPE_LABELS[item.documentType];
  const badge = item.cancelled
    ? { label: "Sztornózva", tone: "neutral" as const }
    : item.status !== "ISSUED"
      ? {
          label: DOCUMENT_STATUS_LABELS[item.status],
          tone:
            item.status === "ISSUE_FAILED"
              ? ("danger" as const)
              : ("neutral" as const),
        }
      : (paymentBadge(item.paymentState) ?? {
          label: DOCUMENT_STATUS_LABELS.ISSUED,
          tone: "neutral" as const,
        });
  const opens =
    item.opens === "DETAIL"
      ? "own"
      : item.opens === "EXTERNAL_DETAIL"
        ? "external"
        : null;
  return {
    id: item.id,
    title: item.documentNumber ?? `${type} (piszkozat)`,
    partner: item.customerName,
    meta: `${type} · ${formatDay(item.issueDate)}`,
    amount: formatAmount(item.grossAmount, item.currency),
    badge,
    opens,
    closedReason: opens ? null : "A piszkozat a weben szerkeszthető.",
  };
}

/**
 * A BEJÖVŐ SOR. A még ellenőrizendő postafiókos vagy beszerzési sornak nincs adatlapja: a weben is az ellenőrző lap
 * nyílik, ami írás, tehát telefonon nem nyitható.
 */
export function incomingRow(item: IncomingDocumentListItem): ListRow {
  const review = item.review === "TO_REVIEW";
  return {
    id: item.id,
    title: item.documentNumber,
    partner: item.supplierName || "név nélkül",
    meta: `${item.kindLabel} · ${formatDay(item.issueDate)}`,
    amount: formatAmount(item.grossAmount, item.currency),
    badge: item.cancelled
      ? { label: "Sztornózva", tone: "neutral" }
      : review
        ? { label: "Ellenőrizendő", tone: "warning" }
        : (paymentBadge(item.paymentState) ?? {
            label: "Nincs adat",
            tone: "neutral",
          }),
    opens: review ? null : "incoming",
    closedReason: review ? "Ellenőrzésre vár: a weben hagyható jóvá." : null,
  };
}

/** Az útvonal-paraméter értéke érvényes adatlap-fajta-e (a mélylinkből bármi jöhet). */
export function isDocumentKind(value: unknown): value is BillingDocumentKind {
  return value === "own" || value === "external" || value === "incoming";
}

export interface DetailLine {
  name: string;
  /** „3 db”, egység nélkül csak a szám. */
  quantity: string;
  gross: string;
}

/** Az adatlap egy alakban, akármelyik fajtából jön: a képernyő csak ezt rajzolja. */
export interface DetailView {
  title: string;
  typeLabel: string;
  badge: { label: string; tone: Tone } | null;
  /** „Vevő” a kimenőn, „Szállító” a bejövőn. */
  partnerLabel: string;
  partnerName: string;
  partnerTaxNumber: string | null;
  partnerAddress: string | null;
  facts: { label: string; value: string }[];
  lines: DetailLine[];
  totals: { label: string; value: string }[];
  pdfAvailable: boolean;
}

function quantityText(quantity: string, unit: string | null): string {
  const value = Number(quantity);
  const number = Number.isFinite(value)
    ? value.toLocaleString("hu-HU", { maximumFractionDigits: 3 })
    : quantity;
  return unit ? `${number} ${unit}` : number;
}

function totalsOf(
  amounts: { netAmount: string; vatAmount: string; grossAmount: string },
  currency: string,
) {
  return [
    { label: "Nettó", value: formatMoney(amounts.netAmount, currency) },
    { label: "ÁFA", value: formatMoney(amounts.vatAmount, currency) },
    { label: "Bruttó", value: formatMoney(amounts.grossAmount, currency) },
  ];
}

function factsOf(input: {
  issueDate?: string | null;
  fulfillmentDate: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
}) {
  return [
    { label: "Kelt", value: formatDay(input.issueDate) },
    { label: "Teljesítés", value: formatDay(input.fulfillmentDate) },
    { label: "Fizetési határidő", value: formatDay(input.dueDate) },
    { label: "Fizetési mód", value: input.paymentMethod ?? "nincs" },
  ];
}

export function ownDetailView(detail: OwnDocumentDetail): DetailView {
  return {
    title:
      detail.documentNumber ??
      `${DOCUMENT_TYPE_LABELS[detail.documentType]} (piszkozat)`,
    typeLabel: DOCUMENT_TYPE_LABELS[detail.documentType],
    badge: {
      label: DOCUMENT_STATUS_LABELS[detail.status],
      tone: detail.status === "ISSUE_FAILED" ? "danger" : "neutral",
    },
    partnerLabel: "Vevő",
    partnerName: detail.customer?.name ?? "nincs megadva",
    partnerTaxNumber: detail.customer?.taxNumber ?? null,
    partnerAddress: detail.customer?.address ?? null,
    facts: factsOf(detail),
    lines: detail.lines.map((line) => ({
      name:
        line.kind === "DISCOUNT"
          ? `Kedvezmény: ${line.description}`
          : line.description,
      quantity: quantityText(line.quantity, line.unit),
      gross: formatMoney(line.grossAmount, detail.currency),
    })),
    totals: totalsOf(detail.totals, detail.currency),
    pdfAvailable: detail.pdf?.available === true,
  };
}

export function externalDetailView(detail: ExternalDocumentDetail): DetailView {
  return {
    title: detail.documentNumber,
    typeLabel: detail.kindLabel,
    badge: detail.cancelled
      ? { label: "Sztornózva", tone: "neutral" }
      : paymentBadge(detail.paymentState),
    partnerLabel: "Vevő",
    partnerName: detail.customer.name || "név nélkül",
    partnerTaxNumber: detail.customer.taxNumber,
    partnerAddress: detail.customer.address,
    facts: factsOf(detail),
    lines: detail.lines.map((line) => ({
      name: line.name,
      quantity: quantityText(line.quantity, line.unit),
      gross: formatMoney(line.grossAmount, detail.currency),
    })),
    totals: totalsOf(detail.totals, detail.currency),
    pdfAvailable: detail.pdfAvailable,
  };
}

export function incomingDetailView(detail: IncomingDocumentDetail): DetailView {
  return {
    title: detail.documentNumber,
    typeLabel: detail.kindLabel,
    badge: detail.cancelled
      ? { label: "Sztornózva", tone: "neutral" }
      : paymentBadge(detail.paymentState),
    partnerLabel: "Szállító",
    partnerName: detail.supplier.name || "név nélkül",
    partnerTaxNumber: detail.supplier.taxNumber,
    partnerAddress: detail.supplier.address,
    facts: factsOf(detail),
    lines: detail.lines.map((line) => ({
      name: line.name,
      quantity: quantityText(line.quantity, line.unit),
      gross: formatMoney(line.grossAmount, detail.currency),
    })),
    totals: totalsOf(detail, detail.currency),
    pdfAvailable: detail.hasPdf,
  };
}
