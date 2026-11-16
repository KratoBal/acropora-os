import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
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
  for (const handler of [
    "saveReview",
    "approveReview",
    "correctNumber",
  ] as const)
    it(`${handler} asks for finance.manage, not billing.create`, () => {
      const required = Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        IncomingBillingDocumentsController.prototype[handler],
      ) as string[] | undefined;
      assert.deepEqual(required, [PERMISSIONS.FINANCE_MANAGE]);
    });
});

// acrobot 49617: the number correction's input guards stand before any database call
describe("incoming number correction input", () => {
  const controller = Object.create(
    IncomingBillingDocumentsController.prototype,
  ) as IncomingBillingDocumentsController;
  const user = { id: "user-1" } as never;
  it("refuses a day that does not exist and a number of spaces, with 400", async () => {
    await assert.rejects(
      controller.correctNumber(
        "row-1",
        { documentNumber: "R1", issueDate: "2026-02-30" },
        user,
      ),
      BadRequestException,
    );
    await assert.rejects(
      controller.correctNumber(
        "row-1",
        { documentNumber: "   ", issueDate: "2026-11-06" },
        user,
      ),
      BadRequestException,
    );
  });
});
