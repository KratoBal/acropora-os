import PDFKitDocument from "pdfkit";
import { PDFDocument } from "pdf-lib";

import { registerEmbeddedPdfFont } from "../documents/pdf/branded-document.js";

/** Egy Megvan-tétel a csomagban: a terhelés és a hozzá párosított számlák. */
export interface AccountantPackageEntry {
  bookingDate: string;
  partner: string;
  amount: string;
  currency: string;
  paperOriginal: boolean;
  documents: readonly {
    number: string;
    file: { fileName: string; content: Uint8Array } | null;
  }[];
}

/** Mi lett egy számlával a csomagban; a borító ezt írja ki mellé. */
export type PackageDocumentOutcome =
  "ATTACHED" | "PAPER" | "NOT_PDF" | "UNREADABLE" | "NO_FILE";

const NOTE: Record<PackageDocumentOutcome, string> = {
  ATTACHED: "csatolva",
  PAPER: "papíron megvan",
  NOT_PDF: "nem PDF, nincs benne",
  UNREADABLE: "a PDF nem olvasható, nincs benne",
  NO_FILE: "nincs tárolt fájl",
};

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
];

/** Ezres tagolás sima szóközzel: a beágyazott betűben a keskeny szóköz nincs. */
function amountText(amount: string, currency: string): string {
  const [whole, fraction] = amount.split(".");
  const grouped = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped}${fraction ? `,${fraction}` : ""} ${currency}`;
}

function renderCover(input: {
  month: string;
  company: { name: string; taxNumber: string };
  lines: readonly { entry: AccountantPackageEntry; notes: string[] }[];
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
      .text(`Könyvelői csomag, ${year}. ${MONTHS[Number(month) - 1]}`);
    doc
      .fontSize(10)
      .text(`${input.company.name}, adószám: ${input.company.taxNumber}`)
      .moveDown();
    if (input.lines.length === 0)
      doc.text("Ebben a hónapban nincs Megvan állapotú tétel.");
    for (const { entry, notes } of input.lines) {
      doc
        .fontSize(10)
        .text(
          `${entry.bookingDate}   ${entry.partner}   ${amountText(entry.amount, entry.currency)}`,
        );
      doc.fontSize(9).text(notes.join("; "), { indent: 16 }).moveDown(0.4);
    }
    doc.end();
  });
}

/**
 * A HÓNAP MEGVAN-DOKUMENTUMAI EGY PDF-BEN: elöl egy borító, ami MINDEN tételt
 * felsorol, utána a csatolható eredetik a borító sorrendjében.
 *
 * A BORÍTÓ AZÉRT SOROL FEL MINDENT, NEM CSAK A CSATOLTAKAT: egy papíron meglévő
 * vagy nem PDF eredeti a csomagból kimarad, és ha a borító sem említené, a
 * könyvelő nem tudná, hogy hiányzik-e, vagy csak máshol van.
 */
export async function buildAccountantPackage(input: {
  month: string;
  company: { name: string; taxNumber: string };
  entries: readonly AccountantPackageEntry[];
}): Promise<{
  pdf: Buffer;
  outcomes: PackageDocumentOutcome[];
}> {
  const loaded: PDFDocument[] = [];
  const outcomes: PackageDocumentOutcome[] = [];
  const lines: { entry: AccountantPackageEntry; notes: string[] }[] = [];
  for (const entry of input.entries) {
    const notes: string[] = [];
    if (entry.documents.length === 0 && entry.paperOriginal) {
      outcomes.push("PAPER");
      notes.push(NOTE.PAPER);
    }
    for (const document of entry.documents) {
      let outcome: PackageDocumentOutcome;
      if (!document.file) outcome = entry.paperOriginal ? "PAPER" : "NO_FILE";
      else if (
        Buffer.from(document.file.content.subarray(0, 5)).toString("latin1") !==
        "%PDF-"
      )
        outcome = "NOT_PDF";
      else {
        /*
          A BETÖLTÉS MAGA NEM ELÉG PRÓBA: egy csonka fájlt a pdf-lib hiba nélkül
          „betölt”, és csak a lapok másolásakor dob, akkor viszont az EGÉSZ
          csomagot viszi magával. Ezért itt a lapszámot is lekérjük.
        */
        try {
          const pdf = await PDFDocument.load(document.file.content, {
            ignoreEncryption: true,
          });
          if (pdf.getPageCount() === 0) throw new Error("nincs lapja");
          loaded.push(pdf);
          outcome = "ATTACHED";
        } catch {
          outcome = "UNREADABLE";
        }
      }
      outcomes.push(outcome);
      notes.push(`${document.number || "szám nélkül"}: ${NOTE[outcome]}`);
    }
    lines.push({ entry, notes });
  }

  const out = await PDFDocument.create();
  for (const source of [
    await PDFDocument.load(await renderCover({ ...input, lines })),
    ...loaded,
  ])
    for (const page of await out.copyPages(source, source.getPageIndices()))
      out.addPage(page);
  return { pdf: Buffer.from(await out.save()), outcomes };
}
