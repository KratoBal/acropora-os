import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { PurchaseInvoiceListQueryDto } from "./dto/purchase-invoice-list-query.dto.js";
import { purchaseInvoiceListWhere } from "./purchase-invoice.repository.js";

// THE PURCHASING LIST'S FILTERS (Direction F, Balázs's purchasing brief,
// 2026-09-30, point 5: source and payment state next to the search). What
// must fail: a filter that is ignored, "open" read as paid, a filter that
// drops the search, or a query string value outside the known ones accepted.
describe("the purchasing list filter", () => {
  it("no filter: no condition, as before", () => {
    assert.deepEqual(purchaseInvoiceListWhere({}), {});
  });

  it("source and payment state narrow the list, and keep the search", () => {
    const where = purchaseInvoiceListWhere({
      search: "TM-2026",
      source: "HU_NAV",
      payment: "open",
    });
    assert.equal(where.source, "HU_NAV");
    assert.equal(where.isPaid, false);
    assert.equal(where.OR?.length, 3);
  });

  it("paid is paid", () => {
    assert.equal(purchaseInvoiceListWhere({ payment: "paid" }).isPaid, true);
  });

  it("the query string accepts only the known values", () => {
    const errors = (raw: Record<string, string>) =>
      validateSync(plainToInstance(PurchaseInvoiceListQueryDto, raw)).map(
        (error) => error.property,
      );
    assert.deepEqual(errors({ source: "EU", payment: "paid" }), []);
    assert.deepEqual(errors({ source: "HU" }), ["source"]);
    // a boolean-looking value is not a payment filter
    assert.deepEqual(errors({ payment: "false" }), ["payment"]);
  });
});
