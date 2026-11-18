import { Prisma, prisma } from "@acropora/database";
import type {
  WebshopOrderShortageView,
  WebshopShortageStatus,
} from "@acropora/types";

import type { WebshopShortageStore } from "./webshop-order-shortages.service.js";

type ShortageRow = Prisma.WebshopOrderShortageGetPayload<{
  include: { lines: true };
}>;

type Db = Pick<
  typeof prisma,
  | "$transaction"
  | "webshopOrderShortage"
  | "webshopOrderShortageLine"
  | "auditLog"
>;

const ACTIVE: WebshopShortageStatus[] = ["OPEN", "AGREED"];

function toView(row: ShortageRow): WebshopOrderShortageView {
  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    choice: row.choice,
    channel: row.channel,
    agreedAt: row.agreedAt?.toISOString() ?? null,
    agreementNote: row.agreementNote,
    splitOrderId: row.splitOrderId,
    resolutionNote: row.resolutionNote,
    detectedAt: row.detectedAt.toISOString(),
    detectedByUserId: row.detectedByUserId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedByUserId: row.resolvedByUserId,
    lines: [...row.lines]
      .sort((a, b) => a.itemId.localeCompare(b.itemId))
      .map((l) => ({
        id: l.id,
        itemId: l.itemId,
        sku: l.sku,
        title: l.title,
        orderedQuantity: l.orderedQuantity,
        availableQuantity: l.availableQuantity,
        agreedQuantity: l.agreedQuantity,
        replacementVariantId: l.replacementVariantId,
        replacementSku: l.replacementSku,
      })),
  };
}

/**
 * A HIÁNY-REKORD TÁROLÓJA. Minden írás EGY tranzakcióban megy az auditnaplóbejegyzésével, és az állapot-őr a frissítés saját `where`
 * feltételében áll (`status in expect`): ha közben másik kérés elvitte az állapotot, a frissítés nem talál sort, a tároló `null`-t ad, és
 * sem tételt, sem auditot nem ír (a hívó 409-et ad).
 */
export class PrismaWebshopShortageStore implements WebshopShortageStore {
  constructor(private readonly db: Db = prisma) {}

  async activeItemIds(orderId: string): Promise<string[]> {
    const rows = await this.db.webshopOrderShortage.findMany({
      where: { orderId, status: { in: ACTIVE } },
      include: { lines: true },
    });
    return rows.flatMap((row) => row.lines.map((l) => l.itemId));
  }

  async create(
    input: Parameters<WebshopShortageStore["create"]>[0],
  ): Promise<WebshopOrderShortageView> {
    return this.db.$transaction(async (tx) => {
      const row = await tx.webshopOrderShortage.create({
        data: {
          orderId: input.orderId,
          detectedByUserId: input.userId,
          detectedAt: input.now,
          lines: {
            create: input.lines.map((l) => ({
              itemId: l.itemId,
              sku: l.sku,
              title: l.title,
              orderedQuantity: l.orderedQuantity,
              availableQuantity: l.availableQuantity,
            })),
          },
        },
        include: { lines: true },
      });
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: "webshop-order.shortage-opened",
          entityType: "WebshopOrder",
          entityId: input.orderId,
          metadata: {
            shortageId: row.id,
            items: input.lines.map((l) => l.itemId),
          },
        },
      });
      return toView(row);
    });
  }

  async find(
    orderId: string,
    id: string,
  ): Promise<WebshopOrderShortageView | null> {
    const row = await this.db.webshopOrderShortage.findUnique({
      where: { id },
      include: { lines: true },
    });
    return row && row.orderId === orderId ? toView(row) : null;
  }

  async saveAgreement(
    input: Parameters<WebshopShortageStore["saveAgreement"]>[0],
  ): Promise<WebshopOrderShortageView | null> {
    return this.db.$transaction(async (tx) => {
      const moved = await tx.webshopOrderShortage.updateMany({
        where: { id: input.id, status: { in: input.expect } },
        data: {
          status: "AGREED",
          choice: input.data.choice,
          channel: input.data.channel,
          agreedAt: input.data.agreedAt,
          agreementNote: input.data.note,
        },
      });
      if (moved.count === 0) return null;
      for (const l of input.data.lines)
        await tx.webshopOrderShortageLine.updateMany({
          where: { shortageId: input.id, itemId: l.itemId },
          data: {
            agreedQuantity: l.agreedQuantity,
            replacementVariantId: l.replacementVariantId,
            replacementSku: l.replacementSku,
          },
        });
      const row = await tx.webshopOrderShortage.findUnique({
        where: { id: input.id },
        include: { lines: true },
      });
      if (!row) return null;
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: "webshop-order.shortage-agreed",
          entityType: "WebshopOrder",
          entityId: row.orderId,
          metadata: {
            shortageId: row.id,
            choice: input.data.choice,
            channel: input.data.channel,
            lines: input.data.lines.map((l) => ({
              itemId: l.itemId,
              agreedQuantity: l.agreedQuantity,
              replacementVariantId: l.replacementVariantId,
            })),
          },
        },
      });
      return toView(row);
    });
  }

  async resolve(
    input: Parameters<WebshopShortageStore["resolve"]>[0],
  ): Promise<WebshopOrderShortageView | null> {
    return this.db.$transaction(async (tx) => {
      const moved = await tx.webshopOrderShortage.updateMany({
        where: { id: input.id, status: { in: input.expect } },
        data: {
          status: input.outcome,
          splitOrderId: input.splitOrderId,
          resolutionNote: input.note,
          resolvedAt: input.now,
          resolvedByUserId: input.userId,
        },
      });
      if (moved.count === 0) return null;
      const row = await tx.webshopOrderShortage.findUnique({
        where: { id: input.id },
        include: { lines: true },
      });
      if (!row) return null;
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: "webshop-order.shortage-resolved",
          entityType: "WebshopOrder",
          entityId: row.orderId,
          metadata: {
            shortageId: row.id,
            outcome: input.outcome,
            splitOrderId: input.splitOrderId,
          },
        },
      });
      return toView(row);
    });
  }

  async listByOrder(orderId: string): Promise<WebshopOrderShortageView[]> {
    const rows = await this.db.webshopOrderShortage.findMany({
      where: { orderId },
      orderBy: { detectedAt: "desc" },
      include: { lines: true },
    });
    return rows.map(toView);
  }
}
