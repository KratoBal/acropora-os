import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OrderBusinessStatusService } from "../order-business-status/order-business-status.service.js";
import {
  CarrierShipmentService,
  type CarrierShipmentDatabase,
  type CarrierShipmentTransaction,
} from "./carrier-shipment.service.js";

class Fixture implements CarrierShipmentDatabase, CarrierShipmentTransaction {
  shipmentWrites: unknown[] = [];
  statusEvents: Array<{ source: string }> = [];
  businessStatus: "STOCKING" | "SHIPPING" = "STOCKING";

  carrierShipment = {
    create: async (args: unknown) => {
      this.shipmentWrites.push(args);
      return {};
    },
  };

  salesOrder = {
    findUnique: async () => ({
      id: "order-1",
      businessStatus: this.businessStatus,
    }),
    update: async (args: { data: { businessStatus: "SHIPPING" } }) => {
      this.businessStatus = args.data.businessStatus;
      return {};
    },
  };

  orderBusinessStatusEvent = {
    create: async (args: { data: { source: string } }) => {
      this.statusEvents.push({ source: args.data.source });
      return {};
    },
  };

  async $transaction<T>(
    operation: (transaction: CarrierShipmentTransaction) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }
}

describe("CarrierShipmentService", () => {
  it("records the order key and changes business status through the CARRIER source", async () => {
    const fixture = new Fixture();
    const service = new CarrierShipmentService(
      new OrderBusinessStatusService(),
      fixture,
    );

    await service.recordEvent({
      salesOrderId: "order-1",
      carrier: "GLS",
      orderReference: "UNAS-ORDER-42",
      parcelNumber: "PARCEL-42",
      carrierStatus: "accepted",
      statusChangedAt: new Date("2026-09-07T12:00:00.000Z"),
      businessStatus: "SHIPPING",
    });

    assert.deepEqual(fixture.shipmentWrites, [
      {
        data: {
          salesOrderId: "order-1",
          carrier: "GLS",
          orderReference: "UNAS-ORDER-42",
          parcelNumber: "PARCEL-42",
          status: "accepted",
          statusChangedAt: new Date("2026-09-07T12:00:00.000Z"),
        },
      },
    ]);
    assert.equal(fixture.businessStatus, "SHIPPING");
    assert.deepEqual(fixture.statusEvents, [{ source: "CARRIER" }]);
  });
});
