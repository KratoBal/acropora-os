import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LIVESTOCK_ARRIVAL_VERSION,
  livestockArrivalMetadata,
  type ProjectedArrivalRow,
} from "./medusa-livestock-arrival.js";

/*
  WHAT TURNS THIS RED (V2.6 S3a, the key the product page reads). An arrival that has arrived, is cancelled or that a
  customer may not register for going out (the page would invite a sign-up for something that cannot be waited for); the
  soonest day not winning, or two arrivals of one day giving a different text between two runs (the id is the tie-break, so
  an unchanged arrival is not rewritten); the internal note, the label or the quantity leaking into the text; a shape without
  its version (a change of shape would be a surprise on the page); a day shifted by one around midnight (a `@db.Date` column is
  midnight UTC); no arrival giving anything but null (the merge takes the key off the shop only on the ABSENCE of a value).
*/
const row = (over: Partial<ProjectedArrivalRow> = {}): ProjectedArrivalRow => ({
  id: "a1",
  expectedOn: new Date("2026-11-13T00:00:00.000Z"),
  status: "IN_TRANSIT",
  preorderable: true,
  ...over,
});

describe("the arrival a product's page may show", () => {
  it("is the day and the stage, with the version, in a fixed key order", () => {
    assert.equal(
      livestockArrivalMetadata([row()]),
      `{"v":${LIVESTOCK_ARRIVAL_VERSION},"expected_on":"2026-11-13","status":"in_transit"}`,
    );
    assert.equal(
      livestockArrivalMetadata([row({ status: "ORDERED" })]),
      '{"v":1,"expected_on":"2026-11-13","status":"ordered"}',
    );
  });

  it("is null when there is nothing to show: no rows, or none that qualifies", () => {
    assert.equal(livestockArrivalMetadata([]), null);
    assert.equal(livestockArrivalMetadata(null), null);
    assert.equal(livestockArrivalMetadata(undefined), null);
    for (const status of ["ARRIVED", "CANCELLED", "SOMETHING_NEW"])
      assert.equal(livestockArrivalMetadata([row({ status })]), null, status);
    assert.equal(
      livestockArrivalMetadata([row({ preorderable: false })]),
      null,
    );
  });

  it("takes the soonest day, and the id breaks a tie, whatever the order the rows come in", () => {
    const later = row({
      id: "b",
      expectedOn: new Date("2026-11-20T00:00:00.000Z"),
    });
    const sooner = row({
      id: "z",
      expectedOn: new Date("2026-11-13T00:00:00.000Z"),
      status: "ORDERED",
    });
    assert.equal(
      livestockArrivalMetadata([later, sooner]),
      livestockArrivalMetadata([sooner, later]),
    );
    assert.match(livestockArrivalMetadata([later, sooner])!, /2026-11-13/);
    const a = row({ id: "a", status: "ORDERED" });
    const b = row({ id: "b", status: "IN_TRANSIT" });
    // the same day: "a" (ORDERED) wins in both orders
    assert.match(livestockArrivalMetadata([b, a])!, /"ordered"/);
    assert.match(livestockArrivalMetadata([a, b])!, /"ordered"/);
  });

  it("skips an arrival that does not qualify when a qualifying one is later", () => {
    const arrived = row({
      id: "a",
      status: "ARRIVED",
      expectedOn: new Date("2026-11-01T00:00:00.000Z"),
    });
    const coming = row({
      id: "b",
      expectedOn: new Date("2026-11-30T00:00:00.000Z"),
    });
    assert.match(livestockArrivalMetadata([arrived, coming])!, /2026-11-30/);
  });

  it("does not carry the note, the label or the quantity, and keeps the day as it is stored", () => {
    const text = livestockArrivalMetadata([
      {
        ...row(),
        note: "belso jegyzet",
        label: "Zoanthus",
        quantity: 8,
      } as never,
    ])!;
    assert.deepEqual(Object.keys(JSON.parse(text)), [
      "v",
      "expected_on",
      "status",
    ]);
    assert.doesNotMatch(text, /belso|Zoanthus|8/);
    // midnight UTC of the day is the day itself, in any timezone of the machine
    assert.match(
      livestockArrivalMetadata([
        row({ expectedOn: new Date("2026-12-31T00:00:00.000Z") }),
      ])!,
      /2026-12-31/,
    );
  });
});
