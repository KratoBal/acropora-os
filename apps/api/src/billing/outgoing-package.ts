import PDFKitDocument from "pdfkit";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { registerEmbeddedPdfFont } from "../documents/pdf/branded-document.js";
import {
  amountText,
  attachablePdf,
  MONTHS,
} from "../missing-invoices/missing-invoices-package.pdf.js";
import { budapestDayKey } from "../dashboard/budapest-day.js";
import { externalDocumentType } from "./billing-document-list.js";

/**
 * A HAVI KIMENŐ KÖNYVELŐI CSOMAG (hétfői lista N1, Balázs 2026-10-09; a
 * kérés eredete 2026-10-02: „a havi konyveloi exportba az osszes kimeno
 * szamlank is kell majd PDFben mert ki kell nyomtatnunk”).
 *
 * Három forrás: az OS-ben kiállított számla (`Invoice`), a Számlázz.hu
 * felületén kiállított (a feed sora, a PDF-et a `external-invoice-pdf:fill`
 * hozza le) és az eBIZ-ben kiállított (`ExternalBillingDocument`). EGY
 * SZÁMLASZÁM EGY SOR: az OS-ben kiállított számla a Számlázz.hu feedjében is
 * visszajön, és ugyanaz a szám kétszer nem kerülhet a könyvelő elé. Az OS
 * sora nyer (az ő PDF-je a kiállításkor tárolódott), utána a Számlázz.hu-é.
 *
 * A HÓNAP A KELTE SZERINT, BUDAPESTI NAPTÁR SZERINT: az OS a kiállítás
 * pillanatát tárolja, a feed a kelte napját.
 *
 * Díjbekérő és szállítólevél nem számla, nem kerül bele.
 */
export type OutgoingSource = "OS" | "SZAMLAZZ" | "EBIZ";

export const OUTGOING_SOURCE_LABEL: Record<OutgoingSource, string> = {
  OS: "OS",
  SZAMLAZZ: "Számlázz.hu",
  EBIZ: "eBIZ",
};

export interface OutgoingCandidate {
  source: OutgoingSource;
  number: string;
  /** Az OS-nél a kiállítás pillanata, a külsőnél a kelte napja (UTC éjfél). */
  issuedAt: Date;
  fulfillmentDate: Date | null;
  customer: string;
  paymentMethod: string | null;
  /** Tizedes szöveg, pont elválasztóval. */
  gross: string;
  currency: string;
  /** Sztornó, helyesbítő, előleg: a borítón a szám mellett áll. */
  kind: string | null;
  cancelled: boolean;
  /** Díjbekérő vagy szállítólevél: nem kerül a csomagba. */
  notInvoice: boolean;
  /** A tárolt PDF helye, vagy `null`, és akkor a `missingReason`. */
  pdfKey: string | null;
  missingReason: string | null;
}

const SOURCE_ORDER: Record<OutgoingSource, number> = {
  OS: 0,
  SZAMLAZZ: 1,
  EBIZ: 2,
};

const issueDay = (c: OutgoingCandidate) =>
  c.source === "OS"
    ? budapestDayKey(c.issuedAt)
    : c.issuedAt.toISOString().slice(0, 10);

/** A hónap tételei: számlaszámonként egy, kelte, majd szám szerint. */
export function outgoingPackageRows<T extends OutgoingCandidate>(
  month: string,
  candidates: readonly T[],
): (T & { issueDay: string })[] {
  const byNumber = new Map<string, T & { issueDay: string }>();
  for (const candidate of [...candidates].sort(
    (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source],
  )) {
    const day = issueDay(candidate);
    if (candidate.notInvoice || !day.startsWith(`${month}-`)) continue;
    const key = candidate.number.trim();
    if (!key || byNumber.has(key)) continue;
    byNumber.set(key, { ...candidate, issueDay: day });
  }
  return [...byNumber.values()].sort(
    (a, b) =>
      a.issueDay.localeCompare(b.issueDay) ||
      a.number.localeCompare(b.number, "hu"),
  );
}

/** Egy Számlázz.hu vagy eBIZ bizonylattípus díjbekérő vagy szállítólevél-e. */
export function externalNotInvoice(kindCode: string): boolean {
  const type = externalDocumentType(kindCode);
  return type === "PROFORMA" || type === "DELIVERY_NOTE";
}

export type OutgoingOutcome = "ATTACHED" | "NO_FILE" | "NOT_PDF" | "UNREADABLE";

const NOTE: Record<OutgoingOutcome, string> = {
  ATTACHED: "csatolva",
  NO_FILE: "nincs PDF",
  NOT_PDF: "nem PDF, nincs benne",
  UNREADABLE: "a PDF nem olvasható, nincs benne",
};

export interface OutgoingPackageLine {
  row: OutgoingCandidate & { issueDay: string };
  file: Uint8Array | null;
}

/** Forrásonként és devizánként a darab és a bruttó összeg, fillérre pontosan. */
export function outgoingTotals(
  rows: readonly Pick<OutgoingCandidate, "source" | "currency" | "gross">[],
): {
  source: OutgoingSource;
  currency: string;
  count: number;
  gross: string;
}[] {
  const sums = new Map<string, { count: number; cents: bigint }>();
  for (const row of rows) {
    const key = `${row.source}|${row.currency}`;
    const sum = sums.get(key) ?? { count: 0, cents: 0n };
    sum.count++;
    sum.cents += toCents(row.gross);
    sums.set(key, sum);
  }
  return [...sums.entries()]
    .map(([key, sum]) => {
      const [source, currency] = key.split("|") as [OutgoingSource, string];
      return {
        source,
        currency,
        count: sum.count,
        gross: fromCents(sum.cents),
      };
    })
    .sort(
      (a, b) =>
        SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
        a.currency.localeCompare(b.currency),
    );
}

function toCents(amount: string): bigint {
  const negative = amount.trim().startsWith("-");
  const [whole = "0", fraction = ""] = amount
    .trim()
    .replace("-", "")
    .split(".");
  const cents =
    BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${abs / 100n}.${fraction}`;
}

function renderCover(input: {
  month: string;
  company: { name: string; taxNumber: string };
  lines: readonly {
    row: OutgoingPackageLine["row"];
    outcome: OutgoingOutcome;
  }[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFKitDocument({ size: "A4", margin: 40 });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    registerEmbeddedPdfFont(doc);
    const [year, month] = input.month.split("-");
    doc
      .fontSize(16)
      .text(`Kimenő számlák, ${year}. ${MONTHS[Number(month) - 1]}`);
    doc
      .fontSize(10)
      .text(`${input.company.name}, adószám: ${input.company.taxNumber}`)
      .text("A hónap a számla kelte szerint; számlaszámonként egy tétel.")
      .moveDown();
    if (input.lines.length === 0)
      doc.text("Ebben a hónapban nincs kimenő számla.");
    input.lines.forEach(({ row, outcome }, index) => {
      const marks = [
        row.kind,
        row.cancelled ? "sztornózott" : null,
        OUTGOING_SOURCE_LABEL[row.source],
      ].filter(Boolean);
      doc
        .fontSize(10)
        .text(
          `${index + 1}. ${row.number}   ${row.issueDay}   ${row.customer}   ${amountText(row.gross, row.currency)}`,
        );
      doc
        .fontSize(9)
        .text(
          [
            marks.join(", "),
            row.fulfillmentDate
              ? `teljesítés ${row.fulfillmentDate.toISOString().slice(0, 10)}`
              : null,
            row.paymentMethod,
            NOTE[outcome],
          ]
            .filter(Boolean)
            .join("; "),
          { indent: 16 },
        )
        .moveDown(0.3);
    });
    if (input.lines.length > 0) {
      doc.moveDown().fontSize(11).text("Összesítő");
      for (const total of outgoingTotals(input.lines.map((l) => l.row)))
        doc
          .fontSize(10)
          .text(
            `${OUTGOING_SOURCE_LABEL[total.source]}: ${total.count} db, ${amountText(total.gross, total.currency)}`,
          );
      const missing = input.lines.filter((l) => l.outcome !== "ATTACHED");
      doc.moveDown().fontSize(11).text(`PDF nélkül: ${missing.length} db`);
      for (const { row, outcome } of missing)
        doc
          .fontSize(10)
          .text(
            `${row.number} (${OUTGOING_SOURCE_LABEL[row.source]}): ${NOTE[outcome]}${row.missingReason ? `, ${row.missingReason}` : ""}`,
          );
    }
    doc.end();
  });
}

/**
 * A CSOMAG: a borító MINDEN tételt felsorol (a PDF nélkülit is, külön blokkban
 * is), utána a csatolható számlák a borító sorrendjében. Minden lap alján a
 * hónap és az oldalszám, a nyomtatáshoz.
 */
export async function buildOutgoingPackage(input: {
  month: string;
  company: { name: string; taxNumber: string };
  lines: readonly OutgoingPackageLine[];
}): Promise<{ pdf: Buffer; outcomes: OutgoingOutcome[] }> {
  const loaded: PDFDocument[] = [];
  const lines: { row: OutgoingPackageLine["row"]; outcome: OutgoingOutcome }[] =
    [];
  for (const line of input.lines) {
    let outcome: OutgoingOutcome = "NO_FILE";
    if (line.file) {
      const attached = await attachablePdf(line.file);
      outcome = attached.outcome;
      if (attached.pdf) loaded.push(attached.pdf);
    }
    lines.push({ row: line.row, outcome });
  }
  const out = await PDFDocument.create();
  for (const source of [
    await PDFDocument.load(await renderCover({ ...input, lines })),
    ...loaded,
  ])
    for (const page of await out.copyPages(source, source.getPageIndices()))
      out.addPage(page);
  // a lábléc csak számjegy és kötőjel: a beépített betű ennyit biztosan tud
  const font = await out.embedFont(StandardFonts.Helvetica);
  const pages = out.getPages();
  pages.forEach((page, index) => {
    const text = `${input.month}   ${index + 1} / ${pages.length}`;
    page.drawText(text, {
      x: page.getWidth() - 40 - font.widthOfTextAtSize(text, 8),
      y: 16,
      size: 8,
      font,
    });
  });
  return {
    pdf: Buffer.from(await out.save()),
    outcomes: lines.map((l) => l.outcome),
  };
}
