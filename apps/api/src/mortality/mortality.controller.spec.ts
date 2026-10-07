import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { MortalityController } from "./mortality.controller.js";

function required(method: keyof MortalityController) {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    MortalityController.prototype[method],
  );
}

describe("MortalityController jogkörei", () => {
  it("az olvasó végpontok mortality.view-t kérnek", () => {
    for (const method of [
      "list",
      "summary",
      "productOptions",
      "aquariumOptions",
      "supplierOptions",
      "recorderOptions",
      "locationOptions",
      "detail",
      "downloadPhoto",
    ] as const)
      assert.deepEqual(required(method), [PERMISSIONS.MORTALITY_VIEW], method);
  });

  it("az író végpontok mortality.manage-et kérnek", () => {
    for (const method of ["create", "update", "uploadPhotos"] as const)
      assert.deepEqual(
        required(method),
        [PERMISSIONS.MORTALITY_MANAGE],
        method,
      );
  });

  it("nincs DELETE végpont (törlés nincs, acrobot 27141)", () => {
    const handlers = Object.getOwnPropertyNames(MortalityController.prototype)
      .filter((name) => name !== "constructor")
      .map((name) => [
        name,
        Reflect.getMetadata(
          "method",
          (MortalityController.prototype as unknown as Record<string, object>)[
            name
          ]!,
        ),
      ]);
    // RequestMethod: GET 0, POST 1, PUT 2, DELETE 3, PATCH 4
    assert.equal(handlers.length, 12);
    assert.deepEqual(
      handlers.filter(([, method]) => method === 3),
      [],
    );
  });
});
