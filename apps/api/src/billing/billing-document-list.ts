import { Prisma } from "@acropora/database";
import {
  szamlazzDocumentTotals,
  outgoingMissingPayments,
  paymentStateOf,
  type BillingDocumentListItem,
  type BillingDocumentListQuery,
  type BillingDocumentStatus,
  type BillingDocumentType,
  type BillingEmailStatus,
  type InvoiceFormat,
} from "@acropora/types";

import { szamlazzAmountsOfLine } from "./billing-document-issue.js";
import type { BillingDocumentListRow } from "./billing-document-list.repository.js";
import { EXTERNAL_KIND_LABELS } from "./external-szamlazz-invoice.js";
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
    origin: "OWN",
    externalKindLabel: null,
    // a saját bizonylat kifizetéséről ma nincs forrásunk
    paymentState: null,
    paidAmount: null,
    lastPaymentDate: null,
    paymentSource: null,
  };
}

/*
  ===========================================================================
  A KÜLSŐ BIZONYLATOK (acrobot 25812): a Számlázz.hu-ból kapott kimenő számlák
  (ExternalBillingDocument), a mieink mellett, „Külső” jelöléssel.
  ===========================================================================
*/

/**
 * A SZÁMLÁZZ.HU BIZONYLATTÍPUSA A MI TÍPUSUNKRA, A SZŰRŐHÖZ ÉS A „Dokumentum”
 * OSZLOPHOZ. A felirat ettől függetlenül a Számlázz.hu sajátja
 * (`externalKindLabel`). A sztornó, a jóváíró, a helyesbítő és a végszámla
 * számla-fajta, tehát INVOICE; az ismeretlen kód is az, a felirat pedig a nyers
 * kódot mutatja.
 */
export const EXTERNAL_KIND_TYPES: Readonly<
  Record<string, BillingDocumentType>
> = {
  SZ: "INVOICE",
  SS: "INVOICE",
  JS: "INVOICE",
  HS: "INVOICE",
  VS: "INVOICE",
  ES: "ADVANCE_INVOICE",
  D: "PROFORMA",
  SL: "DELIVERY_NOTE",
};

export const externalDocumentType = (kindCode: string): BillingDocumentType =>
  EXTERNAL_KIND_TYPES[kindCode.toUpperCase()] ?? "INVOICE";

export const externalKindLabel = (kindCode: string): string =>
  EXTERNAL_KIND_LABELS[kindCode.toUpperCase()] ?? kindCode;

/**
 * A KÜLSŐ SOROK SZŰRŐJE, vagy `null`, ha a lekérdezésre egyik sem illhet: a
 * külső bizonylat mindig kiállított, e-mail állapota nincs, tehát egy vázlatra
 * vagy egy e-mail állapotra szűrt lista nem mutat külsőt.
 */
export function externalWhere(
  query: BillingDocumentListQuery,
): Prisma.ExternalBillingDocumentWhereInput | null {
  if (query.origin === "OWN") return null;
  if (query.status && query.status !== "ISSUED") return null;
  if (query.emailStatus) return null;
  const where: Prisma.ExternalBillingDocumentWhereInput = {};
  if (query.documentType) {
    const codes = Object.entries(EXTERNAL_KIND_TYPES)
      .filter(([, type]) => type === query.documentType)
      .map(([code]) => code);
    where.kindCode =
      query.documentType === "INVOICE"
        ? // az ismeretlen kód is számla-fajta (lásd EXTERNAL_KIND_TYPES)
          {
            notIn: Object.keys(EXTERNAL_KIND_TYPES).filter(
              (code) => !codes.includes(code),
            ),
          }
        : { in: codes };
  }
  if (query.invoiceFormat)
    where.electronic = query.invoiceFormat === "ELECTRONIC";
  const q = query.q?.trim();
  if (q) {
    const contains = { contains: q, mode: "insensitive" as const };
    where.OR = [
      { documentNumber: contains },
      { customerName: contains },
      { externalId: contains },
    ];
  }
  return where;
}

/** A mieink ugyanígy: `null`, ha a lekérdezés csak a külsőket kéri. */
export function ownWhere(
  query: BillingDocumentListQuery,
): Prisma.InvoiceWhereInput | null {
  return query.origin === "EXTERNAL" ? null : listWhere(query);
}

/** A külső lista sorrendje, a mieinkével azonos szabállyal (LIST_ORDER_BY). */
export const EXTERNAL_LIST_ORDER_BY = [
  { issueDate: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.ExternalBillingDocumentOrderByWithRelationInput[];

export interface ExternalListRow {
  id: string;
  kindCode: string;
  documentNumber: string;
  electronic: boolean;
  customerName: string;
  issueDate: Date;
  dueDate: Date | null;
  grossAmount: Prisma.Decimal;
  currency: string;
  createdAt: Date;
  paidAmount: Prisma.Decimal;
  lastPaymentDate: Date | null;
  paymentsKnown: boolean | null;
  paymentMethod: string | null;
  cancelled: boolean;
}

/**
 * A KIFIZETETTSÉG EGY KÜLSŐ BIZONYLATRA: a bejövő listával közös számítás
 * (`paymentStateOf`, murena 25902). A sztornózott számla nem fizetendő: ott
 * `null`, nem „nem fizetett”.
 *
 *   `paymentsKnown` null     a sort a migráció óta nem vetítettük újra: UNKNOWN
 *                            (különben a kifizetettek is „Nincs fizetve”-nek
 *                            látszanának; murena review-ja)
 *   `paymentsKnown` true     a Számlázz.hu rögzítette: számolt, forrás SZAMLAZZ
 *   `paymentsKnown` false    nincs `kifizetesek` elem; a jelentése a fizetési
 *                            módtól függ (`outgoingMissingPayments`, acrobot
 *                            25936 és 25938):
 *       átutalás, utánvét, üres   UNPAID (a fizetés később jön; a 927341621-es
 *                                 számla előbb elem nélkül, a fizetés után
 *                                 elemmel jött: MEGFIGYELT ESET, NEM GARANCIA)
 *       kártya, online, készpénz  PAID a rendeléskor: összeg a bruttó, a forrás
 *                                 jelölve, DÁTUM NÉLKÜL (a kelt nem a fizetés
 *                                 napja; acrobot 25950)
 *       bármi más                 UNKNOWN
 */
export function externalPaymentFields(row: {
  grossAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  lastPaymentDate: Date | null;
  paymentsKnown: boolean | null;
  paymentMethod: string | null;
  currency: string;
  cancelled: boolean;
}): Pick<
  BillingDocumentListItem,
  "paymentState" | "paidAmount" | "lastPaymentDate" | "paymentSource"
> {
  const none = {
    paymentState: null,
    paidAmount: null,
    lastPaymentDate: null,
    paymentSource: null,
  } as const;
  if (row.cancelled) return none;
  const decimals = row.currency.toUpperCase() === "HUF" ? 0 : 2;
  const recorded = (paymentsKnown: boolean) => ({
    paymentState: paymentStateOf({
      paymentsKnown,
      paidAmount: row.paidAmount.toFixed(),
      grossAmount: row.grossAmount.toFixed(),
      currency: row.currency,
    }),
    paidAmount: row.paidAmount.toFixed(decimals),
    lastPaymentDate: calendarDay(row.lastPaymentDate),
    paymentSource: paymentsKnown ? ("SZAMLAZZ" as const) : null,
  });
  if (row.paymentsKnown === null) return recorded(false);
  if (row.paymentsKnown) return recorded(true);
  const missing = outgoingMissingPayments(row.paymentMethod);
  if (missing === "UNPAID") return recorded(true);
  if (missing === "UNKNOWN") return recorded(false);
  return {
    paymentState: "PAID",
    paidAmount: row.grossAmount.toFixed(decimals),
    lastPaymentDate: null,
    paymentSource: missing,
  };
}

export function toExternalListItem(
  row: ExternalListRow,
): BillingDocumentListItem {
  return {
    id: row.id,
    documentType: externalDocumentType(row.kindCode),
    invoiceFormat: row.electronic ? "ELECTRONIC" : "PAPER",
    documentNumber: row.documentNumber,
    customerName: row.customerName,
    issueDate: calendarDay(row.issueDate),
    dueDate: calendarDay(row.dueDate),
    grossAmount: row.grossAmount.toFixed(
      row.currency.toUpperCase() === "HUF" ? 0 : 2,
    ),
    currency: row.currency,
    status: "ISSUED",
    emailStatus: null,
    opens: "EXTERNAL_DETAIL",
    origin: "EXTERNAL",
    externalKindLabel: externalKindLabel(row.kindCode),
    ...externalPaymentFields(row),
  };
}

/** A két forrás sora a rendezéshez: a kulcsok és a kész listaelem. */
export interface MergeRow {
  issueDate: Date | null;
  createdAt: Date;
  id: string;
  item: BillingDocumentListItem;
}

/**
 * A KÉT FORRÁS EGY LISTÁVÁ, a LIST_ORDER_BY szabályával: kiállítás napja nélkül
 * (vázlat) felül, utána a kiállítás szerint csökkenően, majd a létrehozás és az
 * azonosító. Mindkét bemenet már így rendezett, és mindkettőből az első
 * `offset + limit` sor jön; ebből a lap pontosan kivágható.
 */
export function mergeListRows(
  own: readonly MergeRow[],
  external: readonly MergeRow[],
  offset: number,
  limit: number,
): BillingDocumentListItem[] {
  const before = (a: MergeRow, b: MergeRow): boolean => {
    if ((a.issueDate === null) !== (b.issueDate === null))
      return a.issueDate === null;
    if (
      a.issueDate &&
      b.issueDate &&
      a.issueDate.getTime() !== b.issueDate.getTime()
    )
      return a.issueDate.getTime() > b.issueDate.getTime();
    if (a.createdAt.getTime() !== b.createdAt.getTime())
      return a.createdAt.getTime() > b.createdAt.getTime();
    return a.id > b.id;
  };
  const merged: MergeRow[] = [];
  let i = 0;
  let j = 0;
  while (
    merged.length < offset + limit &&
    (i < own.length || j < external.length)
  ) {
    if (
      j >= external.length ||
      (i < own.length && before(own[i]!, external[j]!))
    )
      merged.push(own[i++]!);
    else merged.push(external[j++]!);
  }
  return merged.slice(offset).map((row) => row.item);
}
