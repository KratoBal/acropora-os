import {
  ConflictException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  OrderBusinessStatusService,
  type OrderBusinessStatus,
} from "../order-business-status/order-business-status.service.js";

export interface CarrierShipmentTransaction {
  carrierShipment: { create(args: unknown): Promise<unknown> };
  salesOrder: {
    findUnique(args: unknown): Promise<{
      id: string;
      businessStatus: OrderBusinessStatus;
    } | null>;
    update(args: unknown): Promise<unknown>;
  };
  orderBusinessStatusEvent: { create(args: unknown): Promise<unknown> };
}

export interface CarrierShipmentDatabase {
  $transaction<T>(
    operation: (transaction: CarrierShipmentTransaction) => Promise<T>,
  ): Promise<T>;
}

export const CARRIER_SHIPMENT_DATABASE = Symbol("CARRIER_SHIPMENT_DATABASE");

export interface RecordCarrierShipmentEvent {
  salesOrderId: string;
  carrier: string;
  /** External order key, not an invoice number. */
  orderReference: string;
  parcelNumber: string | null;
  carrierStatus: string;
  statusChangedAt: Date | null;
  businessStatus: OrderBusinessStatus;
}

/**
 * Shared persistence seam for every eventual carrier integration. It accepts
 * carrier status as supplied; no provider API shape or status vocabulary is
 * invented here.
 */
@Injectable()
export class CarrierShipmentService {
  private readonly database: CarrierShipmentDatabase;

  constructor(
    private readonly orderBusinessStatus: OrderBusinessStatusService,
    @Optional()
    @Inject(CARRIER_SHIPMENT_DATABASE)
    database?: CarrierShipmentDatabase,
  ) {
    this.database = database ?? prisma;
  }

  async recordEvent(input: RecordCarrierShipmentEvent): Promise<void> {
    if (!input.carrier.trim()) {
      throw new ConflictException("CARRIER_SHIPMENT_CARRIER_REQUIRED");
    }
    if (!input.orderReference.trim()) {
      throw new ConflictException("CARRIER_SHIPMENT_ORDER_REFERENCE_REQUIRED");
    }
    if (!input.carrierStatus.trim()) {
      throw new ConflictException("CARRIER_SHIPMENT_STATUS_REQUIRED");
    }

    await this.database.$transaction(async (transaction) => {
      await transaction.carrierShipment.create({
        data: {
          salesOrderId: input.salesOrderId,
          carrier: input.carrier,
          orderReference: input.orderReference,
          parcelNumber: input.parcelNumber,
          status: input.carrierStatus,
          statusChangedAt: input.statusChangedAt,
        },
      });
      await this.orderBusinessStatus.change(transaction, {
        orderId: input.salesOrderId,
        toStatus: input.businessStatus,
        source: "CARRIER",
      });
    });
  }
}
