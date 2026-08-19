import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasPermission, PERMISSIONS } from "@acropora/types";

import {
  normalizeAssigneeIds,
  WORKSHEET_ASSIGNABLE_ROLES,
} from "./worksheet-assignment.js";

describe("WORKSHEET_ASSIGNABLE_ROLES", () => {
  it("lists exactly the roles that may edit a worksheet", () => {
    for (const role of WORKSHEET_ASSIGNABLE_ROLES) {
      assert.equal(hasPermission(role, PERMISSIONS.SERVICE_MANAGE), true);
    }
  });

  it("includes the technician's own role", () => {
    assert.ok(WORKSHEET_ASSIGNABLE_ROLES.includes("SERVICE"));
  });

  // A VIEWER látja a lapot, de nem ír rá. Felelősnek kiosztva megkapná az
  // értesítést, megnyitná a lapot, és nem tudna rögzíteni semmit.
  it("leaves out a role that can only look at the worksheet", () => {
    assert.equal(hasPermission("VIEWER", PERMISSIONS.SERVICE_VIEW), true);
    assert.equal(WORKSHEET_ASSIGNABLE_ROLES.includes("VIEWER"), false);
  });
});

describe("normalizeAssigneeIds", () => {
  it("keeps the same person once", () => {
    assert.deepEqual(normalizeAssigneeIds(["user-1", "user-2", "user-1"]), [
      "user-1",
      "user-2",
    ]);
  });

  it("drops empty and whitespace-only entries", () => {
    assert.deepEqual(normalizeAssigneeIds(["", "  ", "user-1"]), ["user-1"]);
  });

  it("trims, so a stray space does not make a second person", () => {
    assert.deepEqual(normalizeAssigneeIds([" user-1 ", "user-1"]), ["user-1"]);
  });

  it("keeps an empty list empty: taking everyone off is a real intent", () => {
    assert.deepEqual(normalizeAssigneeIds([]), []);
  });
});
