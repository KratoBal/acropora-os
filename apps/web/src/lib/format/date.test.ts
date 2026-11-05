import { describe, expect, it } from "vitest";

import { formatDateTimeHu, formatDayHu, formatTimeHu } from "./date";

// What must fail: the three list date shapes living side by side again ("2026-11-03", "nov. 3.",
// "2026. 08. 19."); the time shown in UTC instead of Budapest time; a broken value printing
// "Invalid Date"; a non-ISO day being mangled instead of passed through.
describe("the list date format", () => {
  it("writes an ISO day as year. month. day.", () => {
    expect(formatDayHu("2026-11-03")).toBe("2026. 11. 03.");
    expect(formatDayHu("2026-01-09")).toBe("2026. 01. 09.");
  });

  it("passes a value that is not an ISO day through unchanged", () => {
    expect(formatDayHu("")).toBe("");
    expect(formatDayHu("2026-11")).toBe("2026-11");
    expect(formatDayHu("holnap")).toBe("holnap");
  });

  it("writes a time with the Budapest clock: winter UTC+1, summer UTC+2", () => {
    expect(formatDateTimeHu("2026-11-03T13:20:00.000Z")).toBe(
      "2026. 11. 03. 14:20",
    );
    expect(formatDateTimeHu("2026-07-25T10:00:00.000Z")).toBe(
      "2026. 07. 25. 12:00",
    );
  });

  // e64540fd: the paid-mark run's 07:00 UTC is 08:00 in Budapest in winter and 09:00 in summer
  it("writes an hour and minute with the Budapest clock too", () => {
    expect(formatTimeHu("2026-11-06T07:00:00.000Z")).toBe("08:00");
    expect(formatTimeHu("2026-07-06T07:00:00.000Z")).toBe("09:00");
    expect(formatTimeHu("nem dátum")).toBe("");
  });

  it("gives an empty text for a broken time, not Invalid Date", () => {
    expect(formatDateTimeHu("nem dátum")).toBe("");
  });

  it("takes a Date too", () => {
    expect(formatDateTimeHu(new Date("2026-11-03T23:30:00.000Z"))).toBe(
      "2026. 11. 04. 00:30",
    );
  });
});
