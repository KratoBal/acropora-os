import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  RentalEquipmentDuplicateSerialError,
  RentalEquipmentRepository,
} from "./rental-equipment.repository.js";

/*
  ON A REAL POSTGRES. WHAT TURNS THIS RED: the serial's unique index missing (two devices with the same serial both stored);
  the index refusing a second device WITHOUT a serial (a NOT NULL or an empty-string default would do that); the list showing
  a retired device by default, or hiding it when asked for all.
*/
const gate = integrationDatabaseGate(process.env);
const PREFIX = "RENTEQ-IT-";

const row = (name: string, serialNumber: string | null) => ({
  name: `${PREFIX}${name}`,
  serialNumber,
  dailyFeeHuf: 2500,
  depositHuf: 30000,
  replacementValueHuf: 120000,
  accessories: null,
  note: null,
});

async function removeLeftovers() {
  await prisma.rentalEquipment.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
}

describe(
  "the rental equipment master on Postgres",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new RentalEquipmentRepository();
    const n = Date.now() % 1_000_000;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });
    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("refuses a second device with the same serial", async () => {
      await repository.create(row("a", `${PREFIX}SN-${n}`));
      await assert.rejects(
        () => repository.create(row("b", `${PREFIX}SN-${n}`)),
        RentalEquipmentDuplicateSerialError,
      );
    });

    it("stores two devices without a serial", async () => {
      await repository.create(row("c", null));
      await repository.create(row("d", null));
      const count = await prisma.rentalEquipment.count({
        where: { name: { startsWith: PREFIX }, serialNumber: null },
      });
      assert.equal(count, 2);
    });

    it("lists a retired device only when asked for all", async () => {
      const retired = await repository.create(row("e", null));
      await repository.update(retired.id, { isActive: false });

      const active = await repository.list(false);
      const all = await repository.list(true);

      assert.equal(
        active.some((item) => item.id === retired.id),
        false,
      );
      assert.equal(
        all.some((item) => item.id === retired.id),
        true,
      );
    });
  },
);
