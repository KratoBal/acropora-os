import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type MyServiceWorkItem,
  serviceJobOverdueSince,
  serviceJobWorkBucket,
  sortMyServiceWork,
  worksheetWorkBucket,
} from "./my-service-work.js";

/*
  A FELADATAIM BESOROLÁSA (kártya 041a3dd5; Balázs „2.”, tervrajz:
  picasso-feladataim-2-allapot). MI PIROSÍT:
  - egy hibajegy- vagy munkalap-állapot a tervrajzzal ellentétes csoportba
    kerül (Besorolva és Piszkozat rajtad; Alkatrészre vár és a jövőbeli
    Betervezve máson; az Aláírásra vár helyben rajtad, távolra küldve máson);
  - a ma vagy a már elmúlt Betervezve máson múlik;
  - a lezárt jegynek, a ma esedékesnek vagy a munkalapnak lejárata van;
  - a lejárt tétel nem áll elöl a csoportjában.
*/
const today = new Date("2026-10-06T22:00:00.000Z"); // 2026-10-07 00:00 Budapest
const tomorrow = new Date("2026-10-07T22:00:00.000Z");
const at = (iso: string) => new Date(iso);

describe("the service job's group", () => {
  const bucket = (
    status: Parameters<typeof serviceJobWorkBucket>[0]["status"],
    scheduledAt: Date | null = null,
  ) => serviceJobWorkBucket({ status, scheduledAt, tomorrowStart: tomorrow });

  it("new, triaged and in progress are yours; waiting for parts or the customer is someone else's", () => {
    assert.equal(bucket("NEW"), "MINE");
    assert.equal(bucket("TRIAGED"), "MINE");
    assert.equal(bucket("IN_PROGRESS"), "MINE");
    assert.equal(bucket("WAITING_FOR_PARTS"), "OTHERS");
    assert.equal(bucket("WAITING_FOR_CUSTOMER"), "OTHERS");
    assert.equal(bucket("COMPLETED"), "CLOSED");
    assert.equal(bucket("CANCELLED"), "CLOSED");
  });

  it("scheduled: a future date waits for the calendar; today or past is yours", () => {
    assert.equal(bucket("SCHEDULED", at("2026-10-09T08:00:00.000Z")), "OTHERS");
    assert.equal(bucket("SCHEDULED", tomorrow), "OTHERS");
    assert.equal(bucket("SCHEDULED", at("2026-10-07T21:59:00.000Z")), "MINE");
    assert.equal(bucket("SCHEDULED", at("2026-09-30T08:00:00.000Z")), "MINE");
    assert.equal(bucket("SCHEDULED", null), "MINE");
  });
});

describe("the service job's overdue line", () => {
  const overdue = (
    status: Parameters<typeof serviceJobOverdueSince>[0]["status"],
    scheduledAt: Date | null,
  ) => serviceJobOverdueSince({ status, scheduledAt, todayStart: today });

  it("a date on an earlier day of an open job is overdue, with that date", () => {
    const past = at("2026-08-31T07:00:00.000Z");
    assert.deepEqual(overdue("SCHEDULED", past), past);
    assert.deepEqual(overdue("IN_PROGRESS", past), past);
  });

  it("today's date, no date, or a closed job is not overdue", () => {
    assert.equal(overdue("SCHEDULED", at("2026-10-07T06:00:00.000Z")), null);
    assert.equal(overdue("SCHEDULED", null), null);
    assert.equal(overdue("COMPLETED", at("2026-08-31T07:00:00.000Z")), null);
    assert.equal(overdue("CANCELLED", at("2026-08-31T07:00:00.000Z")), null);
  });
});

describe("the worksheet's group", () => {
  it("draft and rejected are yours; awaiting a signature is yours on site and the buyer's when sent away", () => {
    assert.equal(
      worksheetWorkBucket({ status: "DRAFT", sentForSignature: false }),
      "MINE",
    );
    assert.equal(
      worksheetWorkBucket({ status: "REJECTED", sentForSignature: false }),
      "MINE",
    );
    assert.equal(
      worksheetWorkBucket({
        status: "AWAITING_SIGNATURE",
        sentForSignature: false,
      }),
      "MINE",
    );
    assert.equal(
      worksheetWorkBucket({
        status: "AWAITING_SIGNATURE",
        sentForSignature: true,
      }),
      "OTHERS",
    );
    assert.equal(
      worksheetWorkBucket({ status: "SIGNED", sentForSignature: false }),
      "CLOSED",
    );
  });
});

describe("the order within a group", () => {
  const item = (
    id: string,
    createdAt: string,
    overdueSince: string | null = null,
  ): MyServiceWorkItem => ({
    kind: "SERVICE_JOB",
    id,
    number: id,
    status: "SCHEDULED",
    title: null,
    partnerName: null,
    unitName: null,
    scheduledAt: overdueSince,
    overdueSince,
    sentForSignature: false,
    bucket: "MINE",
    createdAt,
  });

  it("overdue first (longest overdue first), then the oldest", () => {
    const sorted = sortMyServiceWork(
      [
        item("uj", "2026-10-05T08:00:00.000Z"),
        item("regi", "2026-09-01T08:00:00.000Z"),
        item(
          "lejart-kesobb",
          "2026-10-01T08:00:00.000Z",
          "2026-10-03T08:00:00.000Z",
        ),
        item(
          "lejart-regen",
          "2026-10-02T08:00:00.000Z",
          "2026-08-31T08:00:00.000Z",
        ),
      ],
      "MINE",
    );
    assert.deepEqual(
      sorted.map((i) => i.id),
      ["lejart-regen", "lejart-kesobb", "regi", "uj"],
    );
  });

  it("closed ones: the newest first", () => {
    const sorted = sortMyServiceWork(
      [
        item("a", "2026-09-01T08:00:00.000Z"),
        item("b", "2026-10-01T08:00:00.000Z"),
      ],
      "CLOSED",
    );
    assert.deepEqual(
      sorted.map((i) => i.id),
      ["b", "a"],
    );
  });
});
