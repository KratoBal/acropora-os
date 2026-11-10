import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { DEFAULT_RENTAL_CONTRACT_TEMPLATE } from "./rental-contract-default.js";
import { RENTAL_SETTING_ID, RentalSettingsService } from "./rental-settings.js";
import {
  EquipmentAlreadyRentedError,
  RentalsRepository,
  type RentalCreateRow,
} from "./rentals.repository.js";

/*
  ON A REAL POSTGRES. WHAT TURNS THIS RED: the partial unique index missing (a second OPEN rental of the same device stored)
  or too wide (a device that came back cannot be rented again); the contract's frozen text or settings not stored (S3); its violation not recognised as "already rented" (a 500 at
  the desk); a rented-out device still offered; the customer match missing a phone written another way, an e-mail in other
  case or a name without accents, or offering an archived row.
*/
const gate = integrationDatabaseGate(process.env);
const PREFIX = "RENTAL-IT-";

async function removeLeftovers() {
  await prisma.rental.deleteMany({
    where: { equipment: { name: { startsWith: PREFIX } } },
  });
  await prisma.rentalEquipment.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

describe("rentals on Postgres", { skip: gate.mode === "skip" }, () => {
  const repository = new RentalsRepository();
  const n = Date.now() % 1_000_000;
  let equipmentId = "";
  let customerId = "";

  const row = (): RentalCreateRow => ({
    customerId,
    equipmentId,
    startsAt: new Date("2026-11-06T09:00:00.000Z"),
    plannedReturnAt: new Date("2026-11-08T09:00:00.000Z"),
    dailyFeeHuf: 2500,
    depositHuf: 30000,
    replacementValueHuf: 120000,
    contractTemplate: "Szöveg {{kesedelmi_szorzo}}",
    lateFeeMultiplier: 1.25,
    replacementAfterDays: 9,
    accessories: null,
    expectedFeeHuf: 5000,
    note: null,
    createdById: null,
  });

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    equipmentId = (
      await prisma.rentalEquipment.create({
        data: {
          name: `${PREFIX}ozmózis`,
          dailyFeeHuf: 2500,
          depositHuf: 30000,
          replacementValueHuf: 120000,
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${n}`,
          type: "PERSON",
          displayName: `Rentális Árpád ${n}`,
          phone: "06-30/555-1234",
          email: `Arpad.${n}@Example.com`,
        },
      })
    ).id;
    await prisma.customer.create({
      data: {
        customerNumber: `${PREFIX}${n}-arch`,
        type: "PERSON",
        displayName: `Rentális Árpád ${n} régi`,
        phone: "06-30/555-1234",
        archivedAt: new Date(),
      },
    });
  });
  after(async () => {
    if (gate.mode === "run") {
      await removeLeftovers();
      await prisma.rentalSetting.deleteMany({
        where: { id: RENTAL_SETTING_ID },
      });
    }
  });

  it("stores the settings, and keeps the built-in text as NULL so its later fixes still arrive", async () => {
    const settings = new RentalSettingsService();
    await prisma.rentalSetting.deleteMany({ where: { id: RENTAL_SETTING_ID } });
    assert.equal((await settings.get()).contractTemplateIsDefault, true);

    const saved = await settings.save(
      {
        contractTemplate: "Bérlő: {{berlo_nev}}",
        lateFeeMultiplier: 1.5,
        replacementAfterDays: 14,
      },
      "u-1",
    );
    assert.deepEqual(saved, {
      contractTemplate: "Bérlő: {{berlo_nev}}",
      contractTemplateIsDefault: false,
      lateFeeMultiplier: 1.5,
      replacementAfterDays: 14,
    });

    await settings.save(
      {
        contractTemplate: DEFAULT_RENTAL_CONTRACT_TEMPLATE,
        lateFeeMultiplier: null,
        replacementAfterDays: null,
      },
      "u-1",
    );
    const row = await prisma.rentalSetting.findUnique({
      where: { id: RENTAL_SETTING_ID },
    });
    assert.equal(row?.contractTemplate, null);
    assert.equal(row?.lateFeeMultiplier, null);
    assert.equal((await settings.get()).contractTemplateIsDefault, true);
  });

  it("refuses a second OPEN rental of the same device, and allows one after the return", async () => {
    const first = await repository.create(row());
    assert.match(first.rentalNumber, /^BER/);
    // the contract as agreed is stored on the rental, the multiplier with its decimals
    assert.equal(first.lateFeeMultiplier, 1.25);
    assert.equal(first.replacementAfterDays, 9);
    assert.equal(
      await repository.contractTemplateOf(first.id),
      "Szöveg {{kesedelmi_szorzo}}",
    );

    await assert.rejects(
      () => repository.create(row()),
      EquipmentAlreadyRentedError,
    );
    assert.equal(
      (await repository.availableEquipment()).some((e) => e.id === equipmentId),
      false,
    );

    await prisma.rental.update({
      where: { id: first.id },
      data: { status: "RETURNED", returnedAt: new Date() },
    });
    const second = await repository.create(row());
    assert.notEqual(second.id, first.id);
  });

  it("removes a new renter only while it has no rental, with its address", async () => {
    const orphan = await prisma.customer.create({
      data: {
        customerNumber: `${PREFIX}${n}-orphan`,
        type: "PERSON",
        displayName: "Árva Bérlő",
        addresses: {
          create: [
            {
              type: "BILLING",
              postalCode: "1111",
              city: "Bp",
              line1: "Fő u. 1.",
            },
          ],
        },
      },
    });
    await repository.removeUnusedNewCustomer(orphan.id);
    assert.equal(await prisma.customer.count({ where: { id: orphan.id } }), 0);

    // the renter of the earlier test has rentals: untouched
    await repository.removeUnusedNewCustomer(customerId);
    assert.equal(await prisma.customer.count({ where: { id: customerId } }), 1);
  });

  it("matches a customer by phone, e-mail or name, live rows only", async () => {
    for (const query of [
      { phone: "+36 30 555 1234" },
      { email: `arpad.${n}@example.com` },
      { name: `rentalis arpad ${n}` },
    ]) {
      const found = await repository.customerMatches(query);
      assert.deepEqual(
        found.map((c) => c.id),
        [customerId],
        JSON.stringify(query),
      );
    }
    assert.deepEqual(
      await repository.customerMatches({ phone: "555 1234" }),
      [],
    );
  });
});
