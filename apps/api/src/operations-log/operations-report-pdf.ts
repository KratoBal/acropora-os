import {
  ACROPORA_COMPANY,
  OPERATIONS_FREQUENCY_LABELS,
  addDays,
  partnerStatusLabel,
  type OperationsReport,
  type OperationsReportAssetBlock,
  type OperationsReportEntryRow,
  type ServiceJobStatusValue,
} from "@acropora/types";

import {
  A4_WIDTH,
  addPage,
  createBrandedPdf,
  PDF_BOLD_FONT,
  PDF_REGULAR_FONT,
  registerNotoSans,
} from "../documents/pdf/branded-document.js";
import { drawAcroporaLogo } from "../documents/pdf/acropora-logo.js";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ HAVI KIMUTATÁSA PDF-BEN (task os-uzemeltetesi-naplo, S4). Csak rajzol: a sorokat, az összegeket és a
 * kimaradásokat a közös `buildOperationsReport` adja (`@acropora/types`), ugyanazt, amit a webes felület és a partner nézete (S5)
 * is mutat. Az elrendezés a mérési jelentés PDF-jének mintáját követi (`aquariums/measurement-report-pdf.ts`): logó, cím, összegző
 * doboz, táblázat zebrával, lábléc oldalszámmal.
 *
 * A NÉZŐ SZERINT SZŰRT TARTALOM A SZÁMÍTÁSBAN DÖL EL, NEM ITT: a partner kimutatásában a nevek már „Acropora"-ként érkeznek, és a
 * belső megjegyzés sosem része a bemenetnek. Ez a fájl a megadott szöveget rajzolja, és semmit nem tud a nézőről, kivéve a jegy
 * állapotának feliratát: a partner a négy látszó állapotot látja (`partnerStatusLabel`), a belső nézet a nyolcat.
 */
export interface OperationsReportPdfInput {
  report: OperationsReport;
  /** „Partner · Helyszín" vagy az eszköz neve a fejléchez. */
  subject: string;
  generatedAt: string;
}

const LEFT = 44;
const CONTENT_WIDTH = A4_WIDTH - 2 * LEFT;
const RIGHT_EDGE = LEFT + CONTENT_WIDTH;
const CONTINUATION_TOP = 70;
const BOTTOM = 770;
const FOOTER_RULE = 787;

const NAVY = "#143149";
const TEAL = "#1d7085";
const MUTED = "#687986";
const BODY = "#263640";
const RULE = "#d5dee3";
const BOX = "#f3f7f8";
const WARN = "#98520d";
const ALERT = "#b4232f";

/** Oszlopok: dátum, feladat, tartam, vízóra, végezte, megjegyzés. */
const COLUMN_X = [
  LEFT + 7,
  LEFT + 70,
  LEFT + 183,
  LEFT + 228,
  LEFT + 332,
  LEFT + 410,
] as const;
const COLUMN_W = [58, 108, 40, 98, 74, 90] as const;
const HEAD_HEIGHT = 24;
const MIN_ROW = 22;

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

/** A BELSŐ NYOLC ÁLLAPOT FELIRATA (ugyanaz, mint a webes `service-job-labels.ts`; a partner a négy látszót kapja a szervertől). */
const INTERNAL_STATUS_LABEL: Record<ServiceJobStatusValue, string> = {
  NEW: "Új",
  TRIAGED: "Felmérve",
  SCHEDULED: "Ütemezve",
  IN_PROGRESS: "Folyamatban",
  WAITING_FOR_PARTS: "Alkatrészre vár",
  WAITING_FOR_CUSTOMER: "Ügyfélre vár",
  COMPLETED: "Elkészült",
  CANCELLED: "Meghiúsult",
};

export function monthTitle(month: string): string {
  const [year, mm] = month.split("-").map(Number) as [number, number];
  return `${year}. ${MONTHS[mm - 1]}`;
}

/** „2 óra 5 perc", „45 perc", „—" nullánál. */
export function durationText(minutes: number): string {
  if (minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} perc`;
  return rest === 0 ? `${hours} óra` : `${hours} óra ${rest} perc`;
}

/** Magyar tizedesvesszős szám, legfeljebb 3 tizedesjeggyel, felesleges nullák nélkül. */
export function numberText(value: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 3 }).format(
    value,
  );
}

function dateTimeText(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")}.${get("day")}. ${get("hour")}:${get("minute")}`;
}

function periodText(
  period: string,
  frequency: "DAILY" | "WEEKLY" | "OCCASIONAL",
): string {
  const [, m, d] = period.split("-");
  if (frequency === "WEEKLY") {
    const [, em, ed] = addDays(period, 6).split("-");
    return `${m}.${d}.–${em}.${ed}.`;
  }
  return `${m}.${d}.`;
}

/**
 * A VÍZÓRA CELLÁJA HÁROM SORBAN (előtte, utána, különbség), NYÍL NÉLKÜL: a Noto Sans nem ismeri a nyilakat, és a pdfkit a hiányzó
 * karaktert szó nélkül üres négyzetként rajzolja (a mérési jelentés fejléce ugyanezt rögzíti). Egy hiányzó érték kérdőjel.
 */
function meterText(row: OperationsReportEntryRow): string {
  if (row.meterBefore === null && row.meterAfter === null) return "—";
  const unit = row.meterUnit ? ` ${row.meterUnit}` : "";
  const lines = [
    `előtte: ${row.meterBefore === null ? "?" : `${numberText(row.meterBefore)}${unit}`}`,
    `utána: ${row.meterAfter === null ? "?" : `${numberText(row.meterAfter)}${unit}`}`,
  ];
  if (row.meterDifference !== null)
    lines.push(
      `különbség: ${row.meterDifference > 0 ? "+" : ""}${numberText(row.meterDifference)}${unit}${row.meterSuspicious ? " (ellenőrizendő)" : ""}`,
    );
  return lines.join("\n");
}

function notesText(
  row: OperationsReportEntryRow,
  audience: OperationsReport["audience"],
): string {
  if (!row.anomaly) return "";
  const parts = [`Rendellenesség: ${row.anomalyNote ?? ""}`.trim()];
  if (row.ticket) {
    const status =
      audience === "PARTNER"
        ? partnerStatusLabel(row.ticket.status as ServiceJobStatusValue)
        : (INTERNAL_STATUS_LABEL[row.ticket.status as ServiceJobStatusValue] ??
          row.ticket.status);
    parts.push(`Hibajegy: ${row.ticket.jobNumber} (${status})`);
  }
  return parts.join("\n");
}

interface Style {
  size: number;
  color: string;
  bold?: boolean;
}

function write(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  style: Style,
  width: number,
  align: "left" | "right" = "left",
) {
  doc
    .font(style.bold ? PDF_BOLD_FONT : PDF_REGULAR_FONT)
    .fontSize(style.size)
    .fillColor(style.color)
    .text(text, x, y, { width, align, lineGap: 2 });
}

function measure(
  doc: PDFKit.PDFDocument,
  text: string,
  size: number,
  width: number,
): number {
  doc.font(PDF_REGULAR_FONT).fontSize(size);
  return doc.heightOfString(text, { width, lineGap: 2 });
}

function rule(doc: PDFKit.PDFDocument, y: number) {
  doc
    .moveTo(LEFT, y)
    .lineTo(RIGHT_EDGE, y)
    .strokeColor(RULE)
    .lineWidth(0.75)
    .stroke();
}

const HEADING_HEIGHT = 29;

function heading(doc: PDFKit.PDFDocument, title: string, y: number): number {
  write(
    doc,
    title.toUpperCase(),
    LEFT,
    y,
    { size: 10, color: TEAL, bold: true },
    CONTENT_WIDTH,
  );
  rule(doc, y + 19);
  return y + HEADING_HEIGHT;
}

export function renderOperationsReportPdf(
  input: OperationsReportPdfInput,
): Promise<Buffer> {
  const { report } = input;
  // a fájl tartalma a bemenet függvénye: a létrehozás ideje a kimutatás készítésének ideje, nem a renderelésé
  const doc = createBrandedPdf({ creationDate: new Date(input.generatedAt) });
  registerNotoSans(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  let y = drawHeader(doc, input);
  const newPage = () => {
    addPage(doc);
    y = CONTINUATION_TOP;
  };
  const ensure = (height: number) => {
    if (y + height > BOTTOM) newPage();
  };

  // összegző dobozok
  const boxes: [string, string][] = [
    ["Elvégzett feladat", String(report.totals.entries)],
    ["Összes idő", durationText(report.totals.totalMinutes)],
    ["Rendellenesség", String(report.totals.anomalies)],
    ["Kimaradt ütemezett", String(report.totals.missed)],
  ];
  const boxWidth = (CONTENT_WIDTH - 3 * 10) / 4;
  boxes.forEach(([label, value], index) => {
    const x = LEFT + index * (boxWidth + 10);
    doc.roundedRect(x, y, boxWidth, 44, 3).fillColor(BOX).fill();
    write(doc, label, x + 9, y + 8, { size: 7.6, color: MUTED }, boxWidth - 12);
    const warn =
      (index === 2 && report.totals.anomalies > 0) ||
      (index === 3 && report.totals.missed > 0);
    write(
      doc,
      value,
      x + 9,
      y + 21,
      { size: 13, color: warn ? ALERT : NAVY, bold: true },
      boxWidth - 12,
    );
  });
  y += 64;

  if (report.assets.length === 0) {
    ensure(40);
    write(
      doc,
      "Ebben a hónapban nincs rögzített bejegyzés.",
      LEFT,
      y,
      { size: 10, color: MUTED },
      CONTENT_WIDTH,
    );
    y += 30;
  }

  for (const block of report.assets) {
    drawAssetBlock(doc, block, report.audience, {
      get y() {
        return y;
      },
      set y(value: number) {
        y = value;
      },
      ensure,
      newPage,
    });
  }

  if (report.missed.length > 0) {
    ensure(HEADING_HEIGHT + 30);
    y = heading(doc, "Kimaradt ütemezett feladatok", y);
    for (const item of report.missed) {
      const periods = item.periods
        .map((period) => periodText(period, item.frequency))
        .join(", ");
      const text = `${item.assetLabel} · ${item.templateName} (${OPERATIONS_FREQUENCY_LABELS[item.frequency].toLowerCase()}): ${periods}`;
      const height = measure(doc, text, 8.4, CONTENT_WIDTH - 14);
      ensure(height + 8);
      write(
        doc,
        text,
        LEFT + 7,
        y,
        { size: 8.4, color: WARN },
        CONTENT_WIDTH - 14,
      );
      y += height + 6;
    }
    y += 6;
    ensure(24);
    write(
      doc,
      "A mai nap, a sablon létrehozásának ideje és a kivezetett vagy alkalmi sablonok nem számítanak kimaradásnak.",
      LEFT,
      y,
      { size: 7.4, color: MUTED },
      CONTENT_WIDTH,
    );
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.rect(0, 0, A4_WIDTH, 9).fillColor(NAVY).fill();
    if (i > 0)
      write(
        doc,
        `ÜZEMELTETÉSI NAPLÓ · ${monthTitle(report.month).toUpperCase()}`,
        LEFT,
        30,
        { size: 11, color: NAVY, bold: true },
        CONTENT_WIDTH,
      );
    drawFooter(doc, i + 1, range.count);
  }
  doc.end();
  return done;
}

interface Cursor {
  y: number;
  ensure(height: number): void;
  newPage(): void;
}

function drawAssetBlock(
  doc: PDFKit.PDFDocument,
  block: OperationsReportAssetBlock,
  audience: OperationsReport["audience"],
  cursor: Cursor,
) {
  cursor.ensure(HEADING_HEIGHT + HEAD_HEIGHT + MIN_ROW);
  cursor.y = heading(doc, block.assetLabel, cursor.y);
  const drawHead = () => {
    doc
      .roundedRect(LEFT, cursor.y, CONTENT_WIDTH, HEAD_HEIGHT, 2)
      .fillColor(NAVY)
      .fill();
    ["Időpont", "Feladat", "Tartam", "Vízóra", "Végezte", "Megjegyzés"].forEach(
      (text, i) =>
        write(
          doc,
          text,
          COLUMN_X[i]!,
          cursor.y + 7,
          { size: 7.6, color: "#ffffff", bold: true },
          COLUMN_W[i]!,
        ),
    );
    cursor.y += HEAD_HEIGHT;
  };
  drawHead();
  block.entries.forEach((row, index) => {
    const cells = [
      dateTimeText(row.startedAt),
      `${row.templateName}\n${OPERATIONS_FREQUENCY_LABELS[row.frequency]}`,
      durationText(row.minutes),
      meterText(row),
      row.performers.join("\n"),
      notesText(row, audience),
    ];
    const height = Math.max(
      MIN_ROW,
      ...cells.map((text, i) => measure(doc, text, 7.4, COLUMN_W[i]!) + 10),
    );
    if (cursor.y + height > BOTTOM) {
      cursor.newPage();
      drawHead();
    }
    if (index % 2 === 0)
      doc.rect(LEFT, cursor.y, CONTENT_WIDTH, height).fillColor(BOX).fill();
    cells.forEach((text, i) => {
      const alert = i === 5 && row.anomaly;
      const warn = i === 3 && row.meterSuspicious;
      write(
        doc,
        text,
        COLUMN_X[i]!,
        cursor.y + 5,
        { size: 7.4, color: alert ? ALERT : warn ? WARN : BODY },
        COLUMN_W[i]!,
      );
    });
    cursor.y += height;
  });
  // az eszköz összegző sora
  const summary = [
    `Összesen ${block.entries.length} bejegyzés`,
    durationText(block.totalMinutes),
    block.meterTotal !== null
      ? `vízóra: ${block.meterTotal > 0 ? "+" : ""}${numberText(block.meterTotal)}${block.meterUnit ? ` ${block.meterUnit}` : ""}`
      : null,
    block.anomalies > 0 ? `${block.anomalies} rendellenesség` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  cursor.ensure(22);
  write(
    doc,
    summary,
    LEFT + 7,
    cursor.y + 6,
    { size: 8, color: NAVY, bold: true },
    CONTENT_WIDTH - 14,
  );
  cursor.y += 30;
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  input: OperationsReportPdfInput,
): number {
  drawAcroporaLogo(doc, LEFT, 40, 76);
  write(
    doc,
    "ÜZEMELTETÉSI NAPLÓ · HAVI KIMUTATÁS",
    132,
    43,
    { size: 16, color: NAVY, bold: true },
    RIGHT_EDGE - 132,
  );
  write(
    doc,
    input.subject,
    132,
    66,
    { size: 10, color: BODY, bold: true },
    RIGHT_EDGE - 132,
  );
  write(
    doc,
    monthTitle(input.report.month),
    132,
    82,
    { size: 9, color: MUTED },
    RIGHT_EDGE - 132,
  );
  rule(doc, 104);
  return 124;
}

function drawFooter(doc: PDFKit.PDFDocument, page: number, pages: number) {
  const c = ACROPORA_COMPANY;
  rule(doc, FOOTER_RULE);
  write(
    doc,
    `${c.name} · TENGERI AKVÁRIUMOK · TERVEZÉS · KIVITELEZÉS`,
    LEFT,
    FOOTER_RULE + 7,
    { size: 7.1, color: MUTED },
    440,
  );
  write(
    doc,
    `${c.address} · ${c.phone} · ${c.web} · ${c.email}`,
    LEFT,
    FOOTER_RULE + 20,
    { size: 7, color: MUTED },
    440,
  );
  write(
    doc,
    `${page} / ${pages}`,
    RIGHT_EDGE - 50,
    FOOTER_RULE + 8,
    { size: 8, color: NAVY, bold: true },
    50,
    "right",
  );
}
