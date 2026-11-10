import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  APPROVAL_REMINDER_HOURS,
  isApprovalOverdue,
} from "./content-approval-reminder.js";

/*
  WHAT TURNS THESE RED (T5.1 reminder): the two days counted as calendar days (an evening item overdue at midnight); the boundary
  not counting (exactly 48 hours is due); an item from the future or an invalid date counted overdue; the constant changed.
*/
const now = new Date("2026-11-10T20:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

describe("the approval reminder", () => {
  it("is 48 hours (the decision: two days)", () => {
    assert.equal(APPROVAL_REMINDER_HOURS, 48);
  });

  it("an item is overdue from exactly 48 hours, not before", () => {
    assert.equal(isApprovalOverdue(hoursAgo(47.99), now), false);
    assert.equal(isApprovalOverdue(hoursAgo(48), now), true);
    assert.equal(isApprovalOverdue(hoursAgo(49), now), true);
  });

  it("it is hours, not calendar days: an item that entered yesterday evening is not overdue at today's midnight", () => {
    const enteredEvening = new Date("2026-11-08T22:00:00.000Z");
    assert.equal(
      isApprovalOverdue(enteredEvening, new Date("2026-11-10T00:30:00.000Z")),
      false,
    );
    assert.equal(
      isApprovalOverdue(enteredEvening, new Date("2026-11-10T22:00:00.000Z")),
      true,
    );
  });

  it("a future or invalid entry time is not overdue", () => {
    assert.equal(isApprovalOverdue(hoursAgo(-5), now), false);
    assert.equal(isApprovalOverdue(new Date("nem-datum"), now), false);
  });
});
