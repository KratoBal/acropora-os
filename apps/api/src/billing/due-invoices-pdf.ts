import PDFKitDocument from "pdfkit";
import {
  DUE_INVOICE_ACCOUNT_SOURCE_NOTES,
  probablyNotTransferNote,
  type DueInvoiceItem,
  type DueInvoicesResponse,
  type ProbablyNotTransferItem,
} from "@acropora/types";

import { registerEmbeddedPdfFont } from "../documents/pdf/branded-document.js";

/**
 * A LEJÁRÓ SZÁMLÁK PDF-JE (Balázs, 2026-11-20; acrobot 58228, 58230). A neve (a PDF címe ÉS a fájlneve): „Lejáró számlák - Utalási
 * jegyzék”, kötőjellel, helyes ékezettel. A TETEJÉN MINDIG ott áll az utolsó banki betöltés ideje („Utolsó banki adat: …”): aki olvassa,
 * ebből tudja, milyen friss bankadatra épül a „kifizetve” állapot. Fekvő A4, mert a bankszámlaszám és a közlemény széles.
 */
export const DUE_INVOICES_PDF_TITLE = "Lejáró számlák - Utalási jegyzék";
export const DUE_INVOICES_PDF_FILENAME = `${DUE_INVOICES_PDF_TITLE}.pdf`;

const MARGIN = 36;
const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const BOTTOM = PAGE_HEIGHT - 40;
const INK = "#18353d";
const MUTED = "#56777e";
const RULE = "#c9dadd";
const RED = "#a32020";
const AMBER = "#9a5b00";

const COLUMNS = [
  { key: "supplier", title: "Cég", width: 205 },
  { key: "due", title: "Fizetési határidő", width: 120 },
  { key: "account", title: "Bankszámlaszám", width: 175 },
  { key: "amount", title: "Összeg (hátralék)", width: 110, right: true },
  { key: "reference", title: "Közlemény", width: 160 },
] as const;

const NO_DATA = "nincs adat";

/** A második szakasz címe és magyarázata (acrobot 58830): a sor NEM esett ki, csak nem az utalandó összegben áll. */
export const PROBABLY_NOT_TRANSFER_TITLE = "Valószínűleg nem utalandó";
export const PROBABLY_NOT_TRANSFER_EXPLANATION =
  "A fizetési mód hiányzik a számláról, és a szállító másik számláit kártyával fizettük. Nem kerültek ki a jegyzékből: ha a szállító mégis utalást kér, itt látszik. Az összegük nincs benne a fenti hátralékban.";

/** Ezres tagolás sima szóközzel (a beágyazott betűben nincs keskeny szóköz). */
export function pdfAmount(amount: string, currency: string): string {
  const [whole, fraction] = amount.split(".");
  const grouped = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped}${fraction ? `,${fraction}` : ""} ${currency}`;
}

/** `2026-11-23` -> `2026. 11. 23.` */
const dayText = (day: string) =>
  day.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1. $2. $3.");

const TIME = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const timeText = (value: Date) =>
  TIME.format(value)
    .replace(/\s+/g, " ")
    .replace(/\.\s?(\d)/, ". $1");

export function buildDueInvoicesPdf(input: {
  list: DueInvoicesResponse;
  /** az utolsó banki betöltés ideje (`BankTransaction.createdAt` legnagyobb értéke); `null`: nincs betöltött bankadat */
  lastBankData: Date | null;
  generatedAt: Date;
  /** igaz, ha a levél a legkésőbbi időpont miatt ment, mert aznap nem jött új banki adat */
  lateNotice: boolean;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFKitDocument({
      size: "A4",
      layout: "landscape",
      margin: MARGIN,
      info: {
        Title: DUE_INVOICES_PDF_TITLE,
        Producer: "Acropora OS",
        Creator: "Acropora OS",
        CreationDate: input.generatedAt,
      },
    });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    registerEmbeddedPdfFont(doc);

    const { list } = input;
    doc
      .fillColor(INK)
      .fontSize(16)
      .text(DUE_INVOICES_PDF_TITLE, MARGIN, MARGIN);
    doc
      .fontSize(10)
      .fillColor(INK)
      .text(
        input.lastBankData
          ? `Utolsó banki adat: ${timeText(input.lastBankData)}`
          : "Utolsó banki adat: nincs betöltött bankadat",
      );
    if (input.lateNotice)
      doc
        .fillColor(AMBER)
        .text(
          "Ma még nem érkezett új banki adat: a kifizetettség a legutóbbi betöltésen alapul.",
        );
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .text(
        `Készült: ${timeText(input.generatedAt)}. A lejáratot erre a napra mérjük: ${dayText(list.asOf)}`,
      );
    doc
      .fillColor(INK)
      .fontSize(10)
      .text(
        `${list.summary.count} számla${
          list.summary.overdue > 0
            ? `, ebből ${list.summary.overdue} lejárt`
            : ""
        }${
          list.summary.withMissingData > 0
            ? `, ${list.summary.withMissingData} sorból hiányzik adat`
            : ""
        }. Hátralék: ${
          list.summary.totals
            .map((t) => pdfAmount(t.outstanding, t.currency))
            .join(" + ") || "0"
        }.`,
      );
    doc.moveDown(0.6);

    const drawHeader = (y: number) => {
      let x = MARGIN;
      doc.fontSize(8.5).fillColor(MUTED);
      for (const column of COLUMNS) {
        doc.text(column.title, x, y, {
          width: column.width - 8,
          align: "right" in column && column.right ? "right" : "left",
        });
        x += column.width;
      }
      doc
        .moveTo(MARGIN, y + 13)
        .lineTo(PAGE_WIDTH - MARGIN, y + 13)
        .strokeColor(RULE)
        .lineWidth(0.75)
        .stroke();
      return y + 18;
    };

    let y = drawHeader(doc.y);
    if (list.items.length === 0)
      doc
        .fillColor(INK)
        .fontSize(10)
        .text(
          "Nincs kifizetetlen, átutalással fizetendő bejövő számla.",
          MARGIN,
          y,
        );
    const drawItems = (
      items: readonly (DueInvoiceItem | ProbablyNotTransferItem)[],
    ) => {
      for (const item of items) {
        const cells = cellsOf(
          item,
          "evidence" in item ? probablyNotTransferNote(item.evidence) : null,
        );
        doc.fontSize(9);
        const height = Math.max(
          ...cells.map((cell, index) =>
            doc.heightOfString(cell.text, { width: COLUMNS[index]!.width - 8 }),
          ),
        );
        if (y + height + 6 > BOTTOM) {
          doc.addPage({ size: "A4", layout: "landscape", margin: MARGIN });
          y = drawHeader(MARGIN);
        }
        let x = MARGIN;
        cells.forEach((cell, index) => {
          const column = COLUMNS[index]!;
          doc
            .fontSize(9)
            .fillColor(cell.color)
            .text(cell.text, x, y, {
              width: column.width - 8,
              align: "right" in column && column.right ? "right" : "left",
            });
          x += column.width;
        });
        y += height + 6;
        doc
          .moveTo(MARGIN, y - 3)
          .lineTo(PAGE_WIDTH - MARGIN, y - 3)
          .strokeColor(RULE)
          .lineWidth(0.4)
          .stroke();
      }
    };
    drawItems(list.items);

    if (list.probablyNotTransfer.length > 0) {
      const sectionNote = `${list.probablyNotTransfer.length} számla, hátralék: ${
        list.summary.probablyNotTransfer.totals
          .map((t) => pdfAmount(t.outstanding, t.currency))
          .join(" + ") || "0"
      }.`;
      // a cím, a magyarázat és legalább egy sor együtt kerüljön az oldalra
      if (y + 90 > BOTTOM) {
        doc.addPage({ size: "A4", layout: "landscape", margin: MARGIN });
        y = MARGIN;
      } else y += 12;
      doc
        .fillColor(INK)
        .fontSize(12)
        .text(PROBABLY_NOT_TRANSFER_TITLE, MARGIN, y);
      doc
        .fillColor(MUTED)
        .fontSize(9)
        .text(
          `${PROBABLY_NOT_TRANSFER_EXPLANATION} ${sectionNote}`,
          MARGIN,
          doc.y + 2,
          { width: PAGE_WIDTH - 2 * MARGIN },
        );
      y = drawHeader(doc.y + 6);
      drawItems(list.probablyNotTransfer);
    }
    doc.end();
  });
}

/** Egy sor cellái: a szöveg és a szín. A hiányzó adat „nincs adat”, a lejárt határidő jelölve. */
function cellsOf(
  item: DueInvoiceItem,
  note: string | null = null,
): { text: string; color: string }[] {
  return [
    {
      text: [
        item.supplierName,
        item.missing.paymentMethod ? `fizetési mód: ${NO_DATA}` : null,
        note,
      ]
        .filter((line) => line !== null)
        .join("\n"),
      color: INK,
    },
    item.dueDate
      ? {
          text: item.overdue
            ? `${dayText(item.dueDate)}\nLEJÁRT (${item.daysOverdue} napja)`
            : dayText(item.dueDate),
          color: item.overdue ? RED : INK,
        }
      : { text: NO_DATA, color: AMBER },
    item.supplierBankAccount
      ? {
          // a pótolt számlaszám forrása a sorban áll: az utalási jegyzékbe kerülő számot a forrásáról kell megítélni
          text:
            item.supplierBankAccountSource &&
            item.supplierBankAccountSource !== "OWN"
              ? `${item.supplierBankAccount}\n(${DUE_INVOICE_ACCOUNT_SOURCE_NOTES[item.supplierBankAccountSource]})`
              : item.supplierBankAccount,
          color: INK,
        }
      : { text: NO_DATA, color: AMBER },
    { text: pdfAmount(item.outstanding, item.currency), color: INK },
    {
      text: item.referenceIsDefault
        ? `${item.reference}\n(a számla száma)`
        : item.reference,
      color: INK,
    },
  ];
}
