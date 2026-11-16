import { describe, it } from "node:test";

import { assertStrictIsoDates } from "../../testing/strict-iso-date.js";
import { UpdatePurchaseInvoiceDto } from "./update-purchase-invoice.dto.js";

// An impossible day is a 400, not a silent next month (t-20261115-dto-datum-strict): a purchase invoice edit.
describe("strict ISO dates: a purchase invoice edit", () => {
  it("UpdatePurchaseInvoiceDto: expectedUpdatedAt, invoiceDate, dueDate, paidAt", async () => {
    await assertStrictIsoDates(UpdatePurchaseInvoiceDto, [
      "expectedUpdatedAt",
      "invoiceDate",
      "dueDate",
      "paidAt",
    ]);
  });
});
