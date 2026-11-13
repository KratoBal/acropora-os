import {
  ACROPORA_COMPANY,
  type AttendanceSheet,
  type AttendanceSheetRow,
} from "@acropora/types";

import {
  createBrandedPdf,
  drawDocumentFooter,
  drawDocumentHeader,
  PDF_CONTENT_WIDTH,
  PDF_FIRST_CONTENT_TOP,
  PDF_INK,
  PDF_LEFT,
  PDF_MUTED,
  PDF_RULE,
} from "../documents/pdf/branded-document.js";

const MONTHS = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
] as const;
const WEEKDAYS = ["H", "K", "Sze", "Cs", "P", "Szo", "V"] as const;

const BUDAPEST_DATE_TIME = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "2026-11" -> "2026. november". */
export const attendanceMonthLabel = (month: string): string =>
  `${month.slice(0, 4)}. ${MONTHS[Number(month.slice(5, 7)) - 1]}`;

/** 540 -> "9:00". */
export const hours = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** "2026-11-02" -> "11. 02. H". */
const dayCell = (row: AttendanceSheetRow) =>
  `${row.date.slice(5, 7)}. ${row.date.slice(8, 10)}. ${WEEKDAYS[row.weekday - 1]}`;

/** What the note column says; the marks themselves stand in the time columns, as on Luca's paper sheet. */
function note(row: AttendanceSheetRow): string {
  // a day after today prints empty: the sheet is filled up to today only (Balázs, 2026-11-13)
  if (row.future) return "";
  switch (row.kind) {
    case "WORK":
      return row.source === "ENTRY" ? "eltérő munkaidő" : "";
    case "SICK":
      return "betegség";
    case "LEAVE":
      return "szabadság";
    case "DAY_OFF":
      return "szabadnap";
    case "HOLIDAY":
      return row.holiday ?? "munkaszüneti nap";
    case "SWAPPED_REST":
      return "áthelyezett pihenőnap";
    case "FREE":
      return "pihenőnap";
    case "NO_SCHEDULE":
      return "nincs munkarend";
  }
}

const COLUMNS = [
  { title: "Dátum", width: 82 },
  { title: "Érkezés", width: 62 },
  { title: "Távozás", width: 62 },
  { title: "Ledolgozott", width: 70 },
  { title: "Megjegyzés", width: PDF_CONTENT_WIDTH - 82 - 62 - 62 - 70 },
] as const;
const ROW_HEIGHT = 13.6;
const FONT_SIZE = 8.6;

/** The cells of a row exactly as the PDF prints them (also what the signed copy's hash is taken from, S2d). */
export function rowCells(row: AttendanceSheetRow): string[] {
  return [
    dayCell(row),
    row.start ?? row.mark ?? "",
    row.end ?? row.mark ?? "",
    // hours only for a finished day: today before the departure prints the arrival alone
    row.kind === "WORK" && row.end ? hours(row.minutes) : "",
    note(row),
  ];
}

function drawRow(
  document: PDFKit.PDFDocument,
  cells: readonly string[],
  y: number,
  color: string,
) {
  let x = PDF_LEFT;
  cells.forEach((cell, index) => {
    document
      .fillColor(color)
      .fontSize(FONT_SIZE)
      .text(cell, x + 2, y + 3, {
        width: COLUMNS[index]!.width - 4,
        lineBreak: false,
        ellipsis: true,
      });
    x += COLUMNS[index]!.width;
  });
}

function rule(document: PDFKit.PDFDocument, y: number, width = 0.5) {
  document
    .moveTo(PDF_LEFT, y)
    .lineTo(PDF_LEFT + PDF_CONTENT_WIDTH, y)
    .strokeColor(PDF_RULE)
    .lineWidth(width)
    .stroke();
}

/**
 * THE MONTHLY ATTENDANCE SHEET AS A PDF (os-jelenleti-iv, S2c): one page per employee per month, in Luca's paper format
 * (date, arrival, departure, hours worked; "B" and "SZ" in place of the times), the totals, and the two signature lines
 * (Balázs 2026-11-13 07:54 UTC: kept digitally, signed on paper at month end).
 *
 * Downloadable any time, the current month too, as it stands (Luca, for an inspection): the print time is on the page, so a
 * printed copy says which moment it shows. `printedAt` is passed in, so the same sheet printed at the same moment gives the
 * same bytes.
 */
export function attendanceSheetDocument(input: {
  sheet: AttendanceSheet;
  employeeName: string;
  printedAt: Date;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = createBrandedPdf({ creationDate: input.printedAt });
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    try {
      drawDocumentHeader(document, {
        eyebrow: "JELENLÉTI ÍV",
        title: input.employeeName,
        subtitle: `${attendanceMonthLabel(input.sheet.month)} · ${ACROPORA_COMPANY.name}`,
      });

      let y = PDF_FIRST_CONTENT_TOP - 8;
      drawRow(
        document,
        COLUMNS.map((column) => column.title),
        y,
        PDF_MUTED,
      );
      y += ROW_HEIGHT;
      rule(document, y, 0.75);
      for (const row of input.sheet.rows) {
        const resting = row.kind !== "WORK" && row.mark === null;
        drawRow(document, rowCells(row), y, resting ? PDF_MUTED : PDF_INK);
        y += ROW_HEIGHT;
        rule(document, y);
      }

      y += 10;
      document
        .fillColor(PDF_INK)
        .fontSize(9.5)
        .text(
          `Ledolgozott összesen: ${hours(input.sheet.totalMinutes)} óra   ·   Betegség (B): ${input.sheet.sickDays} nap   ·   Szabadság (SZ): ${input.sheet.leaveDays} nap`,
          PDF_LEFT,
          y,
          { width: PDF_CONTENT_WIDTH },
        );
      y += 16;
      if (!input.sheet.swapsDecree) {
        document
          .fillColor(PDF_MUTED)
          .fontSize(8)
          .text(
            "Az év áthelyezett munkanapjai nincsenek a rendszerben: ezeket a napokat egyenként jelölték.",
            PDF_LEFT,
            y,
            { width: PDF_CONTENT_WIDTH },
          );
        y += 14;
      }
      document
        .fillColor(PDF_MUTED)
        .fontSize(8)
        .text(
          `Nyomtatva: ${BUDAPEST_DATE_TIME.format(input.printedAt)}`,
          PDF_LEFT,
          y,
          { width: PDF_CONTENT_WIDTH },
        );

      const signY = 740;
      const half = PDF_CONTENT_WIDTH / 2;
      for (const [index, label] of [
        "Munkavállaló aláírása",
        "Munkáltató aláírása",
      ].entries()) {
        const x = PDF_LEFT + index * half;
        document
          .moveTo(x + 10, signY)
          .lineTo(x + half - 20, signY)
          .strokeColor(PDF_INK)
          .lineWidth(0.6)
          .stroke();
        document
          .fillColor(PDF_MUTED)
          .fontSize(8)
          .text(label, x + 10, signY + 4, {
            width: half - 30,
            align: "center",
          });
      }

      drawDocumentFooter(document, "OFFICE");
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}
