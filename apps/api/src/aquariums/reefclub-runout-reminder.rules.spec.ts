import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  budapestDay,
  hungarianDay,
  hungarianDayOn,
  reminderStep,
  runOutMail,
  startDay,
} from "./reefclub-runout-reminder.rules.js";

/*
  THE RUN-OUT REMINDER'S SENDER RULES (ReefClub V3.2, slice 5). WHAT TURNS THIS RED: the start taken from an order whose pack ran
  out before the consent, or from the consent while a fitting order exists; the newest order not starting the cycle; a mail before
  the reminder day, on or after the run-out day, or twice for one run-out day; the day read in UTC instead of Budapest; a mail
  without the unsubscribe link, or with the key outside the fragment.
*/
const DAYS = { min: 50, max: 100 };

describe("the start day", () => {
  it("is the latest order that left the shop, when its pack had not run out before the consent", () => {
    assert.deepEqual(
      startDay({
        orderDays: ["2026-09-01", "2026-11-02", "2026-10-01"],
        consentDay: "2026-11-05",
        days: DAYS,
      }),
      { day: "2026-11-02", source: "ORDER" },
    );
  });

  it("is the consent day without an order, or when the latest order's pack ran out before the consent", () => {
    assert.deepEqual(
      startDay({ orderDays: [], consentDay: "2026-11-05", days: DAYS }),
      { day: "2026-11-05", source: "CONSENT" },
    );
    // 2026-08-01 + 50 days = 2026-09-20, before the consent
    assert.deepEqual(
      startDay({
        orderDays: ["2026-08-01"],
        consentDay: "2026-11-05",
        days: DAYS,
      }),
      { day: "2026-11-05", source: "CONSENT" },
    );
    // a newer order after the consent starts a new cycle
    assert.deepEqual(
      startDay({
        orderDays: ["2026-08-01", "2026-12-20"],
        consentDay: "2026-11-05",
        days: DAYS,
      }),
      { day: "2026-12-20", source: "ORDER" },
    );
  });

  it("reads the day in Budapest: 23:30 UTC on a winter evening is already the next day", () => {
    assert.equal(budapestDay(new Date("2026-11-10T23:30:00Z")), "2026-11-11");
    assert.equal(budapestDay(new Date("2026-11-10T22:59:00Z")), "2026-11-10");
  });
});

describe("the step of a day", () => {
  const start = { day: "2026-11-01", source: "ORDER" as const };
  // runs out 2026-12-21, reminder from 2026-12-14
  const step = (today: string, remindedForRunOut: string | null = null) =>
    reminderStep({ today, start, days: DAYS, remindedForRunOut });

  it("waits until the reminder day, is due until the day before the run-out, then late", () => {
    assert.deepEqual(step("2026-12-13"), {
      kind: "WAIT",
      remindOn: "2026-12-14",
    });
    assert.deepEqual(step("2026-12-14"), {
      kind: "DUE",
      runsOutOn: "2026-12-21",
      remindOn: "2026-12-14",
    });
    assert.equal(step("2026-12-20").kind, "DUE");
    assert.deepEqual(step("2026-12-21"), {
      kind: "LATE",
      runsOutOn: "2026-12-21",
    });
  });

  it("sends once per run-out day; a new cycle's run-out day is due again", () => {
    assert.deepEqual(step("2026-12-15", "2026-12-21"), {
      kind: "SENT",
      runsOutOn: "2026-12-21",
    });
    assert.equal(step("2026-12-15", "2026-10-01").kind, "DUE");
  });
});

describe("the mail", () => {
  it("names the product, the day and the start, and carries the unsubscribe key in the fragment", () => {
    const mail = runOutMail({
      to: "tag@example.test",
      productName: "Kitalált kalcium",
      packageText: "500 ml",
      aquariumName: "Nappali",
      litres: 300,
      start: { day: "2026-11-01", source: "ORDER" },
      runsOutOn: "2026-12-21",
      webUrl: "https://reefclub.example",
      unsubscribeKey: "r1.abc",
    });
    assert.deepEqual(mail.to, ["tag@example.test"]);
    assert.equal(mail.subject, "ReefClub: hamarosan elfogy: Kitalált kalcium");
    assert.match(mail.text, /2026\. december 21\. körül fogy el/);
    assert.ok(
      mail.text.includes(
        "A számítás a bolti rendelésed 2026. november 1. napjától indul, 300 literrel. Ha kevesebbet adagolsz, tovább tart.",
      ),
    );
    assert.match(mail.text, /300 literrel/);
    assert.ok(
      mail.text.includes(
        "https://reefclub.example/emlekezteto-leiratkozas#token=r1.abc",
      ),
    );
    const consent = runOutMail({
      to: "tag@example.test",
      productName: "x",
      packageText: "1 l",
      aquariumName: "y",
      litres: 100,
      start: { day: "2026-11-05", source: "CONSENT" },
      runsOutOn: "2026-12-25",
      webUrl: "https://reefclub.example",
      unsubscribeKey: "r1.abc",
    });
    // korall's wording (acrobot 50198): the verb right after the day, the clause after it
    assert.ok(
      consent.text.includes(
        "A számítás 2026. november 5-én indul, amikor az emlékeztetőt kérted, 100 literrel. Ha kevesebbet adagolsz, tovább tart.",
      ),
    );
    assert.equal(hungarianDay("2026-01-05"), "2026. január 5.");
  });

  /*
    THE DAY'S SUFFIX FOLLOWS THE SPOKEN ORDINAL. WHAT TURNS THIS RED: a suffix by the last digit alone (12-án, 22-án instead of
    12-én, 22-én), 1-én instead of 1-jén, or 20-én and 30-én instead of 20-án and 30-án.
  */
  it("the day it happens on: 1-jén, 2-án, 12-én, 13-án, 20-án, 22-én, 31-én", () => {
    const on = (day: string) =>
      hungarianDayOn(day).replace(/^2026\. [a-zá-ű]+ /u, "");
    assert.deepEqual(
      [
        "01",
        "02",
        "03",
        "04",
        "06",
        "10",
        "12",
        "13",
        "20",
        "22",
        "23",
        "30",
        "31",
      ].map((d) => on(`2026-01-${d}`)),
      [
        "1-jén",
        "2-án",
        "3-án",
        "4-én",
        "6-án",
        "10-én",
        "12-én",
        "13-án",
        "20-án",
        "22-én",
        "23-án",
        "30-án",
        "31-én",
      ],
    );
    assert.equal(hungarianDayOn("2026-11-13"), "2026. november 13-án");
  });
});
