import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";
import type {
  BillingDocumentListQuery,
  BillingDocumentListResponse,
} from "@acropora/types";

import {
  EXTERNAL_LIST_ORDER_BY,
  LIST_ORDER_BY,
  externalWhere,
  mergeListRows,
  ownWhere,
  simplePayOrderKey,
  toExternalListItem,
  type OwnPaymentMark,
  type SimplePaySettlementLine,
  toListItem,
} from "./billing-document-list.js";
import { UNAS_SHOP_ORDER_PREFIX } from "../integrations/simplepay/simplepay-settlement.repository.js";

export const LIST_SELECT = {
  id: true,
  documentType: true,
  invoiceFormat: true,
  invoiceNumber: true,
  partnerName: true,
  issueDate: true,
  dueDate: true,
  grossAmount: true,
  currency: true,
  status: true,
  emailStatus: true,
  createdAt: true,
  customer: { select: { companyName: true, displayName: true } },
  lines: {
    select: {
      kind: true,
      quantity: true,
      unitNet: true,
      netAmount: true,
      vatRatePercent: true,
    },
  },
} satisfies Prisma.InvoiceSelect;

export type BillingDocumentListRow = Prisma.InvoiceGetPayload<{
  select: typeof LIST_SELECT;
}>;

export const EXTERNAL_LIST_SELECT = {
  id: true,
  kindCode: true,
  documentNumber: true,
  electronic: true,
  customerName: true,
  issueDate: true,
  dueDate: true,
  grossAmount: true,
  currency: true,
  createdAt: true,
  paidAmount: true,
  lastPaymentDate: true,
  paymentsKnown: true,
  paymentMethod: true,
  paymentMethodUnified: true,
  orderNumber: true,
  customerTaxNumber: true,
  cancelled: true,
  payments: true,
  source: true,
} satisfies Prisma.ExternalBillingDocumentSelect;

/**
 * A LISTA: a mieink (Invoice) és a Számlázz.hu-ból kapott külsők
 * (ExternalBillingDocument, acrobot 25812), ugyanazzal a sorrenddel.
 *
 * Ha a lekérdezés csak az egyik forrást engedi, az az adatbázisban lapoz, mint
 * eddig. Ha mindkettőt, mindkettőből az első `oldal × lapméret` sor jön, és a
 * lapot az összefésülésük adja (`mergeListRows`); a darabszám a kettő összege.
 * Mind a négy lekérdezés egy tranzakcióban, hogy a lap és a darabszám ugyanazt a
 * pillanatot lássa. A tételek a Prisma kötegelt második lekérdezésével jönnek,
 * nem soronként.
 */
@Injectable()
export class BillingDocumentListRepository {
  private readonly database = prisma;

  async list(
    query: Required<Pick<BillingDocumentListQuery, "page" | "pageSize">> &
      BillingDocumentListQuery,
  ): Promise<BillingDocumentListResponse> {
    const own = ownWhere(query);
    const external = externalWhere(query);
    const offset = (query.page - 1) * query.pageSize;
    const both = own !== null && external !== null;
    const [ownRows, ownCount, externalRows, externalCount] =
      await this.database.$transaction([
        this.database.invoice.findMany({
          where: own ?? { id: { in: [] } },
          select: LIST_SELECT,
          orderBy: LIST_ORDER_BY,
          skip: both ? 0 : offset,
          take:
            own === null ? 0 : both ? offset + query.pageSize : query.pageSize,
        }),
        this.database.invoice.count({ where: own ?? { id: { in: [] } } }),
        this.database.externalBillingDocument.findMany({
          where: external ?? { id: { in: [] } },
          select: EXTERNAL_LIST_SELECT,
          orderBy: EXTERNAL_LIST_ORDER_BY,
          skip: both ? 0 : offset,
          take:
            external === null
              ? 0
              : both
                ? offset + query.pageSize
                : query.pageSize,
        }),
        this.database.externalBillingDocument.count({
          where: external ?? { id: { in: [] } },
        }),
      ]);
    // a kártyás külső számlák SimplePay-sorai, egy lekérdezéssel a lapra
    const simplePay = await simplePayLinesByOrder(
      this.database,
      externalRows.map((row) => row.orderNumber),
    );
    // a saját, a Számlázz.hu-ba beírt jelölések (acrobot 26027), a lapra
    const marks = await ownPaymentMarksByInvoice(
      this.database,
      externalRows.map((row) => row.documentNumber),
    );
    // a magánszemélyes számla vevőneve a webshop-rendelésből (acrobot 26096)
    const buyers = await orderBuyerNamesByOrderNumber(
      this.database,
      externalRows.map((row) => row.orderNumber),
    );
    const toExternal = (row: (typeof externalRows)[number]) =>
      toExternalListItem(
        row,
        simplePay.get(
          simplePayOrderKey(row.orderNumber, UNAS_SHOP_ORDER_PREFIX) ?? "",
        ) ?? [],
        marks.get(row.documentNumber) ?? [],
        (row.orderNumber && buyers.get(row.orderNumber)) || null,
      );
    const totalItems = ownCount + externalCount;
    const items = both
      ? mergeListRows(
          ownRows.map((row) => ({
            issueDate: row.issueDate,
            createdAt: row.createdAt,
            id: row.id,
            item: toListItem(row),
          })),
          externalRows.map((row) => ({
            issueDate: row.issueDate,
            createdAt: row.createdAt,
            id: row.id,
            item: toExternal(row),
          })),
          offset,
          query.pageSize,
        )
      : own !== null
        ? ownRows.map(toListItem)
        : externalRows.map((row) => toExternal(row));
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }
}

/**
 * A rendelésszámokhoz tartozó SimplePay elszámolás-sorok, a 6 számjegyes
 * kulcs szerint csoportosítva (`simplePayOrderKey`). Egy lekérdezés egy lapra.
 */
export async function simplePayLinesByOrder(
  database: typeof prisma,
  orderNumbers: readonly (string | null)[],
): Promise<Map<string, SimplePaySettlementLine[]>> {
  const keys = [
    ...new Set(
      orderNumbers
        .map((n) => simplePayOrderKey(n, UNAS_SHOP_ORDER_PREFIX))
        .filter((k): k is string => k !== null),
    ),
  ];
  const out = new Map<string, SimplePaySettlementLine[]>();
  if (keys.length === 0) return out;
  const lines = await database.simplePayTransactionLine.findMany({
    where: { orderKeySuffix: { in: keys } },
    select: {
      orderKeySuffix: true,
      transactionStatus: true,
      amount: true,
      transactionDate: true,
    },
  });
  for (const line of lines) {
    const key = line.orderKeySuffix!;
    out.set(key, [...(out.get(key) ?? []), line]);
  }
  return out;
}

/**
 * A SAJÁT KIFIZETETT-JELÖLÉSEK, AMIKET A SZÁMLÁZZ.HU ELFOGADOTT (WRITTEN), a
 * számlaszám szerint (acrobot 26027). Egy lekérdezés egy lapra. Csak a WRITTEN
 * számít: a PLANNED, UNKNOWN és FAILED sorról nem tudjuk, hogy beíródott.
 */
export async function ownPaymentMarksByInvoice(
  database: typeof prisma,
  documentNumbers: readonly string[],
): Promise<Map<string, OwnPaymentMark[]>> {
  const out = new Map<string, OwnPaymentMark[]>();
  if (documentNumbers.length === 0) return out;
  const rows = await database.outgoingPaymentMark.findMany({
    where: {
      invoiceNumber: { in: [...new Set(documentNumbers)] },
      state: "WRITTEN",
    },
    orderBy: { markDate: "asc" },
    select: { invoiceNumber: true, source: true, markDate: true, amount: true },
  });
  for (const row of rows)
    out.set(row.invoiceNumber, [
      ...(out.get(row.invoiceNumber) ?? []),
      { source: row.source, markDate: row.markDate, amount: row.amount },
    ]);
  return out;
}

/**
 * A WEBSHOP-RENDELÉSEK VEVŐNEVE A SZÁMLA RENDELÉSSZÁMA SZERINT (acrobot
 * 26096): a feed rendelésszáma „47679-558779”, a rendelés-tükör kulcsa
 * „UNAS-47679-558779”. Egy lekérdezés egy lapra, csak olvasás; új UNAS-hívás
 * nincs, a meglévő rendelés-szinkron tükrét olvassa.
 */
export async function orderBuyerNamesByOrderNumber(
  database: typeof prisma,
  orderNumbers: readonly (string | null)[],
): Promise<Map<string, string>> {
  const numbers = [
    ...new Set(orderNumbers.filter((n): n is string => Boolean(n?.trim()))),
  ];
  const out = new Map<string, string>();
  if (numbers.length === 0) return out;
  const orders = await database.salesOrder.findMany({
    where: { orderNumber: { in: numbers.map((n) => `UNAS-${n}`) } },
    select: { orderNumber: true, buyerName: true },
  });
  for (const order of orders)
    if (order.buyerName?.trim())
      out.set(order.orderNumber.slice("UNAS-".length), order.buyerName.trim());
  return out;
}
