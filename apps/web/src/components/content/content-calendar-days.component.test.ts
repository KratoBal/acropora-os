import type { ContentCalendarEntry } from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  budapestToday,
  coversDay,
  mondayOf,
  shiftAnchor,
  spanDays,
  validDay,
  viewDays,
} from "./content-calendar-days";

/*
  THE CALENDAR'S DAYS (T5.5 S3). What turns this red: a week that starts on Sunday; a month view that cuts the first or
  the last week; a summer-time change that shifts a day; a running sale with an unknown start or an open end shown only
  on its first day; Budapest's today taken from UTC late in the evening; a hand-edited URL day turned into a broken range.
*/
describe("calendar days", () => {
  it("a week runs Monday to Sunday, across a month and a summer-time change", () => {
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
    expect(viewDays("het", "2026-10-28")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  it("a month view covers the whole weeks of the month, the first and the last one included", () => {
    const days = viewDays("honap", "2026-11-15");
    expect(days[0]).toBe("2026-10-26");
    expect(days.at(-1)).toBe("2026-12-06");
    expect(days).toHaveLength(42);
    // the range always fits the feed's limit
    expect(days.length).toBeLessThanOrEqual(92);
  });

  it("stepping a month goes from the first, so a 31st does not skip a month", () => {
    expect(shiftAnchor("honap", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("het", "2026-11-15", -1)).toBe("2026-11-08");
  });

  it("Budapest's today, late in the UTC evening, is already the next day", () => {
    expect(budapestToday(new Date("2026-11-15T23:30:00Z"))).toBe("2026-11-16");
  });

  it("a span says the year only when it is not this year's, or runs into another one", () => {
    expect(spanDays("2026-11-02", "2026-12-02", "2026-11-15")).toEqual([
      "nov. 2.",
      "dec. 2.",
    ]);
    expect(spanDays("2026-01-17", "2027-12-31", "2026-11-15")).toEqual([
      "2026. jan. 17.",
      "2027. dec. 31.",
    ]);
    expect(spanDays("2025-01-17", "2025-12-31", "2026-11-15")[0]).toBe(
      "2025. jan. 17.",
    );
  });

  it("an impossible URL day falls back", () => {
    expect(validDay("2026-02-30", "2026-11-15")).toBe("2026-11-15");
    expect(validDay("tegnap", "2026-11-15")).toBe("2026-11-15");
    expect(validDay("2026-02-28", "2026-11-15")).toBe("2026-02-28");
  });

  it("a running sale with an unknown start and an open end covers every day; a one-day entry only its own", () => {
    const sale = {
      kind: "SALE",
      key: "s",
      title: "Akció",
      startsOn: "ismeretlen",
      endsOn: null,
      source: "UNAS tükör",
      openEnded: true,
      products: [],
    } satisfies ContentCalendarEntry;
    expect(coversDay(sale, "2026-11-01")).toBe(true);
    expect(coversDay(sale, "2027-01-01")).toBe(true);
    const event = {
      kind: "EVENT",
      key: "e",
      title: "Zárva",
      startsOn: "2026-12-24",
      endsOn: "2026-12-26",
      eventId: "e1",
      eventKind: "HOLIDAY",
      location: null,
      responsible: null,
    } satisfies ContentCalendarEntry;
    expect(coversDay(event, "2026-12-23")).toBe(false);
    expect(coversDay(event, "2026-12-26")).toBe(true);
    expect(coversDay(event, "2026-12-27")).toBe(false);
  });
});
