import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CUSTOMER_LIST_PAGE_SIZE } from "@acropora/types";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { CustomerListQueryDto } from "./dto/customer.dto.js";

// THE CUSTOMER LIST'S PAGE SIZE BOUNDS ARE SHARED (Balázs on stage,
// 2026-09-30: "a partnerekbol nem talal senkit"). The billing partner picker
// asked for 8 rows, the query validation refused every search with a 400, and
// the picker showed "Nincs találat.". The bounds now live in one constant that
// both the validation and the web callers read. What must fail: the validation
// drifting from the constant in either direction.
describe("the customer list query's page size", () => {
  const errors = (raw: Record<string, string>) =>
    validateSync(plainToInstance(CustomerListQueryDto, raw)).map(
      (error) => error.property,
    );

  it("accepts the shared minimum and maximum", () => {
    assert.deepEqual(
      errors({ search: "Kft", pageSize: String(CUSTOMER_LIST_PAGE_SIZE.min) }),
      [],
    );
    assert.deepEqual(
      errors({ search: "Kft", pageSize: String(CUSTOMER_LIST_PAGE_SIZE.max) }),
      [],
    );
  });

  it("refuses one below the minimum and one above the maximum", () => {
    assert.deepEqual(
      errors({ pageSize: String(CUSTOMER_LIST_PAGE_SIZE.min - 1) }),
      ["pageSize"],
    );
    assert.deepEqual(
      errors({ pageSize: String(CUSTOMER_LIST_PAGE_SIZE.max + 1) }),
      ["pageSize"],
    );
  });

  it("refuses the 8 the billing picker used to send", () => {
    assert.deepEqual(errors({ search: "Kft", pageSize: "8" }), ["pageSize"]);
  });
});
