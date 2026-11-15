import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { followPlan, type FollowSlot } from "./calendar-slot-follow.js";

/*
  AN EVENT'S CHANGE REACHES ITS SLOTS (T5.5 S7, spec 5.). What turns this red: a slot left on the old day; the day
  counted from the wrong end; an approved item not stepped back; a scheduled one stepped back (it is scheduled outside
  for the old day, a state change here would not move it), or not warned; a sent or discarded item touched; a slot
  already on its day touched again (the follow-up must be repeatable); a gone event leaving its approved slots approved.
*/
const slot = (over: Partial<FollowSlot>): FollowSlot => ({
  id: "s",
  state: "IDEA",
  // Budapest 2026-11-13 10:00 (UTC+1)
  plannedFor: new Date("2026-11-13T09:00:00Z"),
  anchor: "START",
  offsetDays: -7,
  ...over,
});
const EVENT = {
  title: "Zoanthus",
  startsOn: "2026-11-25",
  endsOn: "2026-11-27",
};

describe("followPlan", () => {
  it("each slot moves to its row's day on the new dates, from the right end", () => {
    const steps = followPlan(
      [slot({ id: "pre" }), slot({ id: "last", anchor: "END", offsetDays: 0 })],
      EVENT,
      EVENT.title,
    );
    assert.deepEqual(
      steps.map((s) => [s.id, s.plannedOn, s.stepBack]),
      [
        ["pre", "2026-11-18", false],
        ["last", "2026-11-27", false],
      ],
    );
    assert.match(steps[0]!.comment, /2026-11-13 helyett 2026-11-18/);
  });

  it("an approved item steps back; a scheduled one keeps its state and is told to be rescheduled by hand", () => {
    const steps = followPlan(
      [
        slot({ id: "ready", state: "READY_TO_SEND" }),
        slot({ id: "sched", state: "SCHEDULED" }),
      ],
      EVENT,
      EVENT.title,
    );
    assert.deepEqual(
      steps.map((s) => [s.id, s.stepBack]),
      [
        ["ready", true],
        ["sched", false],
      ],
    );
    assert.match(steps[0]!.comment, /visszalépett jóváhagyásra/);
    assert.match(steps[1]!.comment, /kézzel kell átírni/);
  });

  it("a sent or discarded item is not touched, and a slot already on its day needs nothing", () => {
    assert.deepEqual(
      followPlan(
        [
          slot({ id: "sent", state: "SENT" }),
          slot({ id: "gone", state: "DISCARDED" }),
          // already on 2026-11-18 (Budapest)
          slot({ id: "same", plannedFor: new Date("2026-11-18T09:00:00Z") }),
        ],
        EVENT,
        EVENT.title,
      ),
      [],
    );
  });

  it("a gone event moves nothing, steps the approved slot back, and tells every open slot", () => {
    const steps = followPlan(
      [
        slot({ id: "ready", state: "READY_TO_SEND" }),
        slot({ id: "idea" }),
        slot({ id: "sent", state: "SENT" }),
      ],
      null,
      "Zoanthus",
    );
    assert.deepEqual(
      steps.map((s) => [s.id, s.plannedOn, s.stepBack]),
      [
        ["ready", null, true],
        ["idea", null, false],
      ],
    );
    assert.match(steps[1]!.comment, /megszűnt/);
  });
});
