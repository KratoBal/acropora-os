import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import {
  RentalSettingsController,
  RentalSettingsService,
  SaveRentalSettingsDto,
} from "./rental-settings.js";

/*
  WHAT TURNS THIS RED. A template with an unknown place saved (it would print as a hole in the contract); the refusal not
  naming the place; a null refused where it means "built-in text" or "not set yet"; a multiplier of 0 or with three decimals,
  or a fractional day count, accepted; the settings reachable on anything but settings.manage.
*/
const errors = (plain: unknown) =>
  validateSync(plainToInstance(SaveRentalSettingsDto, plain)).map(
    (e) => e.property,
  );

describe("saving the rental settings", () => {
  it("refuses an unknown place by name, before touching the database", async () => {
    await assert.rejects(
      () =>
        new RentalSettingsService().save(
          {
            contractTemplate: "Hely: {{kelt_hely}}, bérlő: {{berlo_nev}}",
            lateFeeMultiplier: null,
            replacementAfterDays: null,
          },
          "u-1",
        ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("{{kelt_hely}}") &&
        !error.message.includes("{{berlo_nev}}"),
    );
  });

  it("takes nulls, and refuses out-of-range numbers", () => {
    assert.deepEqual(
      errors({
        contractTemplate: null,
        lateFeeMultiplier: null,
        replacementAfterDays: null,
      }),
      [],
    );
    assert.deepEqual(
      errors({
        contractTemplate: "x",
        lateFeeMultiplier: "1.5",
        replacementAfterDays: "14",
      }),
      [],
    );
    for (const lateFeeMultiplier of [0, 1.255, 11])
      assert.deepEqual(
        errors({
          contractTemplate: null,
          lateFeeMultiplier,
          replacementAfterDays: null,
        }),
        ["lateFeeMultiplier"],
        String(lateFeeMultiplier),
      );
    assert.deepEqual(
      errors({
        contractTemplate: "",
        lateFeeMultiplier: null,
        replacementAfterDays: 2.5,
      }),
      ["contractTemplate", "replacementAfterDays"],
    );
  });

  it("is reachable on settings.manage only", () => {
    const prototype = RentalSettingsController.prototype as unknown as Record<
      string,
      object
    >;
    for (const name of ["get", "save"])
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype[name]!),
        [PERMISSIONS.SETTINGS_MANAGE],
        name,
      );
  });
});
