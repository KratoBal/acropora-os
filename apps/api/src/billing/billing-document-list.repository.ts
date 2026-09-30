import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";
import type {
  BillingDocumentListQuery,
  BillingDocumentListResponse,
} from "@acropora/types";

import {
  LIST_ORDER_BY,
  listWhere,
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

/**
 * A LISTA: egy lekérdezés a sorokra (a tételekkel együtt, a Prisma kötegelt
 * második lekérdezésével, nem soronként) és egy a darabszámra, ugyanazzal a
 * szűrővel, egy tranzakcióban, hogy a lap és a darabszám ugyanazt a pillanatot
 * lássa.
 */
@Injectable()
export class BillingDocumentListRepository {
  private readonly database = prisma;

  async list(
    query: Required<Pick<BillingDocumentListQuery, "page" | "pageSize">> &
      BillingDocumentListQuery,
  ): Promise<BillingDocumentListResponse> {
    const where = listWhere(query);
    const [rows, totalItems] = await this.database.$transaction([
      this.database.invoice.findMany({
        where,
        select: LIST_SELECT,
        orderBy: LIST_ORDER_BY,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.invoice.count({ where }),
    ]);
    return {
      items: rows.map(toListItem),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }
}
