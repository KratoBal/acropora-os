import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";

import type { CustomersRepository } from "../customers/customers.repository.js";
import {
  EquipmentAlreadyRentedError,
  phoneMatchKey,
  RentalsRepository,
  type RentalCreateRow,
} from "./rentals.repository.js";
import { RentalsService } from "./rentals.service.js";

/*
  WHAT TURNS THIS RED. The device's fee, replacement value and accessories not copied onto the rental (a later price change
  would rewrite the contract); the desk's deposit ignored, or the device's lost when none is given; the expected fee not by
  started 24 hours; a rental recorded with both or neither customer; a new customer written although the rental is then refused
  (an end before the start, a retired or rented-out device); the race lost to the index surfacing as a 500 instead of a 409;
  a phone key built from fewer than nine digits.
*/
const equipment = {
  id: "eq-1",
  isActive: true,
  dailyFeeHuf: 2500,
  depositHuf: 30000,
  replacementValueHuf: 120000,
  accessories: "tápegység",
};

function build(options?: {
  equipment?: typeof equipment | null;
  open?: boolean;
  raceLost?: boolean;
  customerLive?: boolean;
}) {
  const created: RentalCreateRow[] = [];
  const newCustomers: unknown[] = [];
  const repository: Partial<RentalsRepository> = {
    equipment: async () =>
      (options?.equipment === undefined
        ? equipment
        : options.equipment) as never,
    hasOpenRental: async () => options?.open ?? false,
    liveCustomer: async (id) =>
      options?.customerLive === false ? null : { id },
    create: async (row) => {
      if (options?.raceLost) throw new EquipmentAlreadyRentedError();
      created.push(row);
      return { id: "r-1" } as never;
    },
  };
  const customers: Partial<CustomersRepository> = {
    create: async (input) => {
      newCustomers.push(input);
      return { id: "c-new" } as never;
    },
  };
  return {
    service: new RentalsService(
      repository as RentalsRepository,
      customers as CustomersRepository,
    ),
    created,
    newCustomers,
  };
}

const base = {
  equipmentId: "eq-1",
  startsAt: "2026-11-06T09:00:00.000Z",
  plannedReturnAt: "2026-11-08T10:00:00.000Z",
};
const newCustomer = {
  type: "PERSON" as const,
  displayName: "Kiss Anna",
  email: "anna@example.com",
  phone: "+36 30 123 4567",
  address: { postalCode: "1111", city: "Budapest", line1: "Fő utca 1." },
};

describe("recording a rental", () => {
  it("copies the device's terms, keeps the desk's deposit, prices started 24 hours", async () => {
    const { service, created } = build();

    await service.create(
      { ...base, customerId: "c-1", depositHuf: 20000 },
      "u-1",
    );

    assert.deepEqual(created, [
      {
        customerId: "c-1",
        equipmentId: "eq-1",
        startsAt: new Date(base.startsAt),
        plannedReturnAt: new Date(base.plannedReturnAt),
        dailyFeeHuf: 2500,
        depositHuf: 20000,
        replacementValueHuf: 120000,
        accessories: "tápegység",
        // 49 hours: three started periods
        expectedFeeHuf: 7500,
        note: null,
        createdById: "u-1",
      },
    ]);
  });

  it("takes the device's deposit when the desk gives none", async () => {
    const { service, created } = build();
    await service.create({ ...base, customerId: "c-1" }, "u-1");
    assert.equal(created[0]?.depositHuf, 30000);
  });

  it("writes a new renter to the customer register with one default billing address", async () => {
    const { service, created, newCustomers } = build();

    await service.create({ ...base, newCustomer }, "u-1");

    assert.equal(created[0]?.customerId, "c-new");
    assert.deepEqual(newCustomers, [
      {
        type: "PERSON",
        displayName: "Kiss Anna",
        companyName: undefined,
        taxNumber: undefined,
        email: "anna@example.com",
        phone: "+36 30 123 4567",
        marketingEmailConsent: false,
        marketingSmsConsent: false,
        addresses: [
          {
            type: "BILLING",
            postalCode: "1111",
            city: "Budapest",
            line1: "Fő utca 1.",
            line2: undefined,
            isDefault: true,
          },
        ],
      },
    ]);
  });

  it("refuses both or neither customer", async () => {
    const { service } = build();
    for (const body of [base, { ...base, customerId: "c-1", newCustomer }])
      await assert.rejects(
        () => service.create(body, "u-1"),
        BadRequestException,
      );
  });

  it("refuses before writing a new customer: bad period, retired or rented-out device", async () => {
    const cases = [
      { options: {}, body: { ...base, plannedReturnAt: base.startsAt } },
      {
        options: {},
        body: { ...base, plannedReturnAt: "2028-01-01T00:00:00.000Z" },
      },
      { options: { equipment: { ...equipment, isActive: false } }, body: base },
      { options: { equipment: null }, body: base },
      { options: { open: true }, body: base },
    ];
    for (const { options, body } of cases) {
      const { service, newCustomers, created } = build(options);
      await assert.rejects(() =>
        service.create({ ...body, newCustomer }, "u-1"),
      );
      assert.deepEqual(newCustomers, [], JSON.stringify(options));
      assert.deepEqual(created, []);
    }
  });

  it("answers the rented-out device with 409, also when the index wins the race", async () => {
    await assert.rejects(
      () =>
        build({ open: true }).service.create(
          { ...base, customerId: "c-1" },
          "u-1",
        ),
      ConflictException,
    );
    await assert.rejects(
      () =>
        build({ raceLost: true }).service.create(
          { ...base, customerId: "c-1" },
          "u-1",
        ),
      ConflictException,
    );
  });

  it("refuses an archived or merged-away customer", async () => {
    await assert.rejects(
      () =>
        build({ customerLive: false }).service.create(
          { ...base, customerId: "c-old" },
          "u-1",
        ),
      BadRequestException,
    );
  });
});

describe("the phone match key", () => {
  it("is the last nine digits, whatever the separators", () => {
    for (const raw of ["+36 30 123 4567", "06-30/123-4567", "301234567"])
      assert.equal(phoneMatchKey(raw), "301234567", raw);
    for (const raw of ["123 4567", "", null, undefined])
      assert.equal(phoneMatchKey(raw), null, String(raw));
  });
});
