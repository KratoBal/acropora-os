import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { RentalEquipmentController } from "./rental-equipment.controller.js";

/*
  WHAT TURNS THIS RED. Any endpoint on a right other than settings.manage (the menu entry `rental-equipment` asks for that one;
  split, the button shows to someone who may not call it, or the reverse); a DELETE endpoint (a piece is retired, rentals will
  point at it).
*/
const prototype = RentalEquipmentController.prototype as unknown as Record<
  string,
  object
>;
const handlers = Object.getOwnPropertyNames(prototype).filter(
  (name) => name !== "constructor",
);

describe("RentalEquipmentController", () => {
  it("every endpoint needs settings.manage", () => {
    assert.deepEqual(handlers.sort(), ["create", "list", "update"]);
    for (const name of handlers)
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype[name]!),
        [PERMISSIONS.SETTINGS_MANAGE],
        name,
      );
  });

  it("has no DELETE", () => {
    // RequestMethod: GET 0, POST 1, PUT 2, DELETE 3, PATCH 4
    assert.deepEqual(
      handlers.filter(
        (name) => Reflect.getMetadata("method", prototype[name]!) === 3,
      ),
      [],
    );
  });
});
