import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attendanceSheet, type AttendanceDayEntry } from "@acropora/types";

import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";
import {
  attendanceMonthLabel,
  attendanceSheetDocument,
} from "./attendance-sheet-document.js";

/*
  WHAT TURNS THIS RED. The month on more than one page (it is printed and signed as one sheet); a row without its date,
  times or hours; a mark not in place of the times ("B", "SZ"); a holiday not named; the totals or a signature line missing;
  the print time not on the page or not in Budapest time; the same sheet printed at the same moment giving other bytes; a
  year without its decree printed without saying so; an accented name losing a letter.
*/
const schedule = {
  validFrom: "2026-10-01",
  days: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    start: "07:00",
    end: "16:00",
  })),
  updatedAt: "2026-10-01T08:00:00.000Z",
};
const entry = (
  date: string,
  kind: AttendanceDayEntry["kind"],
  start: string | null = null,
  end: string | null = null,
): AttendanceDayEntry => ({
  date,
  kind,
  start,
  end,
  updatedAt: "2026-11-13T09:00:00.000Z",
});

const november = attendanceSheet({
  now: new Date("2030-01-01T12:00:00.000Z"),
  month: "2026-11",
  schedules: [schedule],
  entries: [
    entry("2026-11-13", "SICK"),
    entry("2026-11-20", "LEAVE"),
    entry("2026-11-21", "WORKED", "09:00", "13:00"),
  ],
});
const printedAt = new Date("2026-11-13T10:00:00.000Z");

describe("the attendance sheet PDF", () => {
  it("prints the month on one page, with marks, totals, the print time and both signature lines", async () => {
    const bytes = await attendanceSheetDocument({
      sheet: november,
      employeeName: "Őszi Árvíztűrő Tünde",
      printedAt,
    });
    const lines = await readPdfTextLines(bytes);
    const texts = lines.map((line) => line.text);
    assert.deepEqual([...new Set(lines.map((line) => line.pageNumber))], [1]);
    // the eyebrow is letter-spaced, so it reads back with spaces between the letters
    assert.ok(texts.some((text) => text.replace(/\s/g, "") === "JELENLÉTIÍV"));
    for (const expected of [
      "Őszi Árvíztűrő Tünde",
      "2026. november · Acropora Kft.",
      "Dátum Érkezés Távozás Ledolgozott Megjegyzés",
      "11. 01. V Mindenszentek",
      "11. 02. H 07:00 16:00 9:00",
      "11. 13. P B B betegség",
      "11. 20. P SZ SZ szabadság",
      "11. 21. Szo 09:00 13:00 4:00 eltérő munkaidő",
      "11. 28. Szo pihenőnap",
      "Nyomtatva: 2026. 11. 13. 11:00",
      "Munkavállaló aláírása Munkáltató aláírása",
    ])
      assert.ok(
        texts.some((text) => text.replace(/\s+/g, " ").includes(expected)),
        `${expected} is missing; lines: ${JSON.stringify(texts)}`,
      );
    assert.ok(
      texts.some((text) => text.includes("Ledolgozott összesen: 175:00 óra")),
    );
    assert.ok(texts.some((text) => text.includes("Betegség (B): 1 nap")));
    assert.ok(!texts.some((text) => text.includes("áthelyezett munkanapjai")));
  });

  it("gives the same bytes for the same sheet printed at the same moment", async () => {
    const make = () =>
      attendanceSheetDocument({
        sheet: november,
        employeeName: "Kovács Anna",
        printedAt,
      });
    assert.ok((await make()).equals(await make()));
  });

  it("says so when the year's swapped days are not known", async () => {
    const bytes = await attendanceSheetDocument({
      sheet: attendanceSheet({
        now: new Date("2030-01-01T12:00:00.000Z"),
        month: "2027-03",
        schedules: [schedule],
        entries: [],
      }),
      employeeName: "Kovács Anna",
      printedAt,
    });
    const texts = (await readPdfTextLines(bytes)).map((line) => line.text);
    assert.ok(texts.some((text) => text.includes("áthelyezett munkanapjai")));
    assert.ok(texts.some((text) => text.includes("2027. március")));
  });

  it("names the month in Hungarian", () => {
    assert.equal(attendanceMonthLabel("2026-01"), "2026. január");
    assert.equal(attendanceMonthLabel("2026-12"), "2026. december");
  });

  it("prints the month up to today only: today's arrival before the departure, later days empty (Balázs, 2026-11-13)", async () => {
    const midday = new Date("2026-11-13T10:00:00.000Z"); // 11:00 in Budapest
    const bytes = await attendanceSheetDocument({
      sheet: attendanceSheet({
        month: "2026-11",
        schedules: [schedule],
        entries: [entry("2026-11-20", "LEAVE")],
        now: midday,
      }),
      employeeName: "Kovács Anna",
      printedAt: midday,
    });
    const texts = (await readPdfTextLines(bytes)).map((line) =>
      line.text.replace(/\s+/g, " ").trim(),
    );
    assert.ok(
      texts.includes("11. 12. Cs 07:00 16:00 9:00"),
      JSON.stringify(texts),
    );
    assert.ok(texts.includes("11. 13. P 07:00"), JSON.stringify(texts));
    // a later day carries its date and nothing else: no times, no planned leave
    assert.ok(texts.includes("11. 16. H"), JSON.stringify(texts));
    assert.ok(texts.includes("11. 20. P"), JSON.stringify(texts));
    assert.ok(!texts.some((text) => text.includes("SZ SZ")));
    // 2..12 November: 9 days of 9 hours
    assert.ok(
      texts.some((text) => text.includes("Ledolgozott összesen: 81:00 óra")),
    );
  });
});
