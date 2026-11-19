import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { WebshopOrdersController } from "./webshop-orders.controller.js";

const required = (handler: keyof WebshopOrdersController) =>
  Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    WebshopOrdersController.prototype[handler],
  ) as string[] | undefined;

/**
 * Since 2026-10-08 SALES holds billing.issue (Balázs: sales may issue
 * invoices). Issuing from an order stays on that right; recording a received
 * transfer is a payment, so it asks for finance.manage, which SALES does not
 * hold.
 */
describe("webshop order billing rights", () => {
  it("issuing an invoice or a delivery note asks for billing.issue", () => {
    for (const handler of ["issueInvoice", "issueDeliveryNote"] as const)
      assert.deepEqual(
        required(handler),
        [PERMISSIONS.ORDERS_MANAGE, PERMISSIONS.BILLING_ISSUE],
        handler,
      );
  });

  it("recording a received transfer asks for finance.manage, not billing.issue", () => {
    for (const handler of [
      "recordTransferReceived",
      "syncTransferToShop",
    ] as const)
      assert.deepEqual(
        required(handler),
        [PERMISSIONS.ORDERS_MANAGE, PERMISSIONS.FINANCE_MANAGE],
        handler,
      );
  });
});

/*
  A KISZÁLLÍTÁSI KAPU FELÜLBÍRÁLÁSÁNAK JOGA A VÉGPONTON (kártya 33a0d3c7). MI PIROSÍT: ha a váltás végpontja a felülbírálás jogát nem a
  kérő jogából veszi (mindenkinél igaz vagy hamis), vagy az indok nem jut el a szolgáltatásig; ha a végpont jogot kér a felülbírálás
  helyett a rendelés-kezelés mellé (a váltás maga ugyanaz maradt: orders.manage).
*/
describe("webshop order status change: the shipping gate override", () => {
  const user = (role: "OWNER" | "ADMIN" | "MANAGER" | "SALES") =>
    ({
      id: `${role}-user`,
      email: "x@acropora.hu",
      displayName: role,
      role,
      customerId: null,
      supplierId: null,
    }) as AuthenticatedUser;

  const call = (as: AuthenticatedUser, overrideReason?: string) => {
    const seen: unknown[][] = [];
    const orders = {
      changeStatus: async (...args: unknown[]) => void seen.push(args),
    };
    // the other nine services are not touched by this handler
    const controller = new (
      WebshopOrdersController as unknown as new (
        orders: unknown,
      ) => WebshopOrdersController
    )(orders);
    void controller.changeStatus(
      "order_38",
      { status: "out_for_delivery", overrideReason } as never,
      as,
    );
    return seen[0]!;
  };

  it("the endpoint still needs only orders.manage: the override is decided by the service from the caller's own right", () => {
    assert.deepEqual(required("changeStatus"), [PERMISSIONS.ORDERS_MANAGE]);
  });

  it("the owner and the admin may override; the manager and sales may not", () => {
    for (const [role, can] of [
      ["OWNER", true],
      ["ADMIN", true],
      ["MANAGER", false],
      ["SALES", false],
    ] as const) {
      const args = call(user(role), "Csomag a portálon feladva");
      assert.deepEqual(
        (args[5] as { canOverride: boolean }).canOverride,
        can,
        role,
      );
    }
  });

  it("the reason reaches the service as the caller wrote it", () => {
    const args = call(user("OWNER"), "Csomag a portálon feladva");
    assert.equal(
      (args[5] as { overrideReason?: string }).overrideReason,
      "Csomag a portálon feladva",
    );
  });
});
