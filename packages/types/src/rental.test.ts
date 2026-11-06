import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS, ROLE_PERMISSIONS, USER_ROLES } from "./auth.js";
import { rentalFeeHuf, rentalPeriodCount } from "./rental.js";

/*
  WHAT TURNS THIS RED. A started 24 hours not counted (24h + 1 minute must be two periods); a period shorter than a day
  charged as zero; an end before or at the start priced at all; a period across the October clock change counted by
  calendar day instead of real hours; the rental rights reaching a role other than the four agreed (acrobot 44216).
*/
describe("the rental fee", () => {
  const start = "2026-11-06T10:00:00.000Z";

  it("counts started 24-hour periods, at least one", () => {
    assert.equal(rentalPeriodCount(start, "2026-11-06T10:01:00.000Z"), 1);
    assert.equal(rentalPeriodCount(start, "2026-11-07T10:00:00.000Z"), 1);
    assert.equal(rentalPeriodCount(start, "2026-11-07T10:01:00.000Z"), 2);
    assert.equal(rentalFeeHuf(start, "2026-11-09T09:00:00.000Z", 2500), 7500);
  });

  it("prices nothing when the end is not after the start", () => {
    assert.equal(rentalPeriodCount(start, start), null);
    assert.equal(rentalFeeHuf(start, "2026-11-05T10:00:00.000Z", 2500), null);
    assert.equal(rentalFeeHuf(start, "nem dátum", 2500), null);
  });

  it("counts real hours across the clock change", () => {
    // 2026-10-25 03:00 CEST -> 02:00 CET: from Saturday 10:00 to Sunday 10:00 Budapest is 25 hours, so two periods
    assert.equal(
      rentalPeriodCount("2026-10-24T08:00:00.000Z", "2026-10-25T09:00:00.000Z"),
      2,
    );
  });
});

describe("the rental rights", () => {
  it("reach exactly OWNER, ADMIN, MANAGER and SALES", () => {
    for (const permission of [
      PERMISSIONS.RENTALS_VIEW,
      PERMISSIONS.RENTALS_MANAGE,
    ])
      assert.deepEqual(
        USER_ROLES.filter((role) =>
          ROLE_PERMISSIONS[role].includes(permission),
        ),
        ["OWNER", "ADMIN", "MANAGER", "SALES"],
        permission,
      );
  });
});
