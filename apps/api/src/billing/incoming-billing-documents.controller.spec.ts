import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { IncomingBillingDocumentsController } from "./incoming-billing-documents.controller.js";

/**
 * Recording an incoming invoice is a finance write, not the outgoing invoice
 * right. Since 2026-10-08 SALES holds billing.create (Balázs: sales may issue
 * invoices); if these two routes still asked for it, sales could also record
 * and approve incoming invoices, which that decision does not cover.
 */
describe("incoming invoice review rights", () => {
  for (const handler of ["saveReview", "approveReview"] as const)
    it(`${handler} asks for finance.manage, not billing.create`, () => {
      const required = Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        IncomingBillingDocumentsController.prototype[handler],
      ) as string[] | undefined;
      assert.deepEqual(required, [PERMISSIONS.FINANCE_MANAGE]);
    });
});
