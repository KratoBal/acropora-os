import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { AttendanceController } from "./attendance.controller.js";

/*
  WHAT TURNS THIS RED. A route on anything but attendance.manage (users.manage would hand the sheets to account admins, a
  view right would let a viewer rewrite a sick day); a new route without a decision here; the signed-in user's id not handed
  to the service as the author of a change (the audit row would name nobody).
*/
const prototype = AttendanceController.prototype as unknown as Record<
  string,
  object
>;
const required = (name: string) =>
  Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype[name]!);

describe("AttendanceController", () => {
  it("every route needs attendance.manage", () => {
    const handlers = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== "constructor")
      .sort();
    assert.deepEqual(handlers, [
      "days",
      "deleteDay",
      "deleteSchedule",
      "printForSignature",
      "saveDay",
      "saveSchedule",
      "schedules",
      "sheet",
      "sheetPdf",
      "signedSheetPdf",
    ]);
    for (const name of handlers)
      assert.deepEqual(required(name), [PERMISSIONS.ATTENDANCE_MANAGE], name);
  });

  it("hands the signed-in user's id to every write", async () => {
    const seen: unknown[][] = [];
    const record =
      (name: string) =>
      async (...args: unknown[]) =>
        void seen.push([name, ...args]);
    const controller = new AttendanceController({
      saveSchedule: record("saveSchedule"),
      deleteSchedule: record("deleteSchedule"),
      saveDay: record("saveDay"),
      deleteDay: record("deleteDay"),
    } as never);
    const me = { id: "admin-1" } as never;
    await controller.saveSchedule("u-1", "2026-11-01", { days: [] }, me);
    await controller.deleteSchedule("u-1", "2026-11-01", me);
    await controller.saveDay("u-1", "2026-11-13", { kind: "SICK" }, me);
    await controller.deleteDay("u-1", "2026-11-13", me);
    assert.deepEqual(seen, [
      ["saveSchedule", "u-1", "2026-11-01", [], "admin-1"],
      ["deleteSchedule", "u-1", "2026-11-01", "admin-1"],
      ["saveDay", "u-1", "2026-11-13", { kind: "SICK" }, "admin-1"],
      ["deleteDay", "u-1", "2026-11-13", "admin-1"],
    ]);
  });

  it("hands the signed-in user's id to the print for signature", async () => {
    const seen: unknown[] = [];
    const controller = new AttendanceController({
      printForSignature: async (...args: unknown[]) => {
        seen.push(args.slice(0, 2).concat(args[3]));
        return { bytes: Buffer.from("%PDF-"), fileName: "x.pdf" };
      },
    } as never);
    await controller.printForSignature("u-1", { month: "2026-11" }, {
      id: "admin-1",
    } as never);
    assert.deepEqual(seen, [["u-1", "2026-11", "admin-1"]]);
  });
});
