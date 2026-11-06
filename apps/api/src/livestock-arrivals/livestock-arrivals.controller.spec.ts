import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { LivestockArrivalsController } from "./livestock-arrivals.controller.js";

/*
  WHAT TURNS THIS RED. A write endpoint that asks only for the view permission (anyone who may look could then announce an
  arrival); a read endpoint that needs the manage permission; a DELETE endpoint (a called-off arrival is CANCELLED, the row
  stays as the history); the creator's id not handed to the service.
*/
const required = (method: keyof LivestockArrivalsController) =>
  Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    LivestockArrivalsController.prototype[method],
  );

describe("LivestockArrivalsController", () => {
  it("the reads need inventory.view, the writes inventory.manage", () => {
    for (const method of ["list", "get"] as const)
      assert.deepEqual(required(method), [PERMISSIONS.INVENTORY_VIEW], method);
    for (const method of ["create", "update"] as const)
      assert.deepEqual(
        required(method),
        [PERMISSIONS.INVENTORY_MANAGE],
        method,
      );
  });

  it("has exactly four endpoints and no DELETE", () => {
    const handlers = Object.getOwnPropertyNames(
      LivestockArrivalsController.prototype,
    )
      .filter((name) => name !== "constructor")
      .map((name) => [
        name,
        Reflect.getMetadata(
          "method",
          (
            LivestockArrivalsController.prototype as unknown as Record<
              string,
              object
            >
          )[name]!,
        ),
      ]);
    assert.equal(handlers.length, 4);
    // RequestMethod: GET 0, POST 1, PUT 2, DELETE 3, PATCH 4
    assert.deepEqual(
      handlers.filter(([, method]) => method === 3),
      [],
    );
  });

  it("hands the signed-in user's id to the service on create", async () => {
    const seen: (string | null)[] = [];
    const controller = new LivestockArrivalsController({
      create: async (_input: unknown, by: string | null) => void seen.push(by),
    } as never);
    await controller.create(
      { kind: "FISH", label: "x", expectedOn: "2026-11-20" },
      { id: "u-7" } as never,
    );
    assert.deepEqual(seen, ["u-7"]);
  });
});
