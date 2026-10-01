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
  toExternalListItem,
  toListItem,
} from "./billing-document-list.js";

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
  cancelled: true,
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
            item: toExternalListItem(row),
          })),
          offset,
          query.pageSize,
        )
      : own !== null
        ? ownRows.map(toListItem)
        : externalRows.map(toExternalListItem);
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
