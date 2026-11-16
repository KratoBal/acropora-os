import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ContentCalendarEntry,
  ContentTemplateRule,
} from "@acropora/types";

import { planSlots, templateKindOf } from "./calendar-slots.plan.js";

/*
  WHICH SLOTS A RANGE NEEDS (T5.5 S5). What turns this red: a last-day reminder opened for an open-ended sale (spec 8B);
  a slot guessed for a sale whose start is unknown; a slot for a day already past; a switched-off row opening anything;
  a row of another event kind applied; a content item treated as an event; the day counted from the wrong end.
*/
const rule = (over: Partial<ContentTemplateRule>): ContentTemplateRule => ({
  id: "r",
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
  rule({ id: "announce" }),
  rule({ id: "last", anchor: "END", offsetDays: 0, label: "Utolsó nap" }),
  rule({ id: "off", active: false, label: "Kikapcsolt" }),
  rule({
    id: "pre",
    eventKind: "LIVESTOCK_ARRIVAL",
    label: "Előjegyzés",
    offsetDays: -7,
  }),
  rule({
    id: "news",
    eventKind: "SHOP_EVENT",
    label: "Meghívó",
    channel: "NEWSLETTER",
    offsetDays: -5,
  }),
];
const sale = (over: Partial<ContentCalendarEntry & { kind: "SALE" }>) =>
  ({
    kind: "SALE",
    key: "sale:own",
    title: "Akció: Energy",
    startsOn: "2026-11-20",
    endsOn: "2026-11-24",
    source: "saját",
    openEnded: false,
    products: [],
    ...over,
  }) as ContentCalendarEntry;
const TODAY = "2026-11-15";

describe("planSlots", () => {
  it("a sale gets its start row and its last-day row, each from its own end; a switched-off row opens nothing", () => {
    const { slots } = planSlots([sale({})], RULES, TODAY);
    assert.deepEqual(
      slots.map((s) => [s.ruleId, s.plannedOn, s.title]),
      [
        ["announce", "2026-11-17", "Bejelentés: Akció: Energy"],
        ["last", "2026-11-24", "Utolsó nap: Akció: Energy"],
      ],
    );
  });

  it("an open-ended sale opens no last-day slot, and a mirror sale with an unknown start no start slot: both counted", () => {
    const { slots, skipped } = planSlots(
      [
        sale({
          key: "sale:mirror",
          startsOn: "ismeretlen",
          endsOn: null,
          openEnded: true,
        }),
      ],
      RULES,
      TODAY,
    );
    assert.deepEqual(slots, []);
    assert.deepEqual(skipped, { pastDay: 0, openEnded: 1, unknownDay: 1 });
  });

  it("a slot whose day is past is not opened, and is counted", () => {
    const { slots, skipped } = planSlots(
      [sale({ startsOn: "2026-11-16", endsOn: "2026-11-18" })],
      RULES,
      TODAY,
    );
    // the announcement would be on the 13th; the last day still comes
    assert.deepEqual(
      slots.map((s) => s.ruleId),
      ["last"],
    );
    assert.equal(skipped.pastDay, 1);
  });

  it("each kind takes only its own rows: a live arrival, a shop event by its kind; a content item is no event", () => {
    const entries: ContentCalendarEntry[] = [
      {
        kind: "LIVESTOCK_ARRIVAL",
        key: "livestock:a1",
        title: "Zoanthus",
        startsOn: "2026-11-30",
        endsOn: "2026-11-30",
        arrivalId: "a1",
        livestockKind: "CORAL",
        status: "ORDERED",
        quantity: null,
        preorderable: true,
        productId: null,
      },
      {
        kind: "EVENT",
        key: "event:e1",
        title: "Nyílt nap",
        startsOn: "2026-12-05",
        endsOn: "2026-12-06",
        eventId: "e1",
        eventKind: "SHOP_EVENT",
        location: null,
        responsible: null,
      },
      {
        kind: "CONTENT",
        key: "content:c1",
        title: "Egy poszt",
        startsOn: "2026-11-20",
        endsOn: "2026-11-20",
        contentId: "c1",
        channel: "FACEBOOK_POST",
        state: "IDEA",
        scheduledFor: null,
      },
    ];
    const { slots } = planSlots(entries, RULES, TODAY);
    assert.deepEqual(
      slots.map((s) => [s.eventKey, s.ruleId, s.plannedOn, s.channel]),
      [
        ["livestock:a1", "pre", "2026-11-23", "FACEBOOK_POST"],
        ["event:e1", "news", "2026-11-30", "NEWSLETTER"],
      ],
    );
    assert.equal(templateKindOf(entries[2]!), null);
  });
});
