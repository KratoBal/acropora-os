import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS, ROLE_PERMISSIONS, USER_ROLES } from "./auth.js";
import { rentalFeeHuf, rentalPeriodCount, rentalSettlement } from "./rental.js";

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

describe("the settlement of a return (S4)", () => {
  const base = {
    startsAt: "2026-11-01T10:00:00Z",
    plannedReturnAt: "2026-11-04T10:00:00Z",
    dailyFeeHuf: 2000,
    lateFeeMultiplier: 2,
    replacementAfterDays: 5,
  };

  it("on time or early: the started periods of the ACTUAL time, no surcharge, no flag", () => {
    assert.deepEqual(
      rentalSettlement({ ...base, returnedAt: "2026-11-03T09:00:00Z" }),
      {
        periods: 2,
        feeHuf: 4000,
        latePeriods: 0,
        lateSurchargeHuf: 0,
        lateFeeMultiplier: null,
        replacementClaimable: false,
      },
    );
  });

  it("late: the late periods are rental days, and the surcharge makes each one daily fee times the multiplier", () => {
    // 3 planned + 2 started late periods = 5 periods; surcharge 2 * 2000 * (2 - 1)
    assert.deepEqual(
      rentalSettlement({ ...base, returnedAt: "2026-11-05T11:00:00Z" }),
      {
        periods: 5,
        feeHuf: 10000,
        latePeriods: 2,
        lateSurchargeHuf: 4000,
        lateFeeMultiplier: 2,
        replacementClaimable: false,
      },
    );
  });

  it("no multiplier set: the surcharge is null (not charged, not guessed); the fee for the time out still counts", () => {
    const s = rentalSettlement({
      ...base,
      lateFeeMultiplier: null,
      returnedAt: "2026-11-05T11:00:00Z",
    })!;
    assert.equal(s.feeHuf, 10000);
    assert.equal(s.lateSurchargeHuf, null);
    assert.equal(s.lateFeeMultiplier, null);
  });

  it("the replacement value may be claimed only when the late days EXCEED the setting (the contract's words), never without it", () => {
    const at = (days: number) =>
      new Date(
        Date.parse(base.plannedReturnAt) + days * 86_400_000,
      ).toISOString();
    assert.equal(
      rentalSettlement({ ...base, returnedAt: at(5) })!.replacementClaimable,
      false,
    );
    assert.equal(
      rentalSettlement({ ...base, returnedAt: at(5.1) })!.replacementClaimable,
      true,
    );
    assert.equal(
      rentalSettlement({
        ...base,
        replacementAfterDays: null,
        returnedAt: at(30),
      })!.replacementClaimable,
      false,
    );
  });

  it("a return before the start is no settlement", () => {
    assert.equal(
      rentalSettlement({ ...base, returnedAt: "2026-11-01T09:00:00Z" }),
      null,
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
