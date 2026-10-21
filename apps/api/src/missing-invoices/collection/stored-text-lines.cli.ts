import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { pdfTextLines } from "../../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { readInvoiceText, withLabelledTotal } from "./invoice-text.js";

/**
 * TÁROLT DOKUMENTUMOK KINYERT SZÖVEGE, CSAK OLVASVA (acrobot 34625, 34672). A
 * feltöltések közül négy külföldi számla szám nélkül maradt az újraolvasás után
 * is; hogy miért, azt a szövegük mondja meg, ami csak élesen van meg. Ez a
 * parancs semmit nem ír: a megadott dokumentumok szövegsorait és a mai olvasó
 * eredményét adja ki, a sorok elé tett sorszámmal.
 *
 *   node dist/missing-invoices/collection/stored-text-lines.cli.js --ids id1,id2
 *
 * A KIMENET SZÁMLASZÖVEG (külső tartalom, személyes adatot is hordozhat): nem
 * naplóba és nem csatornára, hanem fájlba való, és aki elemzi, adatként kezeli.
 * Legfeljebb 120 sor dokumentumonként.
 */
const MAX_LINES = 120;

export function parseIds(argv: readonly string[]): string[] {
  const at = argv.indexOf("--ids");
  const value = at >= 0 ? (argv[at + 1] ?? "") : "";
  return value.startsWith("--")
    ? []
    : value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
}

export function formatDocument(
  id: string,
  fileName: string,
  lines: readonly string[] | null,
): string {
  if (lines === null)
    return `== ${id}\t${fileName}\n(a PDF szövege nem olvasható: nincs szövegréteg vagy hibás fájl)\n`;
  const reading = withLabelledTotal(readInvoiceText([...lines], { fileName }), [
    ...lines,
  ]);
  return [
    `== ${id}\t${fileName}\t${lines.length} sor`,
    `olvasó: szám ${reading.invoiceNumber ?? "-"} (${reading.numberFrom ?? "-"}), adószám ${reading.supplierTaxNumber ?? "-"}, bruttó ${reading.gross ?? "-"} ${reading.currency ?? ""}`.trimEnd(),
    ...lines
      .slice(0, MAX_LINES)
      .map((line, index) => `${String(index + 1).padStart(3, " ")}| ${line}`),
    ...(lines.length > MAX_LINES
      ? [`(... további ${lines.length - MAX_LINES} sor)`]
      : []),
    "",
  ].join("\n");
}

async function main(argv: readonly string[]): Promise<number> {
  const ids = parseIds(argv);
  if (ids.length === 0) {
    process.stderr.write("Add meg a dokumentumokat: --ids id1,id2.\n");
    return 2;
  }
  const documents = await prisma.incomingSupplierDocument.findMany({
    where: { id: { in: ids } },
    select: { id: true, fileName: true, content: true },
  });
  for (const id of ids.filter(
    (wanted) => !documents.some((d) => d.id === wanted),
  ))
    process.stdout.write(`== ${id}\t(nincs ilyen dokumentum)\n`);
  for (const document of documents) {
    let lines: string[] | null;
    try {
      lines = await pdfTextLines(new Uint8Array(document.content));
    } catch {
      lines = null;
    }
    process.stdout.write(formatDocument(document.id, document.fileName, lines));
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
