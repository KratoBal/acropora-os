import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ContentResultValues } from "@acropora/types";

import {
  summarize,
  sumWeeks,
  type SummaryItem,
} from "./content-results.view.js";

/*
  THE RESULTS, FROM WEEKS TO ANSWERS (T5.5 S8). What turns this red: a number nobody entered summed as 0; an unmeasured
  item counted in an average or named the worst; the daypart taken from UTC; an item without pre-registrations listed.
*/
const week = (over: Partial<ContentResultValues>): ContentResultValues => ({
  reach: null,
  reactions: null,
  opens: null,
  clicks: null,
  preorders: null,
  orders: null,
  ...over,
});
const item = (over: Partial<SummaryItem>): SummaryItem => ({
  id: "c",
  title: "C",
  channel: "FACEBOOK_POST",
  // Budapest 2026-11-10 18:30 (UTC+1): evening
  sentAt: new Date("2026-11-10T17:30:00Z"),
  weeks: [],
  ...over,
});

describe("sumWeeks", () => {
  it("sums what was entered and leaves a never-entered field null, not 0", () => {
    assert.deepEqual(
      sumWeeks([week({ reach: 100, clicks: 3 }), week({ reach: 50 })]),
      week({ reach: 150, clicks: 3 }),
    );
  });
});

describe("summarize", () => {
  it("per channel: the average over the measured items, the best and the worst by reach; an unmeasured item is counted, not averaged", () => {
    const result = summarize("2026-11", "2026-11", [
      item({ id: "a", title: "A", weeks: [week({ reach: 1000, clicks: 10 })] }),
      item({ id: "b", title: "B", weeks: [week({ reach: 200 })] }),
      item({ id: "c", title: "C" }),
    ]);
    assert.deepEqual(result.byChannel, [
      {
        channel: "FACEBOOK_POST",
        items: 3,
        measured: 2,
        avgReach: 600,
        avgClicks: 10,
        best: { contentId: "a", title: "A", reach: 1000 },
        worst: { contentId: "b", title: "B", reach: 200 },
      },
    ]);
  });

  it("lists the items that brought pre-registrations, the most first", () => {
    const result = summarize("2026-11", "2026-11", [
      item({ id: "a", title: "A", weeks: [week({ preorders: 2 })] }),
      item({ id: "b", title: "B", weeks: [week({ preorders: 5 })] }),
      item({ id: "c", title: "C", weeks: [week({ reach: 10 })] }),
    ]);
    assert.deepEqual(
      result.preorders.map((p) => [p.contentId, p.preorders]),
      [
        ["b", 5],
        ["a", 2],
      ],
    );
  });

  it("the daypart is the Budapest hour the item went out", () => {
    const result = summarize("2026-11", "2026-11", [
      // 07:30 UTC is 08:30 in Budapest: morning (in UTC it would still be morning; 04:30 UTC is 05:30 Budapest)
      item({
        id: "m",
        sentAt: new Date("2026-11-10T04:30:00Z"),
        weeks: [week({ reach: 300 })],
      }),
      item({ id: "e", weeks: [week({ reach: 100 })] }),
    ]);
    const by = Object.fromEntries(result.byDaypart.map((d) => [d.daypart, d]));
    assert.equal(by["reggel"]!.measured, 1);
    assert.equal(by["reggel"]!.avgReach, 300);
    assert.equal(by["este"]!.avgReach, 100);
    assert.equal(by["éjszaka"]!.measured, 0);
  });
});
