import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";

import type { Rental } from "@acropora/types";

import type { CustomersRepository } from "../customers/customers.repository.js";
import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";
import {
  EquipmentAlreadyRentedError,
  phoneMatchKey,
  RentalsRepository,
  type RentalCreateRow,
  type RentalReturnRow,
} from "./rentals.repository.js";
import type { RentalSettingsService } from "./rental-settings.js";
import { RentalsService } from "./rentals.service.js";

/*
  WHAT TURNS THIS RED. The device's fee, replacement value and accessories not copied onto the rental (a later price change
  would rewrite the contract); the desk's deposit ignored, or the device's lost when none is given; the expected fee not by
  started 24 hours; a rental recorded with both or neither customer; a new customer written although the rental is then refused
  (an end before the start, a retired or rented-out device); the race lost to the index surfacing as a 500 instead of a 409;
  a phone key built from fewer than nine digits. The contract (S3): the text and the late-return settings in force at recording
  not frozen on the rental, or a reprint reading today's Settings instead of them (barracuda, #2360). On the return (S4): the
  fee or the surcharge taken from anything but the rule and the rental's own frozen settings (today's Settings must not reach
  an agreed rental); a surcharge invented while no multiplier was agreed; more deposit kept than given, or kept without a
  reason; a reason kept with nothing kept; a return in the future or before the start; a second return over the first (409,
  not a new settlement).
*/
const TODAY = {
  contractTemplate: "MAI {{kesedelmi_szorzo}}",
  contractTemplateIsDefault: false,
  lateFeeMultiplier: 1.5,
  replacementAfterDays: 14,
};
const settingsToday = {
  get: async () => TODAY,
} as unknown as RentalSettingsService;
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
  const removed: string[] = [];
  const newCustomers: unknown[] = [];
  const repository: Partial<RentalsRepository> = {
    equipment: async () =>
      (options?.equipment === undefined
        ? equipment
        : options.equipment) as never,
    hasOpenRental: async () => options?.open ?? false,
    liveCustomer: async (id) =>
      options?.customerLive === false ? null : { id },
    removeUnusedNewCustomer: async (id) => void removed.push(id),
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
      settingsToday,
    ),
    created,
    newCustomers,
    removed,
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
        // the contract as agreed today, frozen on the rental
        contractTemplate: "MAI {{kesedelmi_szorzo}}",
        lateFeeMultiplier: 1.5,
        replacementAfterDays: 14,
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

  it("removes the renter it just created when the index wins the race, and only that one", async () => {
    const lost = build({ raceLost: true });
    await assert.rejects(
      () => lost.service.create({ ...base, newCustomer }, "u-1"),
      ConflictException,
    );
    assert.deepEqual(lost.removed, ["c-new"]);

    const existing = build({ raceLost: true });
    await assert.rejects(
      () => existing.service.create({ ...base, customerId: "c-1" }, "u-1"),
      ConflictException,
    );
    assert.deepEqual(existing.removed, []);
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

describe("printing the contract (S3)", () => {
  const agreed = {
    id: "r-1",
    rentalNumber: "BER-1",
    status: "OPEN",
    equipment: { id: "eq-1", name: "Ozmózis", serialNumber: null },
    customer: {
      id: "c-1",
      customerNumber: "VEVO-1",
      displayName: "Kiss Anna",
      phone: null,
      email: null,
      address: null,
    },
    startsAt: "2026-11-10T09:00:00.000Z",
    plannedReturnAt: "2026-11-11T09:00:00.000Z",
    dailyFeeHuf: 1000,
    depositHuf: 10000,
    replacementValueHuf: 50000,
    // nothing was set when the rental was recorded
    lateFeeMultiplier: null,
    replacementAfterDays: null,
    accessories: null,
    expectedFeeHuf: 1000,
    note: null,
    returnedAt: null,
    createdAt: "2026-11-10T09:00:00.000Z",
  } as Rental;

  const print = async (frozen: string | null) => {
    const repository: Partial<RentalsRepository> = {
      byId: async () => agreed,
      contractTemplateOf: async () => frozen,
    };
    const service = new RentalsService(
      repository as RentalsRepository,
      {} as CustomersRepository,
      settingsToday,
    );
    // printed three days later, after Settings changed
    const { bytes } = await service.contract(
      "r-1",
      new Date("2026-11-13T10:00:00.000Z"),
    );
    return (await readPdfTextLines(bytes)).map((l) => l.text).join("\n");
  };

  it("reprints the text and settings frozen at recording, dated on the rental's day, not today's", async () => {
    const text = await print("KORI {{kesedelmi_szorzo}} Kelt: {{kelt_datum}}");
    assert.ok(
      text.includes("KORI [még nincs megadva] Kelt: 2026. 11. 10."),
      text,
    );
    assert.ok(!text.includes("MAI"), text);
    assert.ok(!text.includes("1,5"), text);
  });

  it("prints today's text only for a rental recorded before the text was frozen", async () => {
    const text = await print(null);
    assert.ok(text.includes("MAI [még nincs megadva]"), text);
  });
});

describe("taking a rental back (S4)", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  const open = {
    id: "r-1",
    status: "OPEN",
    startsAt: "2026-11-06T10:00:00.000Z",
    plannedReturnAt: "2026-11-08T10:00:00.000Z",
    dailyFeeHuf: 2000,
    depositHuf: 30000,
    replacementValueHuf: 120000,
  } as Rental;

  function backDesk(options?: {
    rental?: Rental;
    multiplier?: number | null;
    alreadyReturned?: boolean;
  }) {
    const writes: RentalReturnRow[] = [];
    const agreed = {
      ...open,
      lateFeeMultiplier:
        options?.multiplier === undefined ? 2 : options.multiplier,
      replacementAfterDays: 3,
    };
    const repository: Partial<RentalsRepository> = {
      byId: async () => options?.rental ?? agreed,
      markReturned: async (_id, row) => {
        if (options?.alreadyReturned) return false;
        writes.push(row);
        return true;
      },
    };
    // today's Settings differ from what the rental agreed, and must not reach it
    const settings = {
      get: async () => ({
        contractTemplate: "",
        contractTemplateIsDefault: true,
        lateFeeMultiplier: 3,
        replacementAfterDays: 30,
      }),
    };
    return {
      service: new RentalsService(
        repository as RentalsRepository,
        {} as CustomersRepository,
        settings as RentalSettingsService,
      ),
      writes,
    };
  }

  it("records the fee of the actual time and the surcharge with the multiplier the rental agreed, not today's", async () => {
    const { service, writes } = backDesk();
    await service.returnRental(
      "r-1",
      { depositKeptHuf: 5000, depositKeptReason: "hiányzó tápegység" },
      "u-2",
      now,
    );
    // 4 days 2 hours out: 5 periods; 2 days 2 hours late: 3 late periods, each 2000 * (2 - 1) on top
    assert.deepEqual(writes, [
      {
        returnedAt: now,
        finalFeeHuf: 10000,
        lateSurchargeHuf: 6000,
        depositKeptHuf: 5000,
        depositKeptReason: "hiányzó tápegység",
        returnedById: "u-2",
      },
    ]);
  });

  it("charges no surcharge when the rental agreed no multiplier, even if one is set today; the preview gives the agreed days", async () => {
    const { service, writes } = backDesk({ multiplier: null });
    const preview = await service.returnPreview("r-1", undefined, now);
    assert.equal(preview.settlement.lateSurchargeHuf, null);
    assert.equal(preview.settlement.latePeriods, 3);
    assert.equal(preview.replacementAfterDays, 3);
    await service.returnRental("r-1", { depositKeptHuf: 0 }, "u-2", now);
    assert.equal(writes[0]?.lateSurchargeHuf, null);
    assert.equal(writes[0]?.finalFeeHuf, 10000);
  });

  it("refuses more than the deposit, or a kept amount with no reason; drops a reason with nothing kept", async () => {
    for (const input of [
      { depositKeptHuf: 30001, depositKeptReason: "sérült" },
      { depositKeptHuf: 100 },
    ]) {
      const { service, writes } = backDesk();
      await assert.rejects(
        () => service.returnRental("r-1", input, "u-2", now),
        BadRequestException,
        JSON.stringify(input),
      );
      assert.deepEqual(writes, []);
    }
    const { service, writes } = backDesk();
    await service.returnRental(
      "r-1",
      { depositKeptHuf: 0, depositKeptReason: "semmi" },
      "u-2",
      now,
    );
    assert.equal(writes[0]?.depositKeptReason, null);
  });

  it("refuses a return in the future or before the start, and takes the desk's earlier time", async () => {
    for (const returnedAt of [
      "2026-11-10T12:06:00.000Z",
      "2026-11-06T09:00:00.000Z",
    ]) {
      const { service, writes } = backDesk();
      await assert.rejects(
        () =>
          service.returnRental(
            "r-1",
            { returnedAt, depositKeptHuf: 0 },
            "u-2",
            now,
          ),
        BadRequestException,
        returnedAt,
      );
      assert.deepEqual(writes, []);
    }
    const { service, writes } = backDesk();
    await service.returnRental(
      "r-1",
      { returnedAt: "2026-11-08T09:00:00.000Z", depositKeptHuf: 0 },
      "u-2",
      now,
    );
    // on time: 47 hours are two periods, nothing late
    assert.equal(writes[0]?.finalFeeHuf, 4000);
    assert.equal(writes[0]?.lateSurchargeHuf, 0);
  });

  it("answers a rental already taken back with 409, before and after the conditional write", async () => {
    await assert.rejects(
      () =>
        backDesk({
          rental: { ...open, status: "RETURNED" },
        }).service.returnRental("r-1", { depositKeptHuf: 0 }, "u-2", now),
      ConflictException,
    );
    await assert.rejects(
      () =>
        backDesk({ alreadyReturned: true }).service.returnRental(
          "r-1",
          { depositKeptHuf: 0 },
          "u-2",
          now,
        ),
      ConflictException,
    );
  });
});
