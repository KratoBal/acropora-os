import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { RentalsController } from "./rentals.controller.js";

/*
  WHAT TURNS THIS RED. A read on anything but rentals.view, the recording on anything but rentals.manage (a viewer could then
  hand out a device); a route under settings.manage or customers.view (the sales desk has neither); the signed-in user's id not
  handed to the service on create.
*/
const prototype = RentalsController.prototype as unknown as Record<
  string,
  object
>;
const required = (name: string) =>
  Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype[name]!);

describe("RentalsController", () => {
  it("reads need rentals.view, recording needs rentals.manage", () => {
    const handlers = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== "constructor")
      .sort();
    assert.deepEqual(handlers, [
      "availableEquipment",
      "contract",
      "create",
      "customerMatches",
      "get",
      "list",
    ]);
    for (const name of [
      "availableEquipment",
      "contract",
      "customerMatches",
      "get",
      "list",
    ])
      assert.deepEqual(required(name), [PERMISSIONS.RENTALS_VIEW], name);
    assert.deepEqual(required("create"), [PERMISSIONS.RENTALS_MANAGE]);
  });

  it("hands the signed-in user's id to the service on create", async () => {
    const seen: string[] = [];
    const controller = new RentalsController({
      create: async (_input: unknown, by: string) => void seen.push(by),
    } as never);
    await controller.create({} as never, { id: "u-7" } as never);
    assert.deepEqual(seen, ["u-7"]);
  });
});
