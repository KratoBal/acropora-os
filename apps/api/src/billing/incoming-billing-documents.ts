import { Prisma, type IncomingBillingDocument } from "@acropora/database";
import type {
  BillingPaymentSource,
  IncomingBankMatch,
  IncomingDocumentDetail,
  IncomingDocumentLine,
  IncomingDocumentListItem,
  IncomingDocumentListQuery,
  IncomingDocumentListResponse,
  IncomingPaymentState,
} from "@acropora/types";
import { paymentStateOf as sharedPaymentStateOf } from "@acropora/types";

import type { DocumentPairing } from "../missing-invoices/missing-invoices.service.js";
import { externalKindLabel } from "./billing-document-list.js";
import type {
  IncomingPayment,
  IncomingVatSummary,
} from "./incoming-szamlazz-invoice.js";

/**
 * A SZÁMLÁZÁS „BEJÖVŐ SZÁMLÁK” NÉZETE (Balázs újraterv-promptja, acrobot 25869):
 * a lista és az adatlap TISZTA FÜGGVÉNYEKKEL, a sorokból (IncomingBillingDocument)
 * és a Hiányzó számlák párosításából.
 *
 * A SZŰRÉS ÉS A LAPOZÁS MEMÓRIÁBAN FUT, nem az adatbázisban: a banki párosítás
 * számított, nem tárolt (a Hiányzó számlák számítása adja), tehát rá csak a
 * sorok után lehet szűrni. Élesen 2026-10-01-én 73 forrás-dokumentum áll; ha a
 * sorok száma egyszer ezres nagyságrendű lesz, a párosítás tárolása a lépés.
 */

const decimals = (currency: string) =>
  currency.toUpperCase() === "HUF" ? 0 : 2;
const money = (value: Prisma.Decimal, currency: string) =>
  value.toFixed(decimals(currency));
const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

/**
 * A KIFIZETÉSI ÁLLAPOT: a kimenő listával KÖZÖS számítás (`paymentStateOf` a
 * `@acropora/types`-ban; murena és nautilus, 2026-10-01). A tűrés forintnál 2 Ft
 * (az 5 forintos készpénz-kerekítés), devizánál fél cent, abszolút értékben.
 */
export function paymentStateOf(row: {
  paymentsKnown: boolean;
  paidAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  currency: string;
}): IncomingPaymentState {
  return sharedPaymentStateOf({
    paymentsKnown: row.paymentsKnown,
    paidAmount: row.paidAmount.toFixed(),
    grossAmount: row.grossAmount.toFixed(),
    currency: row.currency,
  });
}

/**
 * A BANKI PÁROSÍTÁS a Hiányzó számlák számításából, új logika nélkül. Nem
 * párosítandó CSAK két esetben (acrobot 25879): a számla nem a cégre szól, vagy
 * díjbekérő (a Számlázz.hu típusa D, vagy a párosító PROFORMA-nak olvasta).
 */
export function bankMatchOf(
  row: { sourceDocumentId: string | null; kindCode: string },
  pairings: ReadonlyMap<string, DocumentPairing>,
): IncomingBankMatch {
  const pairing = row.sourceDocumentId
    ? pairings.get(row.sourceDocumentId)
    : undefined;
  if (pairing?.payee === "NOT_COMPANY")
    return { state: "NOT_TO_PAIR", reason: "NOT_COMPANY", debits: [] };
  if (row.kindCode.toUpperCase() === "D" || pairing?.kind === "PROFORMA")
    return { state: "NOT_TO_PAIR", reason: "PROFORMA", debits: [] };
  if (pairing && pairing.debits.length > 0)
    return { state: "PAIRED", reason: null, debits: pairing.debits };
  return { state: "UNPAIRED", reason: null, debits: [] };
}

/**
 * A KIFIZETETTSÉG A FEEDBŐL ÉS A BANKI PÁROSÍTÁSBÓL (acrobot 25988; élesen
 * mérve: 79 bejövő számlából csak 14-nél küldött a Számlázz.hu kifizetést, az
 * átutalásos 29-ből 3-nál, tehát a banki párosítás érdemben hozzáad):
 *
 *   a Számlázz.hu küldött kifizetést   az nyer (SZAMLAZZ); ha részben fizetettet
 *                                      mond, de a számla banki terheléshez
 *                                      párosítva van, az eltérés jelölve
 *   nincs kifizetés, de párosítva      NÁLUNK fizetett (BANK_PAIRING): a bruttó,
 *                                      a legutolsó terhelés napjával
 *   egyik sem                          a feed állapota, forrás nélkül
 *
 * „Párosítva” CSAK akkor jelent teljes fizetést, ha minden párosított terhelés
 * Megvan vagy Eredeti hiányzik, összeg-eltérés nélkül (`paidInFull`; murena
 * lelete, 26014): az összeg-eltéréses, a kétszer fizetett és a sztornózott
 * vásárlás párosítása nem fizetettség. Ilyenkor a feed állapota marad.
 */
export function incomingPaymentOf(
  row: Pick<
    IncomingBillingDocument,
    | "paymentsKnown"
    | "paidAmount"
    | "grossAmount"
    | "currency"
    | "lastPaymentDate"
  >,
  bankMatch: IncomingBankMatch,
  /** A párosított terhelések a teljes számlát fizetik (`DocumentPairing.paidInFull`). */
  paidInFull: boolean,
): {
  paymentState: IncomingPaymentState;
  paidAmount: string;
  lastPaymentDate: string | null;
  paymentSource: BillingPaymentSource | null;
  paymentConflict: boolean;
} {
  const feed = paymentStateOf(row);
  const paired = bankMatch.state === "PAIRED" && paidInFull;
  if (row.paymentsKnown && !row.paidAmount.isZero())
    return {
      paymentState: feed,
      paidAmount: money(row.paidAmount, row.currency),
      lastPaymentDate: day(row.lastPaymentDate),
      paymentSource: "SZAMLAZZ",
      paymentConflict: paired && feed !== "PAID",
    };
  if (paired)
    return {
      paymentState: "PAID",
      paidAmount: money(row.grossAmount, row.currency),
      lastPaymentDate: bankMatch.debits
        .map((d) => d.bookingDate)
        .reduce((a, b) => (a > b ? a : b)),
      paymentSource: "BANK_PAIRING",
      paymentConflict: false,
    };
  return {
    paymentState: feed,
    paidAmount: money(row.paidAmount, row.currency),
    lastPaymentDate: day(row.lastPaymentDate),
    paymentSource: null,
    paymentConflict: false,
  };
}

export function toIncomingListItem(
  row: IncomingBillingDocument,
  pairings: ReadonlyMap<string, DocumentPairing>,
): IncomingDocumentListItem {
  const bankMatch = bankMatchOf(row, pairings);
  return {
    id: row.id,
    documentNumber: row.documentNumber,
    kindCode: row.kindCode,
    kindLabel: externalKindLabel(row.kindCode),
    invoiceFormat: row.electronic ? "ELECTRONIC" : "PAPER",
    cancelled: row.cancelled,
    supplierName: row.supplierName,
    supplierTaxNumber: row.supplierTaxNumber,
    issueDate: day(row.issueDate)!,
    fulfillmentDate: day(row.fulfillmentDate),
    dueDate: day(row.dueDate),
    paymentMethod: row.paymentMethod,
    currency: row.currency,
    exchangeRate: row.exchangeRate?.toString() ?? null,
    netAmount: money(row.netAmount, row.currency),
    vatAmount: money(row.vatAmount, row.currency),
    grossAmount: money(row.grossAmount, row.currency),
    ...incomingPaymentOf(
      row,
      bankMatch,
      (row.sourceDocumentId
        ? pairings.get(row.sourceDocumentId)?.paidInFull
        : undefined) ?? false,
    ),
    bankMatch,
    hasPdf: row.hasPdf,
  };
}

export function toIncomingDetail(
  row: IncomingBillingDocument,
  pairings: ReadonlyMap<string, DocumentPairing>,
): IncomingDocumentDetail {
  const payments = row.payments as unknown as IncomingPayment[];
  return {
    ...toIncomingListItem(row, pairings),
    exchangeBank: row.exchangeBank,
    supplier: {
      name: row.supplierName,
      address: row.supplierAddress,
      taxNumber: row.supplierTaxNumber,
      euTaxNumber: row.supplierEuTaxNumber,
      bankAccount: row.supplierBankAccount,
    },
    buyer: { name: row.buyerName, taxNumber: row.buyerTaxNumber },
    lines: row.lines as unknown as IncomingDocumentLine[],
    vatSummary: row.vatSummary as unknown as IncomingVatSummary[],
    paymentsKnown: row.paymentsKnown,
    payments: payments.map(({ date, title, amount, note }) => ({
      date,
      title,
      amount,
      note,
    })),
    note: row.note,
    orderNumber: row.orderNumber,
    referencedInvoiceNumber: row.referencedInvoiceNumber,
    referencedProformaNumber: row.referencedProformaNumber,
    versionCount: row.versionCount,
    receivedAt: row.feedReceivedAt.toISOString(),
  };
}

/**
 * A SZŰRŐ (a prompt 6. pontja): szállító (név vagy adószám), időszak a kelt vagy
 * a teljesítés szerint, kifizetési állapot, típus, pénznem, banki párosítás. A
 * sorrend: a legújabb kelt elöl, azon belül a számlaszám.
 */
export function filterIncoming(
  items: readonly IncomingDocumentListItem[],
  query: IncomingDocumentListQuery,
): IncomingDocumentListItem[] {
  const q = query.q?.trim().toLowerCase();
  const digits = q?.replace(/\D/g, "");
  return items
    .filter((item) => {
      if (q) {
        const name = item.supplierName.toLowerCase().includes(q);
        const tax =
          !!digits &&
          digits.length >= 3 &&
          (item.supplierTaxNumber ?? "").replace(/\D/g, "").includes(digits);
        if (!name && !tax) return false;
      }
      const date =
        query.dateBasis === "FULFILLMENT"
          ? item.fulfillmentDate
          : item.issueDate;
      if (query.from && (!date || date < query.from)) return false;
      if (query.to && (!date || date > query.to)) return false;
      if (query.paymentState && item.paymentState !== query.paymentState)
        return false;
      if (
        query.kindCode &&
        item.kindCode.toUpperCase() !== query.kindCode.toUpperCase()
      )
        return false;
      if (query.currency && item.currency !== query.currency.toUpperCase())
        return false;
      if (query.bankMatch && item.bankMatch.state !== query.bankMatch)
        return false;
      return true;
    })
    .sort(
      (a, b) =>
        b.issueDate.localeCompare(a.issueDate) ||
        a.documentNumber.localeCompare(b.documentNumber),
    );
}

export function incomingListResponse(
  all: readonly IncomingDocumentListItem[],
  query: IncomingDocumentListQuery & { page: number; pageSize: number },
): IncomingDocumentListResponse {
  const filtered = filterIncoming(all, query);
  const offset = (query.page - 1) * query.pageSize;
  const kinds = [...new Set(all.map((item) => item.kindCode))].sort();
  return {
    items: filtered.slice(offset, offset + query.pageSize),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems: filtered.length,
      totalPages: Math.ceil(filtered.length / query.pageSize),
    },
    facets: {
      kindCodes: kinds.map((code) => ({
        code,
        label: externalKindLabel(code),
      })),
      currencies: [...new Set(all.map((item) => item.currency))].sort(),
    },
  };
}
