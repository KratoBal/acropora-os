import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  calendarEventDay,
  responsibleNames,
} from "./calendar-event.repository.js";
import type {
  ContentRow,
  EventRow,
  LivestockRow,
  PurchaseLineRow,
  SaleRow,
} from "./calendar-feed.view.js";
import type { CalendarRange } from "./calendar-range.js";

/** The orders whose goods are still expected: the same two states the product-data reader counts (T5.4 arrivals). */
const OPEN_ORDER = ["SENT", "PARTIALLY_RECEIVED"] as const;

/**
 * The six reads of the calendar feed (T5.5 S1, the events S2). Each one cuts to the range in the database; the view
 * maps and groups. Nothing here writes.
 */
@Injectable()
export class CalendarFeedRepository {
  /** By the PLANNED day: `scheduledFor` is the far end of the posting window (content-schedule.ts), not a publish day. */
  async content(range: CalendarRange): Promise<ContentRow[]> {
    const rows = await prisma.contentItem.findMany({
      where: {
        plannedFor: { gte: range.start, lt: range.end },
        state: { not: "DISCARDED" },
      },
      select: {
        id: true,
        title: true,
        channel: true,
        state: true,
        plannedFor: true,
        scheduledFor: true,
      },
    });
    return rows.flatMap((row) =>
      row.plannedFor ? [{ ...row, plannedFor: row.plannedFor }] : [],
    );
  }

  /**
   * The hand-entered events that TOUCH the range: one that starts before it and ends in it is on the calendar too.
   * Both are date columns, compared with the range's days.
   */
  async events(range: CalendarRange): Promise<EventRow[]> {
    const rows = await prisma.calendarEvent.findMany({
      where: {
        startsOn: { lte: range.lastDate },
        endsOn: { gte: range.firstDate },
      },
      select: {
        id: true,
        kind: true,
        title: true,
        startsOn: true,
        endsOn: true,
        location: true,
        responsibleUserId: true,
      },
    });
    const names = await responsibleNames(
      rows.flatMap((row) =>
        row.responsibleUserId ? [row.responsibleUserId] : [],
      ),
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      startsOn: calendarEventDay(row.startsOn),
      endsOn: calendarEventDay(row.endsOn),
      location: row.location,
      responsible: row.responsibleUserId
        ? {
            id: row.responsibleUserId,
            name: names.get(row.responsibleUserId) ?? null,
          }
        : null,
    }));
  }

  /** `expectedOn` is a date column: compared with the range's days, not its instants. */
  async livestock(range: CalendarRange): Promise<LivestockRow[]> {
    const rows = await prisma.livestockArrival.findMany({
      where: {
        expectedOn: { gte: range.firstDate, lte: range.lastDate },
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        label: true,
        kind: true,
        status: true,
        quantity: true,
        preorderable: true,
        productId: true,
        expectedOn: true,
      },
    });
    // the query leaves CANCELLED out; the guard narrows the type and keeps it out if the query changes
    return rows.flatMap((row) =>
      row.status === "CANCELLED" ? [] : [{ ...row, status: row.status }],
    );
  }

  /** A line's own date wins; the order's date counts only for a line without one. */
  async purchaseLines(range: CalendarRange): Promise<PurchaseLineRow[]> {
    const inRange = { gte: range.start, lt: range.end };
    const rows = await prisma.purchaseOrderLine.findMany({
      where: {
        purchaseOrder: { status: { in: [...OPEN_ORDER] } },
        OR: [
          { expectedAt: inRange },
          { expectedAt: null, purchaseOrder: { expectedAt: inRange } },
        ],
      },
      select: {
        purchaseOrderId: true,
        expectedAt: true,
        orderedQuantity: true,
        receivedQuantity: true,
        purchaseOrder: { select: { expectedAt: true } },
        variant: { select: { product: { select: { id: true, name: true } } } },
      },
    });
    return rows.map((row) => ({
      purchaseOrderId: row.purchaseOrderId,
      lineExpectedAt: row.expectedAt,
      orderExpectedAt: row.purchaseOrder.expectedAt,
      remaining: row.orderedQuantity.greaterThan(row.receivedQuantity),
      product: row.variant.product,
    }));
  }

  /** Open orders with goods still to come on a line that has no day at all: they exist, the calendar cannot place them. */
  async undatedOpenOrders(): Promise<number> {
    const rows = await prisma.purchaseOrderLine.findMany({
      where: {
        expectedAt: null,
        purchaseOrder: { status: { in: [...OPEN_ORDER] }, expectedAt: null },
      },
      select: {
        purchaseOrderId: true,
        orderedQuantity: true,
        receivedQuantity: true,
      },
    });
    return new Set(
      rows
        .filter((row) => row.orderedQuantity.greaterThan(row.receivedQuantity))
        .map((row) => row.purchaseOrderId),
    ).size;
  }

  /**
   * The sales that touch the range. Own (an ACROPORA product): the variant's three fields together, a half-open
   * window. Mirror (a UNAS product): the snapshot's window, either end may be open. Both only on an active,
   * not archived product: the product-data reader's on-sale listing rule.
   */
  async sales(range: CalendarRange): Promise<SaleRow[]> {
    const [own, mirror] = await Promise.all([
      prisma.productVariant.findMany({
        where: {
          isActive: true,
          sellingSaleGrossPrice: { not: null },
          sellingSaleStartsAt: { lt: range.end },
          sellingSaleEndsAt: { gt: range.start },
          product: {
            catalogAuthority: "ACROPORA",
            isActive: true,
            archivedAt: null,
          },
        },
        select: {
          sellingSaleStartsAt: true,
          sellingSaleEndsAt: true,
          product: { select: { id: true, name: true } },
        },
      }),
      prisma.product.findMany({
        where: {
          catalogAuthority: "UNAS",
          isActive: true,
          archivedAt: null,
          unasSnapshot: {
            is: {
              saleGrossPrice: { not: null },
              AND: [
                {
                  OR: [
                    { saleStartsAt: null },
                    { saleStartsAt: { lt: range.end } },
                  ],
                },
                {
                  OR: [
                    { saleEndsAt: null },
                    { saleEndsAt: { gte: range.start } },
                  ],
                },
              ],
            },
          },
        },
        select: {
          id: true,
          name: true,
          unasSnapshot: { select: { saleStartsAt: true, saleEndsAt: true } },
        },
      }),
    ]);
    return [
      ...own.flatMap((variant): SaleRow[] =>
        variant.sellingSaleStartsAt && variant.sellingSaleEndsAt
          ? [
              {
                source: "saját",
                product: variant.product,
                startsAt: variant.sellingSaleStartsAt,
                endsAt: variant.sellingSaleEndsAt,
              },
            ]
          : [],
      ),
      ...mirror.flatMap((product): SaleRow[] =>
        product.unasSnapshot
          ? [
              {
                source: "UNAS tükör",
                product: { id: product.id, name: product.name },
                startsAt: product.unasSnapshot.saleStartsAt,
                endsAt: product.unasSnapshot.saleEndsAt,
              },
            ]
          : [],
      ),
    ];
  }
}
