import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import {
  CreateRentalEquipmentDto,
  RentalEquipmentListQueryDto,
  UpdateRentalEquipmentDto,
} from "./dto/rental-equipment.dto.js";

/*
  WHAT TURNS THIS RED. `?includeInactive=false` read as true (the list would show exactly what was asked to hide); a negative,
  fractional or hundred-million-plus amount accepted (a slipped digit on a deposit); a missing amount or name accepted on create;
  an explicit null refused on update where it means "clear it" (serial, accessories, note).
*/
const errors = <T extends object>(cls: new () => T, plain: unknown) =>
  validateSync(plainToInstance(cls, plain)).flatMap((e) =>
    Object.keys(e.constraints ?? {}).map((c) => `${e.property}:${c}`),
  );

describe("the list query", () => {
  it("reads includeInactive from text, false included", () => {
    const no = plainToInstance(RentalEquipmentListQueryDto, {
      includeInactive: "false",
    });
    const yes = plainToInstance(RentalEquipmentListQueryDto, {
      includeInactive: "true",
    });
    assert.equal(no.includeInactive, false);
    assert.equal(yes.includeInactive, true);
    assert.deepEqual(validateSync(no), []);
  });
});

describe("the create body", () => {
  const ok = {
    name: "Ozmózis víztisztító",
    dailyFeeHuf: 2500,
    depositHuf: 30000,
    replacementValueHuf: 120000,
  };

  it("takes the minimal body and the full one, amounts as text too", () => {
    assert.deepEqual(errors(CreateRentalEquipmentDto, ok), []);
    assert.deepEqual(
      errors(CreateRentalEquipmentDto, {
        ...ok,
        dailyFeeHuf: "2500",
        serialNumber: "SN-1",
        accessories: "tápegység, 2 tömlő",
        note: "a bal oldali csap szorul",
      }),
      [],
    );
  });

  it("refuses a missing name or amount", () => {
    assert.deepEqual(errors(CreateRentalEquipmentDto, { ...ok, name: "" }), [
      "name:minLength",
    ]);
    for (const key of [
      "dailyFeeHuf",
      "depositHuf",
      "replacementValueHuf",
    ] as const) {
      const { [key]: _gone, ...rest } = ok;
      assert.ok(
        errors(CreateRentalEquipmentDto, rest).some((e) =>
          e.startsWith(`${key}:`),
        ),
        key,
      );
    }
  });

  it("refuses a negative, fractional or oversized amount, and keeps both edges", () => {
    for (const bad of [-1, 2.5, 100_000_001])
      assert.ok(
        errors(CreateRentalEquipmentDto, { ...ok, depositHuf: bad }).length > 0,
        String(bad),
      );
    for (const edge of [0, 100_000_000])
      assert.deepEqual(
        errors(CreateRentalEquipmentDto, { ...ok, depositHuf: edge }),
        [],
        String(edge),
      );
  });
});

describe("a blank amount (barracuda, #2270 review)", () => {
  it("is refused, not stored as 0 Ft, on create and on update", () => {
    const ok = {
      name: "Ozmózis víztisztító",
      dailyFeeHuf: 2500,
      depositHuf: 30000,
      replacementValueHuf: 120000,
    };
    for (const blank of ["", "  "]) {
      assert.ok(
        errors(CreateRentalEquipmentDto, { ...ok, dailyFeeHuf: blank }).some(
          (e) => e.startsWith("dailyFeeHuf:"),
        ),
        JSON.stringify(blank),
      );
      assert.ok(
        errors(UpdateRentalEquipmentDto, { depositHuf: blank }).some((e) =>
          e.startsWith("depositHuf:"),
        ),
        JSON.stringify(blank),
      );
    }
  });
});

describe("the update body", () => {
  it("takes an empty body and nulls on the three optional texts", () => {
    assert.deepEqual(errors(UpdateRentalEquipmentDto, {}), []);
    assert.deepEqual(
      errors(UpdateRentalEquipmentDto, {
        serialNumber: null,
        accessories: null,
        note: null,
      }),
      [],
    );
  });

  it("refuses a null name or amount, and a non-boolean isActive", () => {
    assert.ok(errors(UpdateRentalEquipmentDto, { name: null }).length > 0);
    assert.ok(
      errors(UpdateRentalEquipmentDto, { dailyFeeHuf: null }).length > 0,
    );
    assert.ok(errors(UpdateRentalEquipmentDto, { dailyFeeHuf: -5 }).length > 0);
    assert.ok(
      errors(UpdateRentalEquipmentDto, { isActive: "false" }).length > 0,
    );
  });
});
