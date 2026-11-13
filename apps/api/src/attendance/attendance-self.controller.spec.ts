import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { AttendanceSelfController } from "./attendance-self.controller.js";

/*
  WHAT TURNS THIS RED. A route taking the employee from the path or the body instead of the signed-in user (anyone could
  mark someone else's leave); a right demanded on the employee's own sheet (an ordinary colleague has none); a new route here
  without a decision.
*/
describe("AttendanceSelfController", () => {
  const prototype = AttendanceSelfController.prototype as unknown as Record<
    string,
    object
  >;

  it("asks no right, and has exactly these routes", () => {
    const handlers = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== "constructor")
      .sort();
    assert.deepEqual(handlers, ["clearDay", "markDay", "sheet"]);
    for (const name of handlers)
      assert.equal(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype[name]!),
        undefined,
        name,
      );
  });

  it("acts on the signed-in user only", async () => {
    const seen: unknown[][] = [];
    const record =
      (name: string) =>
      async (...args: unknown[]) =>
        void seen.push([name, ...args.filter((a) => typeof a === "string")]);
    const controller = new AttendanceSelfController({
      sheet: record("sheet"),
      markOwnDay: record("markOwnDay"),
      clearOwnDay: record("clearOwnDay"),
    } as never);
    const me = { id: "u-7" } as never;
    await controller.sheet({ month: "2026-11" }, me);
    await controller.markDay("2026-11-20", { kind: "LEAVE" }, me);
    await controller.clearDay("2026-11-20", me);
    assert.deepEqual(seen, [
      ["sheet", "u-7", "2026-11"],
      ["markOwnDay", "u-7", "2026-11-20", "LEAVE"],
      ["clearOwnDay", "u-7", "2026-11-20"],
    ]);
  });
});
