import { Prisma } from "@acropora/database";
import {
  szamlazzDocumentTotals,
  type BillingDocumentListItem,
  type BillingDocumentListQuery,
  type BillingDocumentStatus,
  type BillingDocumentType,
  type BillingEmailStatus,
  type InvoiceFormat,
} from "@acropora/types";

import { szamlazzAmountsOfLine } from "./billing-document-issue.js";
import type { BillingDocumentListRow } from "./billing-document-list.repository.js";
import { OWN_ROWS } from "./billing-documents.repository.js";

/**
 * A BIZONYLATLISTA (Számlázás v0.1; szerződés:
 * agents/nautilus/megosztas/szamlazas-kiallitas-lista-reszletek-vegpontok.md).
 *
 * A HATÓKÖR PONTOSAN A RÉSZLETEKÉ (`OWN_ROWS`, murena repository-ja): ami a
 * listán áll, azt a részletek meg is nyitják. A karbantartási számla és a
 * bejövő vagy tükör-sor nem kerül ide, mert a részletek 404-et adnának rá.
 *
 * TISZTA FÜGGVÉNYEK: a szűrő, a rendezés és a sor-leképezés; a repository csak
 * lefuttatja őket. A `select` a repository-ban áll, a hívás mellett: a
 * select-mezők őrzője (`unas-prisma-select-mezok.spec.ts`) csak ott látja.
 */

export function listWhere(
  query: BillingDocumentListQuery,
): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = { ...OWN_ROWS };
  if (query.documentType) where.documentType = query.documentType;
  if (query.invoiceFormat) where.invoiceFormat = query.invoiceFormat;
  if (query.status) where.status = query.status;
  if (query.emailStatus) where.emailStatus = query.emailStatus;
  const q = query.q?.trim();
  if (q) {
    const contains = { contains: q, mode: "insensitive" as const };
    // A vevő nevét úgy keressük, ahogy a lista mutatja: kiállított sornál a
    // pillanatkép nevét (partnerName), minden sornál a partner mai nevét. A
    // vázlat partnerName-je a legutóbbi mentéskori név, amit a lista már nem
    // mutat, ezért arra NEM keresünk (a CI integrációs futása fogta meg).
    where.OR = [
      { invoiceNumber: contains },
      { status: "ISSUED", partnerName: contains },
      { customer: { is: { companyName: contains } } },
      { customer: { is: { displayName: contains } } },
      { reference: contains },
      { id: contains },
    ];
  }
  return where;
}

/**
 * A LEGÚJABB ELÖL. A szerződés a kiállítás napját, vázlatnál a létrehozást
 * kéri; a Prisma egy oszlopra rendez, nem kettő közül az elsőre, ezért a
 * vázlatok (kiállítás napja nélkül) állnak felül, alattuk a kiállítottak a
 * kiállítás szerint csökkenően. Az `id` a döntetlent bontja, hogy a lapozás
 * ne ugráljon.
 */
export const LIST_ORDER_BY = [
  { issueDate: { sort: "desc", nulls: "first" } },
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.InvoiceOrderByWithRelationInput[];

const BUDAPEST_DAY = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Budapest",
});

/** A kiállítás pillanata időbélyeg; a nap a budapesti naptári nap. */
export const budapestDay = (value: Date | null) =>
  value ? BUDAPEST_DAY.format(value) : null;
/** A határidő naptári nap, UTC éjfélként tárolva. */
const calendarDay = (value: Date | null) =>
  value?.toISOString().slice(0, 10) ?? null;

/**
 * A BRUTTÓ, AHOGY A SZÁMLÁN ÁLL. Kiállított sornál a Számlázz.hu válaszából
 * tárolt végösszeg; minden más állapotban a tételekből, a #1275 szabályával
 * számolva, tehát a lista már vázlatnál is azt mutatja, amit a számla ki fog
 * írni. Ha egy vázlat-tétel nem számolható (hiányos még), a tárolt összeg áll.
 */
function listGross(row: BillingDocumentListRow): string {
  const decimals = row.currency.toUpperCase() === "HUF" ? 0 : 2;
  const stored = (row.grossAmount ?? new Prisma.Decimal(0)).toFixed(decimals);
  if (row.status === "ISSUED") return stored;
  const lines = [];
  for (const line of row.lines) {
    const amounts = szamlazzAmountsOfLine(line, row.currency);
    if (!amounts.ok) return stored;
    lines.push(amounts);
  }
  return szamlazzDocumentTotals(lines, row.currency).grossAmount;
}

function customerName(row: BillingDocumentListRow): string {
  // Kiállított sornál a kiállítás a pillanatkép nevét írta a partnerName-be;
  // minden más állapotban a partner mai neve áll, ahogy a részletek is.
  if (row.status === "ISSUED" || !row.customer) return row.partnerName;
  return (
    row.customer.companyName?.trim() ||
    row.customer.displayName ||
    row.partnerName
  );
}

export function toListItem(
  row: BillingDocumentListRow,
): BillingDocumentListItem {
  const status = row.status as BillingDocumentStatus;
  return {
    id: row.id,
    documentType: row.documentType as BillingDocumentType,
    invoiceFormat: (row.invoiceFormat as InvoiceFormat | null) ?? null,
    documentNumber: row.invoiceNumber,
    customerName: customerName(row),
    issueDate: budapestDay(row.issueDate),
    dueDate: calendarDay(row.dueDate),
    grossAmount: listGross(row),
    currency: row.currency,
    status,
    emailStatus: (row.emailStatus as BillingEmailStatus | null) ?? null,
    opens: status === "DRAFT" ? "EDITOR" : "DETAIL",
  };
}
