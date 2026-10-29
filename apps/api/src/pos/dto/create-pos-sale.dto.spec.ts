import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreatePosSaleDto } from "./create-pos-sale.dto.js";

/*
  CASH_DESK (the "Kassza" button) is its own payment method next to CASH (the
  "Pénztárgép" button). What turns this red: the DTO refusing CASH_DESK (the
  button would answer 400), or accepting a value outside the enum.
  Only paymentMethod's own errors are read: the lines are not this spec's
  question.
*/
async function paymentMethodErrors(paymentMethod: unknown) {
  const errors = await validate(
    plainToInstance(CreatePosSaleDto, { paymentMethod, lines: [] }),
  );
  return errors
    .filter((error) => error.property === "paymentMethod")
    .flatMap((error) => Object.keys(error.constraints ?? {}));
}

describe("CreatePosSaleDto paymentMethod", () => {
  it("accepts every POS payment method, CASH_DESK included", async () => {
    for (const method of ["CASH", "CARD", "TRANSFER", "CASH_DESK"]) {
      assert.deepEqual(await paymentMethodErrors(method), [], method);
    }
  });

  it("refuses a value outside the enum", async () => {
    assert.deepEqual(await paymentMethodErrors("KASSZA"), ["isIn"]);
    assert.deepEqual(await paymentMethodErrors("cash_desk"), ["isIn"]);
  });
});
