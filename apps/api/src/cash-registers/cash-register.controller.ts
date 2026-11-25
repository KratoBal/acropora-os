import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";
import {
  PERMISSIONS,
  type CashRegisterReceiptListResponse,
} from "@acropora/types";
import {
  CASH_REGISTER_RECEIPT_SORT_FIELDS,
  type CashRegisterReceiptSortField,
} from "@acropora/types";
import {
  listOrderBy,
  SORT_DIRECTIONS,
  type ListSortSpec,
  type SortDirection,
} from "../common/list-sort.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { businessDay, netAmount, type Payment } from "./opg-receipts.js";
/**
 * A NYUGTA-LISTA RENDEZÉSE (Balázs kérése, kártya 2f6369a4): a lista egy nap nyugtáit mutatja, 50-esével lapozva, ezért a rendezés
 * SZERVEROLDALI, a nap összes nyugtáján, nem csak az aktuális lapon. Fehér lista: kelt, végösszeg, nyugtaszám (az egy tábla közvetlen
 * oszlopai); a döntetlen az azonosító ugyanabban az irányban. Rendezés nélkül az eddigi sorrend (kelt szerint csökkenő).
 */
const RECEIPT_SORT: ListSortSpec<
  CashRegisterReceiptSortField,
  Prisma.CashRegisterReceiptOrderByWithRelationInput
> = {
  fields: {
    issuedAt: (d) => ({ issuedAt: d }),
    total: (d) => ({ total: d }),
    receiptNumber: (d) => ({ receiptNumber: d }),
  },
  fallback: [{ issuedAt: "desc" }, { id: "desc" }],
  tieBreaker: (d) => ({ id: d }),
};

export const receiptListOrderBy = (
  sort: CashRegisterReceiptSortField | undefined,
  direction: SortDirection | undefined,
) => listOrderBy(RECEIPT_SORT, sort, direction);

export async function receiptList(
  day: string,
  page: number,
  sort?: CashRegisterReceiptSortField,
  direction?: SortDirection,
): Promise<CashRegisterReceiptListResponse> {
  const where = { businessDay: new Date(`${day}T00:00:00Z`) };
  const pageSize = 50;
  const [items, total, summaryRows, gaps, lastRun] = await prisma.$transaction(
    [
      prisma.cashRegisterReceipt.findMany({
        where,
        orderBy: receiptListOrderBy(sort, direction),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          lines: { orderBy: { position: "asc" } },
          file: { select: { validationCode: true } },
        },
      }),
      prisma.cashRegisterReceipt.count({ where }),
      prisma.cashRegisterReceipt.findMany({
        where: { ...where, cancelled: false },
        select: { total: true, kind: true, payments: true },
      }),
      prisma.cashRegisterGap.findMany({ orderBy: { detectedAt: "desc" } }),
      prisma.cashRegisterSyncRun.findFirst({
        orderBy: { startedAt: "desc" },
        select: {
          status: true,
          startedAt: true,
          completedAt: true,
          errorCode: true,
        },
      }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const sums = new Map<string, Prisma.Decimal>();
  let sum = new Prisma.Decimal(0);
  for (const r of summaryRows) {
    sum = sum.add(netAmount(r.kind, r.total.toString()));
    for (const p of r.payments as unknown as Payment[]) {
      sums.set(
        p.category,
        (sums.get(p.category) ?? new Prisma.Decimal(0)).add(p.amount),
      );
    }
  }
  return {
    day,
    total,
    page,
    pageSize,
    items: items.map((r) => ({
      id: r.id,
      apNumber: r.apNumber,
      receiptNumber: r.receiptNumber,
      issuedAt: r.issuedAt.toISOString(),
      total: netAmount(r.kind, r.total.toString()).toString(),
      paymentMeans: r.paymentMeans,
      cancelled: r.cancelled,
      kind: r.kind,
      validationCode: r.file.validationCode,
      lines: r.lines.map((l) => ({
        name: l.name,
        quantity: l.quantity.toString(),
        sum: l.sum.toString(),
        vatCode: l.vatCode,
      })),
    })),
    summary: {
      count: summaryRows.length,
      total: sum.toString(),
      payments: [...sums].map(([category, amount]) => ({
        category,
        amount: amount.toString(),
      })),
    },
    gaps: gaps.map((g) => ({
      apNumber: g.apNumber,
      fromFileNumber: g.fromFileNumber,
      toFileNumber: g.toFileNumber,
      detectedAt: g.detectedAt.toISOString(),
      reason: g.reason,
    })),
    lastRun: lastRun
      ? {
          ...lastRun,
          startedAt: lastRun.startedAt.toISOString(),
          completedAt: lastRun.completedAt?.toISOString() ?? null,
        }
      : null,
  };
}
@Controller("billing/cash-register-receipts")
@RequirePermissions(PERMISSIONS.BILLING_VIEW)
export class CashRegisterController {
  @Get() list(
    @Query("day") rawDay?: string,
    @Query("page") rawPage?: string,
    @Query("sort") rawSort?: string,
    @Query("direction") rawDirection?: string,
  ) {
    const day = rawDay ?? businessDay(new Date()),
      page = rawPage === undefined ? 1 : Number(rawPage);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(new Date(`${day}T00:00:00Z`).getTime()) ||
      new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000
    )
      throw new BadRequestException("Érvénytelen nap vagy oldalszám.");
    // a rendezés fehér listáról: ismeretlen mező vagy irány 400, nem csendes elhagyás
    if (
      rawSort !== undefined &&
      !(CASH_REGISTER_RECEIPT_SORT_FIELDS as readonly string[]).includes(
        rawSort,
      )
    )
      throw new BadRequestException("Érvénytelen rendezési mező.");
    if (
      rawDirection !== undefined &&
      !(SORT_DIRECTIONS as readonly string[]).includes(rawDirection)
    )
      throw new BadRequestException("Érvénytelen rendezési irány.");
    return receiptList(
      day,
      page,
      rawSort as CashRegisterReceiptSortField | undefined,
      rawDirection as SortDirection | undefined,
    );
  }
}
