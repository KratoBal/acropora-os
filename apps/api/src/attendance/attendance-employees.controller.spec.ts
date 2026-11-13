import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { AttendanceEmployeesController } from "./attendance-employees.controller.js";

/*
  WHAT TURNS THIS RED. The picker behind users.manage (attendance.manage alone would not reach the sheets, barracuda on
  #2501) or behind anything else; a new route here without a decision.
*/
describe("AttendanceEmployeesController", () => {
  it("lists the employees under attendance.manage", () => {
    const prototype =
      AttendanceEmployeesController.prototype as unknown as Record<
        string,
        object
      >;
    assert.deepEqual(
      Object.getOwnPropertyNames(prototype).filter((n) => n !== "constructor"),
      ["employees"],
    );
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype.employees!),
      [PERMISSIONS.ATTENDANCE_MANAGE],
    );
  });
});
