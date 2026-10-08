import { Prisma, type PrismaClient } from "@acropora/database";
import type {
  IncomingDocumentListItem,
  IncomingReadingField,
  IncomingReadingSource,
  IncomingReadingValues,
} from "@acropora/types";

import type { DocumentPairing } from "../missing-invoices/missing-invoices.service.js";
import { incomingKey } from "./billing-duplicates.js";

/**
 * A RÖGZÍTETT BESZERZÉSI SZÁMLA MINT BEJÖVŐ SZÁMLA (kártya 83f31a95, Balázs
 * 2026-10-08 10:58). Ha egy POSTED beszerzési számlát semmilyen más forrás
 * nem ismer (NAV, Számlázz.hu szamlabe, postafiók, Hiányzó számlák), a
 * Bejövő számlák listán saját sort kap „Beszerzésből” eredettel, a hozzá
 * csatolt kép a PDF-je, és „Ellenőrizendő”, amíg ember jóvá nem hagyja,
 * pontosan úgy, mint a postafiókos (külföldi) számla (#1588). Jóváhagyás után
 * `PURCHASE` forrású IncomingBillingDocument lesz belőle.
 *
 * „UGYANAZ A SZÁMLA” egy kulcson: a számlaszám és a szállító adószám-törzse
 * (ennek hiányában a neve), ahogy a duplikáció-ellenőrző (`incomingKey`) is
 * nézi. Más forrás ismeri, ha:
 *   - NAV-sor van hozzá kötve, vagy azonos kulcsú NAV-sor létezik;
 *   - azonos kulcsú IncomingBillingDocument van (Számlázz.hu vagy jóváhagyott
 *     postafiókos);
 *   - azonos kulcsú, NEM a saját képe beérkezett dokumentum van.
 */

export const PURCHASE_SOURCE = "PURCHASE";
export const PURCHASE_ITEM_PREFIX = "purchase:";
/**
 * A beszerzésből jött sor típuskódja. Nem a Számlázz.hu kódjai közül való
 * (SZ, ES, VS...), mert a begyűjtés azokat ismert számnak veszi.
 */
export const PURCHASE_KIND_CODE = "BE";

type Database = Pick<
  PrismaClient,
  | "purchaseInvoice"
  | "navIncomingInvoice"
  | "incomingBillingDocument"
  | "incomingSupplierDocument"
>;

/** Egy listára kerülő (még nem jóváhagyott) beszerzési számla. */
export interface PurchaseSubject {
  purchaseInvoiceId: string;
  supplierInvoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date | null;
  currency: string;
  exchangeRate: Prisma.Decimal | null;
  vatRate: Prisma.Decimal | null;
  isPaid: boolean;
  paidAt: Date | null;
  supplierName: string;
  supplierTaxNumber: string | null;
  /** EU-s beszállítónál a `taxNumber` a közösségi adószám */
  supplierIsForeign: boolean;
  net: Prisma.Decimal;
  /** a csatolt képek (a szkennelés PDF-et tárol), a legkorábbi elöl */
  scanIds: string[];
  scanReceivedAt: Date | null;
}

const lineNet = (line: {
  actualQuantity: Prisma.Decimal;
  unitNet: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
}) => {
  const gross = line.actualQuantity.times(line.unitNet);
  return line.discountPercent
    ? gross.times(
        new Prisma.Decimal(1).minus(line.discountPercent.dividedBy(100)),
      )
    : gross;
};

/** A beérkezett dokumentum olvasott kulcsa (`textReading`), ha van szám. */
const textKey = (reading: unknown): string | null => {
  const value = reading as {
    invoiceNumber?: unknown;
    supplierTaxNumber?: unknown;
    supplierName?: unknown;
  } | null;
  const text = (field: unknown) => (typeof field === "string" ? field : null);
  const number = text(value?.invoiceNumber);
  return number
    ? incomingKey(
        number,
        text(value?.supplierTaxNumber),
        text(value?.supplierName) ?? "",
      )
    : null;
};

/**
 * A listára kerülő beszerzési számlák: POSTED, még nincs jóváhagyott sora,
 * és más forrás nem ismeri. `only` megadásával egyetlen számlát néz (az
 * ellenőrző lap ugyanezen a feltételen megy, mint a lista).
 */
export async function loadPurchaseSubjects(
  database: Database,
  only?: string,
): Promise<PurchaseSubject[]> {
  const invoices = await database.purchaseInvoice.findMany({
    where: {
      status: "POSTED",
      navIncomingInvoice: { is: null },
      ...(only ? { id: only } : {}),
    },
    select: {
      id: true,
      supplierInvoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      currency: true,
      exchangeRate: true,
      vatRate: true,
      isPaid: true,
      paidAt: true,
      source: true,
      supplier: { select: { name: true, taxNumber: true } },
      lines: {
        select: { actualQuantity: true, unitNet: true, discountPercent: true },
      },
      scanDocuments: {
        select: { id: true, receivedAt: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!invoices.length) return [];

  const [nav, rows, documents] = await Promise.all([
    database.navIncomingInvoice.findMany({
      where: { invoiceOperation: "CREATE" },
      select: {
        navInvoiceNumber: true,
        supplierTaxNumber: true,
        supplierName: true,
      },
    }),
    database.incomingBillingDocument.findMany({
      select: {
        source: true,
        externalId: true,
        documentNumber: true,
        supplierTaxNumber: true,
        supplierEuTaxNumber: true,
        supplierName: true,
      },
    }),
    // a beérkezett, NEM beszerzéshez kötött dokumentumok olvasott kulcsa
    database.incomingSupplierDocument.findMany({
      where: { purchaseInvoiceId: null, textReading: { not: Prisma.DbNull } },
      select: { textReading: true },
    }),
  ]);

  const approved = new Set(
    rows
      .filter((row) => row.source === PURCHASE_SOURCE)
      .map((row) => row.externalId),
  );
  const known = new Set<string>();
  const add = (key: string | null) => key && known.add(key);
  for (const row of nav)
    add(
      incomingKey(
        row.navInvoiceNumber,
        row.supplierTaxNumber,
        row.supplierName,
      ),
    );
  for (const row of rows)
    if (row.source !== PURCHASE_SOURCE)
      add(
        incomingKey(
          row.documentNumber,
          row.supplierTaxNumber ?? row.supplierEuTaxNumber,
          row.supplierName,
        ),
      );
  for (const document of documents) add(textKey(document.textReading));

  return invoices
    .filter((invoice) => !approved.has(invoice.id))
    .filter((invoice) => {
      const key = incomingKey(
        invoice.supplierInvoiceNumber,
        invoice.supplier.taxNumber,
        invoice.supplier.name,
      );
      return !key || !known.has(key);
    })
    .map((invoice) => ({
      purchaseInvoiceId: invoice.id,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate,
      vatRate: invoice.vatRate,
      isPaid: invoice.isPaid,
      paidAt: invoice.paidAt,
      supplierName: invoice.supplier.name,
      supplierTaxNumber: invoice.supplier.taxNumber,
      supplierIsForeign: invoice.source === "EU",
      net: invoice.lines.reduce(
        (sum, line) => sum.plus(lineNet(line)),
        new Prisma.Decimal(0),
      ),
      scanIds: invoice.scanDocuments.map((scan) => scan.id),
      scanReceivedAt:
        invoice.scanDocuments[0]?.receivedAt ??
        invoice.scanDocuments[0]?.createdAt ??
        null,
    }));
}

const iso = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

/**
 * A BESZERZÉSBŐL KITÖLTÖTT OLVASAT: amit a rögzítés tud. A nettó a sorokból
 * (ahogy a beszerzés összesítője), az ÁFA a számla kulcsából, a bruttó a
 * kettő összege; kulcs nélkül (például fordított adózás) az ÁFA és a bruttó
 * üres, azt az ellenőrző tölti. A teljesítés napja nem rögzített adat.
 */
export function purchaseReading(subject: PurchaseSubject): {
  values: IncomingReadingValues;
  sources: Partial<Record<IncomingReadingField, IncomingReadingSource>>;
} {
  const net = subject.net.toDecimalPlaces(2);
  const vat = subject.vatRate
    ? net.times(subject.vatRate).dividedBy(100).toDecimalPlaces(2)
    : null;
  const values: IncomingReadingValues = {
    supplierName: subject.supplierName,
    supplierTaxNumber: subject.supplierIsForeign
      ? null
      : subject.supplierTaxNumber,
    supplierEuTaxNumber: subject.supplierIsForeign
      ? subject.supplierTaxNumber
      : null,
    documentNumber: subject.supplierInvoiceNumber,
    issueDate: iso(subject.invoiceDate),
    fulfillmentDate: null,
    dueDate: iso(subject.dueDate),
    currency: subject.currency,
    netAmount: net.toFixed(2),
    vatAmount: vat?.toFixed(2) ?? null,
    grossAmount: vat ? net.plus(vat).toFixed(2) : null,
  };
  const sources: Partial<Record<IncomingReadingField, IncomingReadingSource>> =
    {};
  for (const [field, value] of Object.entries(values))
    if (value !== null) sources[field as IncomingReadingField] = "PURCHASE";
  return { values, sources };
}

const decimals = (currency: string) =>
  currency.toUpperCase() === "HUF" ? 0 : 2;
const money = (value: Prisma.Decimal, currency: string) =>
  value.toFixed(decimals(currency));

/**
 * A beszerzésből jött, még ellenőrizendő sor a listán. A fizetés a banki
 * párosításból jön, ha a kép párosodott; különben a rögzítés saját
 * „fizetve” jelölése.
 */
export function purchaseListItem(
  subject: PurchaseSubject,
  pairings: ReadonlyMap<string, DocumentPairing>,
  reading?: IncomingReadingValues,
): IncomingDocumentListItem {
  const values = reading ?? purchaseReading(subject).values;
  const currency = values.currency ?? subject.currency;
  const amount = (value: string | null) =>
    value === null ? null : money(new Prisma.Decimal(value), currency);
  const pairing = subject.scanIds
    .map((id) => pairings.get(id))
    .find((found) => found !== undefined);
  const debits = pairing?.debits ?? [];
  const bankPaid = debits.length > 0 && pairing!.paidInFull;
  const gross = amount(values.grossAmount);
  return {
    id: `${PURCHASE_ITEM_PREFIX}${subject.purchaseInvoiceId}`,
    origin: "PURCHASE",
    review: "TO_REVIEW",
    documentNumber: values.documentNumber ?? subject.supplierInvoiceNumber,
    kindCode: PURCHASE_KIND_CODE,
    kindLabel: "Beszerzésből",
    invoiceFormat: null,
    cancelled: false,
    supplierName: values.supplierName ?? subject.supplierName,
    supplierTaxNumber:
      values.supplierTaxNumber ?? values.supplierEuTaxNumber ?? null,
    issueDate: values.issueDate ?? iso(subject.invoiceDate)!,
    fulfillmentDate: values.fulfillmentDate,
    dueDate: values.dueDate,
    paymentMethod: null,
    currency,
    exchangeRate: subject.exchangeRate?.toString() ?? null,
    netAmount: amount(values.netAmount),
    vatAmount: amount(values.vatAmount),
    grossAmount: gross,
    paymentState: bankPaid || subject.isPaid ? "PAID" : "UNPAID",
    paidAmount: bankPaid || subject.isPaid ? (gross ?? "0") : "0",
    lastPaymentDate: bankPaid
      ? debits.map((d) => d.bookingDate).reduce((a, b) => (a > b ? a : b))
      : iso(subject.paidAt),
    paymentSource: bankPaid ? "BANK_PAIRING" : null,
    paymentConflict: false,
    bankMatch: debits.length
      ? { state: "PAIRED", reason: null, debits }
      : { state: "UNPAIRED", reason: null, debits: [] },
    hasPdf: subject.scanIds.length > 0,
  };
}
