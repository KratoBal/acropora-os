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
import {
  EXTERNAL_KIND_LABELS,
  type ExternalInvoicePayment,
} from "./external-szamlazz-invoice.js";
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
      // a webshop rendelésszáma (`alap.rendelesszam`) is megtalálja
      { orderNumber: contains },
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
  paymentMethodUnified: string | null;
  orderNumber: string | null;
  customerTaxNumber: string | null;
  cancelled: boolean;
  /** A Számlázz.hu kifizetései (`kifizetesek`), a saját jelölés kiszűréséhez. */
  payments: Prisma.JsonValue;
}

/**
 * EGY SAJÁT KIFIZETETT-JELÖLÉS, AMIT A SZÁMLÁZZ.HU ELFOGADOTT (`OutgoingPaymentMark`,
 * WRITTEN; acrobot 26027). A forrás a jelölés oka: GLS utánvét, SimplePay,
 * Foxpost.
 */
export interface OwnPaymentMark {
  source: "GLS_COD" | "SIMPLEPAY" | "FOXPOST";
  markDate: Date;
  amount: Prisma.Decimal;
}

/**
 * A SAJÁT JELÖLÉSBŐL A KIFIZETÉS, ha a feed még nem hozta (acrobot 26027:
 * Balázs 2026-10-02-én a három beírt GLS-fizetést nem látta az OS-ben, mert a
 * Számlázz.hu a számlát a jóváírás után nem küldte újra).
 *
 * A jelölés, amit a feed MÁR hordoz (ugyanaz a nap és összeg a `kifizetesek`
 * között), nem számít még egyszer: akkor a feed a forrás. Ha minden jelölés
 * ilyen, `null`, és a hívó a feed szerint számol. A forrás a legkésőbbi
 * jelölésé, a dátum a legkésőbbi kifizetés napja (feed vagy jelölés).
 */
export function ownMarkPayment(
  row: {
    grossAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    lastPaymentDate: Date | null;
    paymentsKnown: boolean | null;
    payments: Prisma.JsonValue;
    currency: string;
  },
  marks: readonly OwnPaymentMark[],
): Pick<
  BillingDocumentListItem,
  "paymentState" | "paidAmount" | "lastPaymentDate" | "paymentSource"
> | null {
  const feed = row.paymentsKnown
    ? ((row.payments ?? []) as unknown as ExternalInvoicePayment[])
    : [];
  const fresh = marks.filter(
    (mark) =>
      !feed.some(
        (payment) =>
          payment.date === calendarDay(mark.markDate) &&
          new Prisma.Decimal(payment.amount).equals(mark.amount),
      ),
  );
  if (fresh.length === 0) return null;
  const latest = fresh.reduce((a, b) => (a.markDate >= b.markDate ? a : b));
  const paid = fresh.reduce(
    (total, mark) => total.add(mark.amount),
    row.paymentsKnown ? row.paidAmount : new Prisma.Decimal(0),
  );
  const lastPaid =
    row.paymentsKnown &&
    row.lastPaymentDate &&
    row.lastPaymentDate > latest.markDate
      ? row.lastPaymentDate
      : latest.markDate;
  return {
    paymentState: paymentStateOf({
      paymentsKnown: true,
      paidAmount: paid.toFixed(),
      grossAmount: row.grossAmount.toFixed(),
      currency: row.currency,
    }),
    paidAmount: paid.toFixed(row.currency.toUpperCase() === "HUF" ? 0 : 2),
    lastPaymentDate: calendarDay(lastPaid),
    paymentSource: `MARK_${latest.source}`,
  };
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
 *                            25936 és 25938). ELŐBB a zárt `fizmodunified`
 *                            dönt (acrobot 25964); az „egyéb” és az
 *                            ismeretlen érték a szabad szöveges fizmodra megy
 *                            tovább (25967: élesen a 27 üres fizmodú
 *                            webshop-számla mind „egyéb”):
 *       átutalás, utánvét, üres   UNPAID (a fizetés később jön; a 927341621-es
 *                                 számla előbb elem nélkül, a fizetés után
 *                                 elemmel jött: MEGFIGYELT ESET, NEM GARANCIA)
 *       kártya, online, készpénz  PAID a rendeléskor: összeg a bruttó, a forrás
 *                                 jelölve, DÁTUM NÉLKÜL (a kelt nem a fizetés
 *                                 napja; acrobot 25950)
 *       bármi más                 UNKNOWN
 */
/** Egy SimplePay elszámolás-sor, ahogy a kifizetéshez kell. */
export interface SimplePaySettlementLine {
  transactionStatus: string;
  amount: Prisma.Decimal;
  transactionDate: Date;
}

/**
 * A WEBSHOP RENDELÉSSZÁMÁBÓL A SIMPLEPAY-SOR KULCSA. A feed rendelésszáma
 * „47679-665706” (bolt-azonosító + 6 számjegy); a SimplePay-sor `orderKeySuffix`
 * mezője a 6 számjegy, a bolt a `UNAS-47679-` előtagból (a SimplePay-oldal
 * `UNAS_SHOP_ORDER_PREFIX`-e). Más bolt vagy más alak: nincs kulcs, nem találgat.
 */
export function simplePayOrderKey(
  orderNumber: string | null,
  shopPrefix: string,
): string | null {
  const shop = shopPrefix.replace(/^UNAS-/, "");
  if (!orderNumber?.startsWith(shop)) return null;
  const suffix = orderNumber.slice(shop.length);
  return /^\d{6}$/.test(suffix) ? suffix : null;
}

/**
 * A KÁRTYÁS SZÁMLA KIFIZETÉSE A SIMPLEPAY ELSZÁMOLÁS-SORAIBÓL (acrobot 25964,
 * 25979). Élesen mérve: COMPLETED 53, REFUND 3 sor; más státuszt nem láttunk,
 * ezért más nem számít (nem találgatjuk, mit jelentene).
 *
 *   COMPLETED   fizetés; az összegek összeadódnak (minden sor külön SimplePay-
 *               tranzakció, külön pénz)
 *   REFUND      visszatérítés ugyanarra a rendelésre: a kifizetett összeget
 *               csökkenti. Teljes visszatérítésnél nem „Fizetve”, és a forrás
 *               jelöli, hogy visszatérítés volt.
 *
 * ABSZOLÚT ÉRTÉKKEL számol: visszatérítéses mintánk nincs, tehát a REFUND sor
 * előjelét nem ismerjük, és így egyik előjellel sem számol rosszul. A nettó
 * nulla alá nem megy. `null`: nincs COMPLETED sor, a hívó a kártyás
 * feltevésnél marad.
 */
export function simplePayPayment(
  lines: readonly SimplePaySettlementLine[],
  grossAmount: Prisma.Decimal,
  currency: string,
): Pick<
  BillingDocumentListItem,
  "paymentState" | "paidAmount" | "lastPaymentDate" | "paymentSource"
> | null {
  const completed = lines.filter((l) => l.transactionStatus === "COMPLETED");
  if (completed.length === 0) return null;
  const refunds = lines.filter((l) => l.transactionStatus === "REFUND");
  const sum = (rows: readonly SimplePaySettlementLine[]) =>
    rows.reduce((total, l) => total.add(l.amount.abs()), new Prisma.Decimal(0));
  const net = Prisma.Decimal.max(sum(completed).sub(sum(refunds)), 0);
  const decimals = currency.toUpperCase() === "HUF" ? 0 : 2;
  const lastPaid = completed
    .map((l) => l.transactionDate)
    .reduce((a, b) => (a > b ? a : b));
  return {
    paymentState: paymentStateOf({
      paymentsKnown: true,
      paidAmount: net.toFixed(),
      grossAmount: grossAmount.toFixed(),
      currency,
    }),
    paidAmount: net.toFixed(decimals),
    lastPaymentDate: calendarDay(lastPaid),
    paymentSource: refunds.length > 0 ? "SIMPLEPAY_REFUNDED" : "SIMPLEPAY",
  };
}

export function externalPaymentFields(
  row: {
    grossAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    lastPaymentDate: Date | null;
    paymentsKnown: boolean | null;
    paymentMethod: string | null;
    paymentMethodUnified: string | null;
    currency: string;
    cancelled: boolean;
    payments?: Prisma.JsonValue;
  },
  simplePay: readonly SimplePaySettlementLine[] = [],
  marks: readonly OwnPaymentMark[] = [],
): Pick<
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
  // a feed szerinti „Fizetve” nyer; a saját jelölés csak kiegészítő adat
  if (row.paymentsKnown) {
    const fromFeed = recorded(true);
    if (fromFeed.paymentState === "PAID") return fromFeed;
  }
  const marked = ownMarkPayment(
    { ...row, payments: row.payments ?? [] },
    marks,
  );
  if (marked) return marked;
  if (row.paymentsKnown === null) return recorded(false);
  if (row.paymentsKnown) return recorded(true);
  // a zárt `fizmodunified` előbb, a szabad szöveg csak tartalék (acrobot 25964)
  const missing = outgoingMissingPayments(
    row.paymentMethod,
    row.paymentMethodUnified,
  );
  if (missing === "UNPAID") return recorded(true);
  if (missing === "UNKNOWN") return recorded(false);
  // a kártyás számla tényleges kifizetése, ha a SimplePay elszámolta
  if (missing === "CARD_AT_ORDER") {
    const settled = simplePayPayment(simplePay, row.grossAmount, row.currency);
    if (settled) return settled;
  }
  return {
    paymentState: "PAID",
    paidAmount: row.grossAmount.toFixed(decimals),
    lastPaymentDate: null,
    paymentSource: missing,
  };
}

/**
 * A VEVŐ NEVE A WEBSHOP-RENDELÉSBŐL, HA A SZÁMLA ELREJTI (Balázs, 2026-10-02
 * 11:16 UTC: „ne az szerepeljen, hogy maganszemely hanem a vasarlo neve”;
 * acrobot 26096). A magánszemély nevét a NAV elrejti, a Számlázz.hu feedje
 * így egy általános nevet ad; a rendelés-tükör (`SalesOrder.buyerName`, a UNAS
 * számlázási neve) ismeri a valódit. Élesen szeptemberben 46 adószám nélküli
 * számlából 40-nél megvan (acrobot 26098); a többinek nincs rendelésszáma.
 *
 * A FELTÉTEL AZ ADÓSZÁM HIÁNYA, NEM A NÉV SZÖVEGE: a takart név pontos alakja
 * a feedtől függ, az adószám hiánya viszont a magánszemély jele. Cégnél a
 * számla saját neve marad. Csak megjelenítés: a számlát nem írja át.
 */
export function externalCustomerName(
  row: { customerName: string; customerTaxNumber: string | null },
  orderBuyerName: string | null | undefined,
): { customerName: string; customerNameFromOrder?: true } {
  const fromOrder = orderBuyerName?.trim();
  return !row.customerTaxNumber?.trim() && fromOrder
    ? { customerName: fromOrder, customerNameFromOrder: true }
    : { customerName: row.customerName };
}

export function toExternalListItem(
  row: ExternalListRow,
  simplePay: readonly SimplePaySettlementLine[] = [],
  marks: readonly OwnPaymentMark[] = [],
  orderBuyerName: string | null = null,
): BillingDocumentListItem {
  return {
    id: row.id,
    documentType: externalDocumentType(row.kindCode),
    invoiceFormat: row.electronic ? "ELECTRONIC" : "PAPER",
    documentNumber: row.documentNumber,
    ...externalCustomerName(row, orderBuyerName),
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
    ...externalPaymentFields(row, simplePay, marks),
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
