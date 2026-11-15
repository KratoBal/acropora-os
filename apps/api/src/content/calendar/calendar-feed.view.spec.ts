import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  contentEntry,
  livestockEntry,
  eventEntry,
  orderEntries,
  purchaseEntries,
  saleEntries,
  type PurchaseLineRow,
  type SaleRow,
} from "./calendar-feed.view.js";

/*
  THE CALENDAR FEED VIEW (T5.5 S1). What turns this red: an own sale ending at midnight shown on the day its regular
  price is back; a mirror sale without a start date placed on a guessed day; an open-ended sale given an end; a fully
  received order line shown as still coming; the order's day used where the line has its own; one sale split into one
  entry per variant; the days counted in UTC instead of Budapest.
*/
const P1 = { id: "p1", name: "Egyik" };
const P2 = { id: "p2", name: "Másik" };

describe("saleEntries", () => {
  it("an own sale ending at Budapest midnight ends the day before (the end instant already has the regular price)", () => {
    const [entry] = saleEntries([
      {
        source: "saját",
        product: P1,
        // 2026-11-20 00:00 and 2026-11-23 00:00 in Budapest (CET, UTC+1)
        startsAt: new Date("2026-11-19T23:00:00Z"),
        endsAt: new Date("2026-11-22T23:00:00Z"),
      },
    ]);
    assert.equal(entry!.startsOn, "2026-11-20");
    assert.equal(entry!.endsOn, "2026-11-22");
    assert.equal(entry!.openEnded, false);
  });

  it("a mirror sale with no start is unknown, with no end it is open-ended; its end instant is inclusive", () => {
    const [open, closed] = saleEntries([
      { source: "UNAS tükör", product: P1, startsAt: null, endsAt: null },
      {
        source: "UNAS tükör",
        product: P2,
        startsAt: null,
        endsAt: new Date("2026-11-22T23:00:00Z"),
      },
    ]);
    assert.equal(open!.startsOn, "ismeretlen");
    assert.equal(open!.endsOn, null);
    assert.equal(open!.openEnded, true);
    assert.equal(closed!.endsOn, "2026-11-23");
    assert.equal(closed!.openEnded, false);
  });

  it("the variants of one window and source are one sale, a product named once; another window is another sale", () => {
    const window = {
      source: "saját" as const,
      startsAt: new Date("2026-11-19T23:00:00Z"),
      endsAt: new Date("2026-11-22T23:00:00Z"),
    };
    const rows: SaleRow[] = [
      { ...window, product: P1 },
      { ...window, product: P1 },
      { ...window, product: P2 },
      { ...window, endsAt: new Date("2026-11-25T23:00:00Z"), product: P1 },
      { ...window, source: "UNAS tükör", product: P2 },
    ];
    const entries = saleEntries(rows);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries[0]!.products, [P1, P2]);
    assert.equal(entries[0]!.title, "Akció: 2 termék");
    assert.equal(entries[1]!.title, "Akció: Egyik");
    assert.equal(new Set(entries.map((e) => e.key)).size, 3);
  });
});

describe("purchaseEntries", () => {
  const line = (over: Partial<PurchaseLineRow>): PurchaseLineRow => ({
    purchaseOrderId: "o1",
    lineExpectedAt: null,
    orderExpectedAt: new Date("2026-11-20T09:00:00Z"),
    remaining: true,
    product: P1,
    ...over,
  });

  it("a received line is not coming; a line's own day wins over the order's; one entry per order and day", () => {
    const entries = purchaseEntries([
      line({}),
      line({ product: P2 }),
      // a product of its own: on a shared product the de-duplication would hide a received line shown anyway
      line({ product: { id: "p3", name: "Beérkezett" }, remaining: false }),
      line({ lineExpectedAt: new Date("2026-11-25T09:00:00Z") }),
      line({ orderExpectedAt: null }),
    ]);
    assert.deepEqual(
      entries.map((e) => [e.startsOn, e.products.map((p) => p.id)]),
      [
        ["2026-11-20", ["p1", "p2"]],
        ["2026-11-25", ["p1"]],
      ],
    );
    assert.equal(entries[0]!.title, "Beszerzés érkezik: 2 termék");
    assert.equal(entries[1]!.key, "purchase:o1:2026-11-25");
  });

  it("counts the day in Budapest: 23:30 UTC on the 19th is the 20th", () => {
    const [entry] = purchaseEntries([
      line({ orderExpectedAt: new Date("2026-11-19T23:30:00Z") }),
    ]);
    assert.equal(entry!.startsOn, "2026-11-20");
  });
});

describe("content and livestock entries", () => {
  it("a content item sits on its planned day and carries the schedule date only as detail", () => {
    const entry = contentEntry({
      id: "c1",
      title: "Új halak",
      channel: "FACEBOOK_POST",
      state: "DRAFTING",
      plannedFor: new Date("2026-11-19T23:30:00Z"),
      scheduledFor: new Date("2026-12-18T10:00:00Z"),
    });
    assert.equal(entry.startsOn, "2026-11-20");
    assert.equal(entry.endsOn, "2026-11-20");
    assert.equal(entry.scheduledFor, "2026-12-18T10:00:00.000Z");
    assert.equal(entry.key, "content:c1");
  });

  it("an arrival keeps its status, quantity and pre-registration", () => {
    const entry = livestockEntry({
      id: "a1",
      label: "Zoanthus",
      kind: "CORAL",
      status: "IN_TRANSIT",
      quantity: null,
      preorderable: true,
      productId: null,
      expectedOn: new Date("2026-11-21T00:00:00Z"),
    });
    assert.equal(entry.startsOn, "2026-11-21");
    assert.equal(entry.status, "IN_TRANSIT");
    assert.equal(entry.quantity, null);
    assert.equal(entry.preorderable, true);
  });
});

describe("eventEntry", () => {
  it("a hand-entered event keeps its own days, its place and the person, and its key is the event's", () => {
    const entry = eventEntry({
      id: "e1",
      kind: "SHOP_EVENT",
      title: "Nyílt nap",
      startsOn: "2026-11-20",
      endsOn: "2026-11-21",
      location: "Bolt",
      responsible: { id: "u1", name: "Luca" },
    });
    assert.deepEqual(entry, {
      kind: "EVENT",
      key: "event:e1",
      title: "Nyílt nap",
      startsOn: "2026-11-20",
      endsOn: "2026-11-21",
      eventId: "e1",
      eventKind: "SHOP_EVENT",
      location: "Bolt",
      responsible: { id: "u1", name: "Luca" },
    });
  });
});

describe("orderEntries", () => {
  it("a sale with an unknown start comes first, then by day, a hand-entered event first on its day, the events before the content of the same day", () => {
    const sale = saleEntries([
      { source: "UNAS tükör", product: P1, startsAt: null, endsAt: null },
    ])[0]!;
    const content = contentEntry({
      id: "c1",
      title: "A",
      channel: "FACEBOOK_POST",
      state: "IDEA",
      plannedFor: new Date("2026-11-20T10:00:00Z"),
      scheduledFor: null,
    });
    const arrival = livestockEntry({
      id: "a1",
      label: "Z",
      kind: "FISH",
      status: "ORDERED",
      quantity: 3,
      preorderable: false,
      productId: null,
      expectedOn: new Date("2026-11-20T00:00:00Z"),
    });
    const earlier = { ...content, key: "content:c0", startsOn: "2026-11-19" };
    const holiday = eventEntry({
      id: "e1",
      kind: "HOLIDAY",
      title: "Zárva",
      startsOn: "2026-11-20",
      endsOn: "2026-11-20",
      location: null,
      responsible: null,
    });
    assert.deepEqual(
      orderEntries([content, arrival, earlier, sale, holiday]).map(
        (e) => e.key,
      ),
      [sale.key, "content:c0", "event:e1", "livestock:a1", "content:c1"],
    );
  });
});
