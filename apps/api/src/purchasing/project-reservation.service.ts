import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import {
  enqueueStockSyncOutboxEntry,
  lockVariantWarehouse,
  OUTBOX_BASELINE_UNKNOWN_NOTE,
  type InventoryMovementDatabase,
} from "../common/inventory-movement-writer.js";
import { availableToSell } from "../inventory/available-to-sell.js";

type Tx = Prisma.TransactionClient;

/** Why a hold ended: by hand, or with its project. */
export type ReservationReleaseReason = "MANUAL" | "PROJECT_CLOSED";

/**
 * RELEASING A PROJECT'S HOLD ON STOCK (#1582 P5a), the one place it happens:
 * the reservation becomes RELEASED, the stock row's `reserved` goes down by
 * its quantity, and for a product the UNAS catalogue owns, the shop's free
 * stock is queued again (`PROJECT_RESERVATION`, B2 RESOLVED). Nothing moves
 * physically: `onHand` stays.
 *
 * Under the same advisory lock the stock postings take, in (variant,
 * warehouse) order, so a sale or a receipt at the same moment sees either the
 * old or the new `reserved`, never half. A row already released (two clicks,
 * or the close racing a manual release) is skipped by the conditional update,
 * not released twice.
 *
 * The free stock the shop gets is `availableToSell` (onHand − reserved), the
 * one formula. A variant whose shop baseline was never known keeps the
 * stock writer's guard: the row is queued and closed as DEAD_LETTER, so no
 * absolute built on an invented zero is published.
 */
export async function releaseReservations(
  tx: Tx,
  where: { projectId: string; reservationIds?: string[] },
  actorUserId: string,
  reason: ReservationReleaseReason,
): Promise<string[]> {
  const rows = await tx.projectInventoryReservation.findMany({
    where: {
      projectId: where.projectId,
      status: "ACTIVE",
      ...(where.reservationIds ? { id: { in: where.reservationIds } } : {}),
    },
    select: {
      id: true,
      projectId: true,
      stockItemId: true,
      variantId: true,
      warehouseId: true,
      quantity: true,
      variant: {
        select: { sku: true, product: { select: { catalogAuthority: true } } },
      },
    },
  });
  // the stock writer's lock order: by variant, then warehouse
  rows.sort((a, b) =>
    a.variantId === b.variantId
      ? a.warehouseId.localeCompare(b.warehouseId)
      : a.variantId.localeCompare(b.variantId),
  );
  const released: string[] = [];
  const now = new Date();
  for (const row of rows) {
    await lockVariantWarehouse(tx, row.variantId, row.warehouseId);
    const claimed = await tx.projectInventoryReservation.updateMany({
      where: { id: row.id, status: "ACTIVE" },
      data: { status: "RELEASED", releasedAt: now },
    });
    if (claimed.count !== 1) continue;
    const stock = await tx.stockItem.update({
      where: { id: row.stockItemId },
      data: { reserved: { decrement: row.quantity } },
      select: { onHand: true, reserved: true },
    });
    released.push(row.id);
    await tx.domainEvent.create({
      data: {
        id: randomUUID(),
        eventType: "project_inventory.released",
        aggregateType: "ProjectInventoryReservation",
        aggregateId: row.id,
        actorUserId,
        payload: {
          projectId: row.projectId,
          variantId: row.variantId,
          warehouseId: row.warehouseId,
          quantity: row.quantity.toString(),
          reason,
        },
        occurredAt: now,
        schemaVersion: 1,
      },
    });
    if (row.variant.product.catalogAuthority !== "UNAS") continue;
    const unresolvedBaseline = await tx.unasStockSyncOutbox.findFirst({
      where: {
        variantId: row.variantId,
        warehouseId: row.warehouseId,
        resolutionNote: OUTBOX_BASELINE_UNKNOWN_NOTE,
        status: "DEAD_LETTER",
      },
      select: { id: true },
    });
    const enqueued = await enqueueStockSyncOutboxEntry(
      tx as unknown as InventoryMovementDatabase,
      {
        variantId: row.variantId,
        warehouseId: row.warehouseId,
        sku: row.variant.sku,
        targetOnHand: availableToSell(stock),
        idempotencyKey: `PROJECT_RESERVATION_RELEASE:${row.id}:${row.variantId}`,
        sourceProcess: "PROJECT_RESERVATION",
        sourceRecordId: row.id,
      },
    );
    if (unresolvedBaseline)
      await tx.unasStockSyncOutbox.update({
        where: { id: enqueued.id },
        data: {
          status: "DEAD_LETTER",
          leaseExpiresAt: null,
          resolutionNote: OUTBOX_BASELINE_UNKNOWN_NOTE,
          processedAt: new Date(),
        },
      });
  }
  return released;
}

const CLOSING = new Set(["COMPLETED", "CANCELLED"]);

@Injectable()
export class ProjectReservationService {
  private readonly database = prisma;

  /** One hold, by hand. A 409 when it is not active (any more). */
  async release(
    projectId: string,
    reservationId: string,
    actorUserId: string,
  ): Promise<{ released: number }> {
    const released = await this.database.$transaction(async (tx) => {
      const exists = await tx.projectInventoryReservation.findFirst({
        where: { id: reservationId, projectId },
        select: { status: true },
      });
      if (!exists)
        throw new NotFoundException(
          "A foglalás nem található ennél a projektnél.",
        );
      const ids = await releaseReservations(
        tx,
        { projectId, reservationIds: [reservationId] },
        actorUserId,
        "MANUAL",
      );
      if (!ids.length) throw new ConflictException("Ez a foglalás már nem él.");
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "project_inventory.released",
          entityType: "Project",
          entityId: projectId,
          metadata: { reservationIds: ids, reason: "MANUAL" },
        },
      });
      return ids.length;
    });
    return { released };
  }

  /**
   * The project closes (completed or cancelled): its status changes and
   * every active hold it has ends in the same transaction.
   */
  async close(
    projectId: string,
    status: string,
    actorUserId: string,
  ): Promise<{ released: number }> {
    if (!CLOSING.has(status))
      throw new BadRequestException(
        "A projekt csak befejezettként vagy töröltként zárható le.",
      );
    const released = await this.database.$transaction(async (tx) => {
      const closed = await tx.project.updateMany({
        where: {
          id: projectId,
          status: { in: ["DRAFT", "ACTIVE", "ON_HOLD"] },
        },
        data: { status: status as "COMPLETED" | "CANCELLED" },
      });
      if (closed.count !== 1) {
        const exists = await tx.project.count({ where: { id: projectId } });
        if (!exists) throw new NotFoundException("A projekt nem található.");
        throw new ConflictException("A projekt már le van zárva.");
      }
      const ids = await releaseReservations(
        tx,
        { projectId },
        actorUserId,
        "PROJECT_CLOSED",
      );
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "project.closed",
          entityType: "Project",
          entityId: projectId,
          metadata: { status, releasedReservationIds: ids },
        },
      });
      return ids.length;
    });
    return { released };
  }
}
