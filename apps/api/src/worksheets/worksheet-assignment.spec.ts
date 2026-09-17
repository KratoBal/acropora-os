import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasPermission, PERMISSIONS } from "@acropora/types";

import {
  normalizeAssigneeIds,
  WORKSHEET_ASSIGNABLE_ROLES,
} from "./worksheet-assignment.js";

describe("WORKSHEET_ASSIGNABLE_ROLES", () => {
  /**
   * A NEV 2026-09-17-EN MEGVALTOZOTT, ES EZ NEM KOZMETIKA. Az allitas eddig azt
   * hivta magat, hogy "exactly the roles that may edit a worksheet" -- a lista
   * viszont MAR NEM az: a `PARTNER_SERVICE` szerepnek megvan a joga, es MEGSEM
   * kioszthato, mert nem a mi kollegank. Egy nev, ami tobbet allit, mint amit a
   * teszt mer, ugyanugy megteveszt, mint egy elirt darabszam.
   *
   * A SZUKITES INDOKA es a partner-kizaras merese a kozos modul sajat
   * spec-jeben all (`common/service-assignment.spec.ts`).
   */
  it("minden listázott szerep tud is dolgozni a lapon", () => {
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
