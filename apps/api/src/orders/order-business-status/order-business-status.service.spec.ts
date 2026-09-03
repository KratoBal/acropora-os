import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OrderBusinessStatusService } from "./order-business-status.service.js";

function transaction(
  status: "PENDING_FULFILLMENT" | "SHIPPING" | "CLOSED_UNSUCCESSFULLY",
) {
  const events: unknown[] = [];
  const updates: unknown[] = [];
  return {
    database: {
      salesOrder: {
        findUnique: async () => ({ id: "order-1", businessStatus: status }),
        update: async (args: unknown) => updates.push(args),
      },
      orderBusinessStatusEvent: {
        create: async (args: unknown) => events.push(args),
      },
    },
    events,
    updates,
  };
}

describe("OrderBusinessStatusService", () => {
  it("moves pending fulfillment to confirmed before stocking", async () => {
    const fixture = transaction("PENDING_FULFILLMENT");
    await new OrderBusinessStatusService().change(fixture.database, {
      orderId: "order-1",
      toStatus: "CONFIRMED",
      source: "USER",
      actorUserId: "user-1",
    });
    assert.equal(fixture.updates.length, 1);
  });

  it("allows an operator to close a shipping order", async () => {
    const fixture = transaction("SHIPPING");
    await new OrderBusinessStatusService().change(fixture.database, {
      orderId: "order-1",
      toStatus: "CLOSED",
      source: "USER",
      actorUserId: "user-1",
    });

    assert.equal(fixture.updates.length, 1);
    assert.deepEqual(fixture.events, [
      {
        data: {
          orderId: "order-1",
          fromStatus: "SHIPPING",
          toStatus: "CLOSED",
          source: "USER",
          actorUserId: "user-1",
          note: null,
        },
      },
    ]);
  });

  it("rejects shipping directly to ready for pickup", async () => {
    const fixture = transaction("SHIPPING");
    await assert.rejects(
      () =>
        new OrderBusinessStatusService().change(fixture.database, {
          orderId: "order-1",
          toStatus: "READY_FOR_PICKUP",
          source: "USER",
          actorUserId: "user-1",
        }),
      { message: "ORDER_STATUS_TRANSITION_FORBIDDEN" },
    );
    assert.equal(fixture.updates.length, 0);
    assert.equal(fixture.events.length, 0);
  });

  it("returns an unsuccessfully closed order to pending fulfillment", async () => {
    const fixture = transaction("CLOSED_UNSUCCESSFULLY");
    await new OrderBusinessStatusService().change(fixture.database, {
      orderId: "order-1",
      toStatus: "PENDING_FULFILLMENT",
      source: "USER",
      actorUserId: "user-1",
    });
    assert.equal(fixture.updates.length, 1);
  });
});
