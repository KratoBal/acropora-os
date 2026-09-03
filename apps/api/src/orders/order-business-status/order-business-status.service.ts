import { ConflictException, Injectable } from "@nestjs/common";

export const ORDER_BUSINESS_STATUSES = [
  "PENDING_FULFILLMENT",
  "CONFIRMED",
  "STOCKING",
  "SHIPPING",
  "READY_FOR_PICKUP",
  "CLOSED",
  "CLOSED_UNSUCCESSFULLY",
] as const;

export type OrderBusinessStatus = (typeof ORDER_BUSINESS_STATUSES)[number];
export type OrderBusinessStatusEventSource = "USER" | "UNAS_SYNC" | "CARRIER";

const allowedTransitions: Readonly<
  Record<OrderBusinessStatus, readonly OrderBusinessStatus[]>
> = {
  PENDING_FULFILLMENT: ["CONFIRMED", "CLOSED_UNSUCCESSFULLY"],
  CONFIRMED: ["PENDING_FULFILLMENT", "STOCKING", "CLOSED_UNSUCCESSFULLY"],
  STOCKING: [
    "CONFIRMED",
    "SHIPPING",
    "READY_FOR_PICKUP",
    "CLOSED_UNSUCCESSFULLY",
  ],
  SHIPPING: ["CLOSED", "CLOSED_UNSUCCESSFULLY"],
  READY_FOR_PICKUP: ["CLOSED", "CLOSED_UNSUCCESSFULLY"],
  CLOSED: [],
  // A téves lezárás javítható, de csak a folyamat elejére visszavive: így
  // nincs "félúton feltámasztott" rendelés és van ismét áttekinthető útja.
  CLOSED_UNSUCCESSFULLY: ["PENDING_FULFILLMENT"],
};

export interface OrderBusinessStatusTransaction {
  salesOrder: {
    findUnique(args: unknown): Promise<{
      id: string;
      businessStatus: OrderBusinessStatus;
    } | null>;
    update(args: unknown): Promise<unknown>;
  };
  orderBusinessStatusEvent: {
    create(args: unknown): Promise<unknown>;
  };
}

export interface ChangeOrderBusinessStatus {
  orderId: string;
  toStatus: OrderBusinessStatus;
  source: OrderBusinessStatusEventSource;
  actorUserId?: string;
  note?: string;
}

/// The sole business-status write path. A future carrier callback and the
/// eventual email dispatcher attach after this method's transaction commits;
/// neither receives a second way to edit the status.
@Injectable()
export class OrderBusinessStatusService {
  async change(
    transaction: OrderBusinessStatusTransaction,
    command: ChangeOrderBusinessStatus,
  ): Promise<void> {
    if (command.source === "USER" && !command.actorUserId) {
      throw new ConflictException("ORDER_STATUS_ACTOR_REQUIRED");
    }
    if (command.source !== "USER" && command.actorUserId) {
      throw new ConflictException("ORDER_STATUS_SYSTEM_ACTOR_FORBIDDEN");
    }

    const order = await transaction.salesOrder.findUnique({
      where: { id: command.orderId },
      select: { id: true, businessStatus: true },
    });
    if (!order) throw new ConflictException("ORDER_STATUS_ORDER_NOT_FOUND");
    if (order.businessStatus === command.toStatus) return;
    if (!allowedTransitions[order.businessStatus].includes(command.toStatus)) {
      throw new ConflictException("ORDER_STATUS_TRANSITION_FORBIDDEN");
    }

    await transaction.salesOrder.update({
      where: { id: order.id },
      data: { businessStatus: command.toStatus },
    });
    await transaction.orderBusinessStatusEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.businessStatus,
        toStatus: command.toStatus,
        source: command.source,
        actorUserId: command.actorUserId ?? null,
        note: command.note ?? null,
      },
    });
  }
}
