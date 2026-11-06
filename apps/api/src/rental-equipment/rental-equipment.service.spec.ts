import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";

import {
  RentalEquipmentDuplicateSerialError,
  RentalEquipmentRepository,
  type RentalEquipmentWrite,
} from "./rental-equipment.repository.js";
import { RentalEquipmentService } from "./rental-equipment.service.js";

/*
  WHAT TURNS THIS RED. A blank serial stored as "" (the second device without a serial would then collide on the unique
  index); an untrimmed name; a field missing from the request written anyway (a PATCH of the fee would wipe the accessories);
  a duplicate serial surfacing as a 500; a missing row answered with anything but 404.

  The stub takes the real repository's type, so a signature change there is a compile error here.
*/
type UpdateInput = Parameters<RentalEquipmentRepository["update"]>[1];

function build(options?: { duplicate?: boolean; exists?: boolean }) {
  const created: RentalEquipmentWrite[] = [];
  const updated: UpdateInput[] = [];
  const repository: Pick<
    RentalEquipmentRepository,
    "list" | "create" | "update"
  > = {
    list: async () => [],
    create: async (input) => {
      if (options?.duplicate) throw new RentalEquipmentDuplicateSerialError();
      created.push(input);
      return { id: "eq-1", isActive: true, ...input };
    },
    update: async (_id, input) => {
      if (options?.duplicate) throw new RentalEquipmentDuplicateSerialError();
      updated.push(input);
      if (options?.exists === false) return null;
      return {
        id: "eq-1",
        name: "x",
        serialNumber: null,
        dailyFeeHuf: 1,
        depositHuf: 1,
        replacementValueHuf: 1,
        accessories: null,
        note: null,
        isActive: true,
        ...input,
      };
    },
  };
  return {
    service: new RentalEquipmentService(
      repository as RentalEquipmentRepository,
    ),
    created,
    updated,
  };
}

const body = {
  name: "  Ozmózis víztisztító ",
  dailyFeeHuf: 2500,
  depositHuf: 30000,
  replacementValueHuf: 120000,
};

describe("the rental equipment master", () => {
  it("R1: trims the name and stores blank optional texts as null", async () => {
    const { service, created } = build();

    await service.create({
      ...body,
      serialNumber: "   ",
      accessories: "",
      note: " tömlő hiányzik ",
    });

    assert.deepEqual(created, [
      {
        name: "Ozmózis víztisztító",
        serialNumber: null,
        dailyFeeHuf: 2500,
        depositHuf: 30000,
        replacementValueHuf: 120000,
        accessories: null,
        note: "tömlő hiányzik",
      },
    ]);
  });

  it("R2: a name of only spaces is a 400, before the database", async () => {
    const { service, created } = build();

    await assert.rejects(
      () => service.create({ ...body, name: "   " }),
      BadRequestException,
    );
    assert.deepEqual(created, []);
  });

  it("R3: a duplicate serial is a 400 that names the retired list", async () => {
    const { service } = build({ duplicate: true });

    await assert.rejects(
      () => service.create({ ...body, serialNumber: "SN-1" }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /kivezetettek/i.test(error.message),
    );
  });

  it("R4: an update writes only the fields sent, and null clears a text", async () => {
    const { service, updated } = build();

    await service.update("eq-1", { dailyFeeHuf: 3000, accessories: null });
    await service.update("eq-1", { isActive: false });

    assert.deepEqual(updated, [
      { dailyFeeHuf: 3000, accessories: null },
      { isActive: false },
    ]);
  });

  it("R5: CONTROL: a missing row is a 404", async () => {
    const { service } = build({ exists: false });

    await assert.rejects(
      () => service.update("nope", { name: "x" }),
      NotFoundException,
    );
  });
});
