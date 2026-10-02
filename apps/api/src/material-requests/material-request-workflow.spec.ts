import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  applyItemReceipts,
  availableActions,
  itemArrived,
  parseQuantityValue,
  receiveAllItems,
  statusFromItems,
  type WorkflowActor,
  type WorkflowItem,
  type WorkflowRequest,
} from "./material-request-workflow.js";

const d = (value: string) => new Prisma.Decimal(value);
const now = new Date("2026-10-02T10:00:00.000Z");

const technician: WorkflowActor = {
  id: "tech",
  role: "SERVICE",
  canHandle: false,
};
const purchaser: WorkflowActor = {
  id: "buyer",
  role: "SERVICE",
  canHandle: true,
};
const otherPurchaser: WorkflowActor = {
  id: "buyer-2",
  role: "WAREHOUSE",
  canHandle: true,
};
const manager: WorkflowActor = {
  id: "boss",
  role: "MANAGER",
  canHandle: false,
};

const request = (over: Partial<WorkflowRequest> = {}): WorkflowRequest => ({
  status: "OPEN",
  requestedById: "tech",
  handlerId: null,
  ...over,
});

const allowed = (r: WorkflowRequest, a: WorkflowActor) =>
  Object.entries(availableActions(r, a))
    .filter(([, ok]) => ok)
    .map(([action]) => action)
    .sort();

describe("the V2 state machine", () => {
  it("a DRAFT can do nothing but be submitted (no claim, no comment)", () => {
    for (const actor of [technician, purchaser, manager])
      assert.deepEqual(allowed(request({ status: "DRAFT" }), actor), []);
  });

  it("OPEN: a capability holder or a leader may claim; the requester or a leader may cancel", () => {
    assert.deepEqual(allowed(request(), purchaser), ["claim", "comment"]);
    assert.deepEqual(allowed(request(), manager), [
      "cancel",
      "claim",
      "comment",
    ]);
    assert.deepEqual(allowed(request(), technician), ["cancel", "comment"]);
  });

  it("IN_PROGRESS: the handler orders, receives directly (the skip) or reassigns; only the requester or a leader cancels", () => {
    const r = request({ status: "IN_PROGRESS", handlerId: "buyer" });
    assert.deepEqual(allowed(r, purchaser), [
      "comment",
      "order",
      "reassign",
      "receive",
    ]);
    assert.deepEqual(allowed(r, manager), [
      "cancel",
      "comment",
      "order",
      "reassign",
      "receive",
    ]);
    // another purchaser is not the handler: no state change
    assert.deepEqual(allowed(r, otherPurchaser), ["comment"]);
    // the requester may still withdraw before ordering
    assert.deepEqual(allowed(r, technician), ["cancel", "comment"]);
  });

  it("ORDERED and PARTIALLY_RECEIVED: receive items or all; never cancel, never order again", () => {
    for (const status of ["ORDERED", "PARTIALLY_RECEIVED"] as const) {
      const r = request({ status, handlerId: "buyer" });
      assert.deepEqual(allowed(r, purchaser), [
        "comment",
        "reassign",
        "receive",
        "receiveItems",
      ]);
      assert.deepEqual(allowed(r, technician), ["comment"]);
    }
  });

  it("RECEIVED and CANCELLED are terminal: nothing but comments", () => {
    for (const status of ["RECEIVED", "CANCELLED"] as const)
      for (const actor of [purchaser, manager, technician])
        assert.deepEqual(
          allowed(request({ status, handlerId: "buyer" }), actor),
          ["comment"],
        );
  });

  it("there is no way back: no action on any state leads to an earlier one", () => {
    // order is only from IN_PROGRESS, claim only from OPEN, receiveItems never from IN_PROGRESS
    for (const status of [
      "ORDERED",
      "PARTIALLY_RECEIVED",
      "RECEIVED",
      "CANCELLED",
    ] as const)
      assert.equal(
        availableActions(request({ status, handlerId: "buyer" }), manager)
          .order,
        false,
      );
    for (const status of ["IN_PROGRESS", "ORDERED", "RECEIVED"] as const)
      assert.equal(
        availableActions(request({ status, handlerId: null }), manager).claim,
        false,
      );
    assert.equal(
      availableActions(
        request({ status: "IN_PROGRESS", handlerId: "buyer" }),
        purchaser,
      ).receiveItems,
      false,
      "partial receiving needs an order first",
    );
  });
});

describe("the quantity rule (the same as the migration's backfill)", () => {
  it("plain numbers parse, with a comma or a point", () => {
    assert.equal(parseQuantityValue("10"), "10");
    assert.equal(parseQuantityValue(" 2,5 "), "2.5");
    assert.equal(parseQuantityValue("1.500"), "1.5");
    assert.equal(parseQuantityValue("0"), "0");
  });

  it("anything else stays text", () => {
    for (const text of [
      "10 méter",
      "kb 10",
      "2-3",
      "",
      "-1",
      "1,2345",
      "1234567890",
      "1e3",
    ])
      assert.equal(parseQuantityValue(text), null, text);
  });
});

const numeric = (
  id: string,
  qty: string,
  received: string | null = null,
): WorkflowItem => ({
  id,
  quantityValue: d(qty),
  receivedQuantity: received === null ? null : d(received),
  receivedAt: null,
});
const text = (id: string, at: Date | null = null): WorkflowItem => ({
  id,
  quantityValue: null,
  receivedQuantity: null,
  receivedAt: at,
});

describe("item-level receiving", () => {
  it("a partial quantity is partial; the full one arrives", () => {
    const step = applyItemReceipts(
      [numeric("a", "14"), text("b")],
      [{ itemId: "a", receivedQuantity: "12" }],
      now,
    );
    assert.ok(step.ok);
    if (!step.ok) return;
    assert.equal(statusFromItems(step.items), "PARTIALLY_RECEIVED");
    assert.equal(itemArrived(step.items[0]!), false);
    const done = applyItemReceipts(
      step.items,
      [
        { itemId: "a", receivedQuantity: "14" },
        { itemId: "b", arrived: true },
      ],
      now,
    );
    assert.ok(done.ok);
    if (!done.ok) return;
    assert.equal(statusFromItems(done.items), "RECEIVED");
    assert.equal(done.items[0]!.receivedAt?.toISOString(), now.toISOString());
  });

  it("decimal, never float: 0,1 + 0,2 reaches 0,3", () => {
    const step = applyItemReceipts(
      [numeric("a", "0.3", "0.1")],
      [{ itemId: "a", receivedQuantity: "0,3" }],
      now,
    );
    assert.ok(step.ok);
    if (step.ok) assert.equal(statusFromItems(step.items), "RECEIVED");
  });

  it("a received quantity may not go down, and nothing-changes is refused", () => {
    const down = applyItemReceipts(
      [numeric("a", "10", "5")],
      [{ itemId: "a", receivedQuantity: "4" }],
      now,
    );
    assert.equal(down.ok, false);
    const same = applyItemReceipts(
      [numeric("a", "10", "5")],
      [{ itemId: "a", receivedQuantity: "5" }],
      now,
    );
    assert.equal(same.ok, false);
    const marked = applyItemReceipts(
      [text("b", now)],
      [{ itemId: "b", arrived: true }],
      now,
    );
    assert.equal(marked.ok, false);
  });

  it("a text item takes only the mark, a numeric item only a number", () => {
    assert.equal(
      applyItemReceipts(
        [text("b")],
        [{ itemId: "b", receivedQuantity: "3" }],
        now,
      ).ok,
      false,
    );
    assert.equal(
      applyItemReceipts(
        [numeric("a", "3")],
        [{ itemId: "a", arrived: true }],
        now,
      ).ok,
      false,
    );
    assert.equal(
      applyItemReceipts(
        [numeric("a", "3")],
        [{ itemId: "x", receivedQuantity: "3" }],
        now,
      ).ok,
      false,
    );
  });

  it("receive all completes every remaining item, and leaves arrived ones alone", () => {
    const earlier = new Date("2026-10-01T00:00:00.000Z");
    const r = receiveAllItems(
      [numeric("a", "14", "12"), text("b", earlier), text("c")],
      now,
    );
    assert.deepEqual(r.changedItemIds, ["a", "c"]);
    assert.equal(statusFromItems(r.items), "RECEIVED");
    assert.equal(r.items[1]!.receivedAt, earlier);
    assert.equal(r.items[0]!.receivedQuantity?.toString(), "14");
  });

  it("nothing received yet implies no receiving status", () => {
    assert.equal(statusFromItems([numeric("a", "2"), text("b")]), null);
  });
});
