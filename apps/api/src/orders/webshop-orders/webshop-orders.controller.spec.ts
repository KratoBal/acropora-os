import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "@acropora/types";

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
