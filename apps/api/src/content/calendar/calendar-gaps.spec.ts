import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ContentCalendarEntry,
  ContentTemplateRule,
} from "@acropora/types";

import { computeGaps, slotStatus, type SlotRow } from "./calendar-gaps.js";

/*
  THE GAP AND COLLISION SIGNALS (T5.5 S6). What turns this red: an event shown as covered while a slot is an idea or a
  draft, or was never opened; a late slot forgiven; an approved slot of a sale with an unknown Omnibus value shown as
  done (spec 8B); two items on one channel and day flagged (the rule is MORE than two), or three not flagged; a
  discarded item counted; the newsletter rule firing while the frequency is not set, or missing two letters too close
  once it is; the missing events not listed first.
*/
const TODAY = "2026-11-15";
const rule = (over: Partial<ContentTemplateRule>): ContentTemplateRule => ({
  id: "announce",
  eventKind: "SALE",
  label: "Bejelentés",
  channel: "FACEBOOK_POST",
  anchor: "START",
  offsetDays: -3,
  active: true,
  sortOrder: 1,
  updatedAt: "2026-11-15T10:00:00.000Z",
  ...over,
});
const RULES = [
  rule({}),
  rule({ id: "news", label: "Hírlevél", channel: "NEWSLETTER", offsetDays: 0 }),
  rule({
    id: "pre",
    eventKind: "LIVESTOCK_ARRIVAL",
    label: "Előjegyzés",
    offsetDays: -7,
  }),
];
const SALE: ContentCalendarEntry = {
  kind: "SALE",
  key: "sale:a",
  title: "Akció: Energy",
  startsOn: "2026-11-20",
  endsOn: "2026-11-24",
  source: "saját",
  openEnded: false,
  products: [{ id: "p1", name: "Energy" }],
};
const ARRIVAL: ContentCalendarEntry = {
  kind: "LIVESTOCK_ARRIVAL",
  key: "livestock:a1",
  title: "Zoanthus",
  startsOn: "2026-11-19",
  endsOn: "2026-11-19",
  arrivalId: "a1",
  livestockKind: "CORAL",
  status: "ORDERED",
  quantity: null,
  preorderable: true,
  productId: null,
};
const content = (
  id: string,
  day: string,
  channel: "FACEBOOK_POST" | "NEWSLETTER",
  state: "IDEA" | "DISCARDED" | "SCHEDULED" = "IDEA",
): ContentCalendarEntry => ({
  kind: "CONTENT",
  key: `content:${id}`,
  title: id,
  startsOn: day,
  endsOn: day,
  contentId: id,
  channel,
  state,
  scheduledFor: null,
});
const slot = (
  key: string,
  ruleId: string,
  state: SlotRow["state"],
): SlotRow => ({
  id: `${key}-${ruleId}`,
  calendarEventKey: key,
  templateRuleId: ruleId,
  state,
});
const gaps = (over: Partial<Parameters<typeof computeGaps>[0]>) =>
  computeGaps({
    queriedAt: "2026-11-15T09:00:00.000Z",
    from: TODAY,
    to: "2026-11-28",
    today: TODAY,
    entries: [SALE, ARRIVAL],
    rules: RULES,
    slots: [],
    omnibusUnknown: new Map(),
    newsletterMinDays: null,
    ...over,
  });

describe("computeGaps", () => {
  it("each event's slots with their state and days left; never opened, idea and draft are missing, a late one too", () => {
    const result = gaps({
      slots: [
        slot("sale:a", "announce", "AWAITING_APPROVAL"),
        slot("sale:a", "news", "SCHEDULED"),
      ],
    });
    const sale = result.events.find((e) => e.eventKey === "sale:a")!;
    assert.deepEqual(
      sale.slots.map((s) => [
        s.ruleId,
        s.plannedOn,
        s.daysLeft,
        s.status,
        s.done,
      ]),
      [
        ["announce", "2026-11-17", 2, "DRAFT", false],
        ["news", "2026-11-20", 5, "APPROVED", true],
      ],
    );
    assert.equal(sale.missing, true);
    const arrival = result.events.find((e) => e.eventKey === "livestock:a1")!;
    // the pre-registration call was due on the 12th: late, and missing
    assert.deepEqual(
      arrival.slots.map((s) => [s.plannedOn, s.daysLeft, s.status, s.done]),
      [["2026-11-12", -3, "NOT_OPENED", false]],
    );
  });

  it("an approved slot of a sale with an unknown Omnibus value is not done; a sent or discarded one is", () => {
    const result = gaps({
      entries: [SALE],
      slots: [
        slot("sale:a", "announce", "READY_TO_SEND"),
        slot("sale:a", "news", "SENT"),
      ],
      omnibusUnknown: new Map([["sale:a", 1]]),
    });
    const sale = result.events[0]!;
    assert.equal(sale.omnibusUnknown, 1);
    assert.deepEqual(
      sale.slots.map((s) => [s.status, s.done]),
      [
        ["APPROVED", false],
        ["SENT", true],
      ],
    );
    assert.equal(sale.missing, true);
    const known = gaps({
      entries: [SALE],
      slots: [
        slot("sale:a", "announce", "READY_TO_SEND"),
        slot("sale:a", "news", "DISCARDED"),
      ],
    }).events[0]!;
    assert.equal(known.missing, false);
  });

  it("the missing events come first", () => {
    const result = gaps({
      slots: [
        slot("sale:a", "announce", "SCHEDULED"),
        slot("sale:a", "news", "SCHEDULED"),
      ],
    });
    assert.deepEqual(
      result.events.map((e) => [e.eventKey, e.missing]),
      [
        ["livestock:a1", true],
        ["sale:a", false],
      ],
    );
  });

  it("more than two items on one channel and day is a collision; two is not, and a discarded one does not count", () => {
    const result = gaps({
      entries: [
        content("a", "2026-11-18", "FACEBOOK_POST"),
        content("b", "2026-11-18", "FACEBOOK_POST"),
        content("c", "2026-11-18", "FACEBOOK_POST", "DISCARDED"),
        content("d", "2026-11-19", "FACEBOOK_POST"),
        content("e", "2026-11-19", "FACEBOOK_POST"),
        content("f", "2026-11-19", "FACEBOOK_POST", "SCHEDULED"),
        content("g", "2026-11-19", "NEWSLETTER"),
      ],
    });
    assert.deepEqual(
      result.collisions.map((c) => [
        c.day,
        c.channel,
        c.items.map((i) => i.contentId),
      ]),
      [["2026-11-19", "FACEBOOK_POST", ["d", "e", "f"]]],
    );
  });

  it("the newsletter rule says nothing without the setting; with it, two letters closer than the days are named", () => {
    const entries = [
      content("n1", "2026-11-16", "NEWSLETTER"),
      content("n2", "2026-11-20", "NEWSLETTER"),
      content("n3", "2026-11-28", "NEWSLETTER"),
    ];
    assert.deepEqual(gaps({ entries }).newsletter, {
      minDaysBetween: null,
      tooClose: [],
    });
    const set = gaps({ entries, newsletterMinDays: 7 }).newsletter;
    assert.deepEqual(
      set.tooClose.map((t) => [t.first.contentId, t.second.contentId, t.days]),
      [["n1", "n2", 4]],
    );
  });

  it("the states map to the slot statuses", () => {
    assert.deepEqual(
      [
        null,
        "IDEA",
        "DRAFTING",
        "AWAITING_REVIEW",
        "SCHEDULED",
        "SENT",
        "DISCARDED",
      ].map((state) => slotStatus(state as SlotRow["state"] | null)),
      ["NOT_OPENED", "IDEA", "DRAFT", "DRAFT", "APPROVED", "SENT", "DISCARDED"],
    );
  });
});
