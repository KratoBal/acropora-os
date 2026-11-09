import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { CreateRentalDto } from "./dto/rental.dto.js";

/*
  WHAT TURNS THIS RED. A new renter accepted without phone, e-mail or a full address (Balázs: all of them are needed); a date
  that is not an ISO instant accepted; a negative or fractional deposit accepted.
*/
const errors = (plain: unknown) =>
  validateSync(plainToInstance(CreateRentalDto, plain)).flatMap(
    function flat(e): string[] {
      return [
        ...Object.keys(e.constraints ?? {}).map((c) => `${e.property}:${c}`),
        ...(e.children ?? []).flatMap(flat).map((x) => `${e.property}.${x}`),
      ];
    },
  );

const base = {
  equipmentId: "eq-1",
  startsAt: "2026-11-06T09:00:00.000Z",
  plannedReturnAt: "2026-11-08T09:00:00.000Z",
};
const renter = {
  type: "PERSON",
  displayName: "Kiss Anna",
  email: "anna@example.com",
  phone: "+36 30 123 4567",
  address: { postalCode: "1111", city: "Budapest", line1: "Fő utca 1." },
};

describe("the rental body", () => {
  it("takes an existing customer, or a complete new renter", () => {
    assert.deepEqual(errors({ ...base, customerId: "c-1" }), []);
    assert.deepEqual(errors({ ...base, newCustomer: renter }), []);
    assert.deepEqual(
      errors({ ...base, customerId: "c-1", depositHuf: "20000" }),
      [],
    );
  });

  it("refuses a new renter without phone, e-mail or full address", () => {
    for (const [key, value] of [
      ["phone", " "],
      ["email", "nem-email"],
      ["displayName", "  "],
    ] as const)
      assert.ok(
        errors({ ...base, newCustomer: { ...renter, [key]: value } }).some(
          (e) => e.startsWith(`newCustomer.${key}:`),
        ),
        key,
      );
    for (const key of ["postalCode", "city", "line1"] as const)
      assert.ok(
        errors({
          ...base,
          newCustomer: { ...renter, address: { ...renter.address, [key]: "" } },
        }).some((e) => e.startsWith(`newCustomer.address.${key}:`)),
        key,
      );
    const { address: _gone, ...noAddress } = renter;
    assert.ok(errors({ ...base, newCustomer: noAddress }).length > 0);
  });

  it("refuses a non-instant date and a bad deposit", () => {
    assert.ok(
      errors({ ...base, customerId: "c", startsAt: "holnap" }).length > 0,
    );
    for (const depositHuf of [-1, 2.5])
      assert.ok(errors({ ...base, customerId: "c", depositHuf }).length > 0);
  });
});
