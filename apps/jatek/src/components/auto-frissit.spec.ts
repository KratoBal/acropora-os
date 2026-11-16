import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FRISSITES_UTANI_MS,
  ISMETLES_MS,
  varakozasMs,
} from "./auto-frissit.tsx";

/*
  WHAT TURNS THIS RED: a reload that fires before the target (the next question would not be there yet, and the page
  would reload in a loop); one that fires a minute late; a target that has already passed reloading every second; a
  target that is not a time throwing; a far target overflowing the timer (a delay over 2^31 fires at once).
*/
describe("az automatikus újratöltés várakozása", () => {
  const most = Date.parse("2026-11-07T20:59:30.000Z");

  it("waits for the target and one second more", () => {
    assert.equal(
      varakozasMs("2026-11-07T21:00:00.000Z", most),
      30_000 + FRISSITES_UTANI_MS,
    );
  });

  it("a target that has passed (the reload brought the old state) retries after the pause, not at once", () => {
    assert.equal(varakozasMs("2026-11-07T20:00:00.000Z", most), ISMETLES_MS);
    assert.equal(varakozasMs("2026-11-07T20:59:30.000Z", most), ISMETLES_MS);
  });

  it("is null for what is not a time, and never longer than the timer allows", () => {
    assert.equal(varakozasMs("nem idő", most), null);
    assert.ok(varakozasMs("2030-01-01T00:00:00.000Z", most)! <= 2_000_000_000);
  });
});
