import { describe, it } from "node:test";

import { assertStrictIsoDates } from "../../testing/strict-iso-date.js";
import { CreatePurchaseInvoiceDto } from "./create-purchase-invoice.dto.js";

// An impossible day is a 400, not a silent next month (t-20261115-dto-datum-strict): a new purchase invoice.
describe("strict ISO dates: a new purchase invoice", () => {
  it("CreatePurchaseInvoiceDto: invoiceDate, dueDate, paidAt", async () => {
    await assertStrictIsoDates(CreatePurchaseInvoiceDto, [
      "invoiceDate",
      "dueDate",
      "paidAt",
    ]);
  });
});
