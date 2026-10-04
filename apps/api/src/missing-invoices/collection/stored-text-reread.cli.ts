import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";

import { pdfTextLines } from "../../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { InvoiceCollectionRepository } from "./invoice-collection.repository.js";
import {
  rereadReport,
  rereadStoredText,
  type StoredTextSelector,
} from "./stored-text-reread.js";

/**
 * TÁROLT DOKUMENTUMOK SZÖVEG-OLVASATA ÚJRA (`stored-text-reread.ts`).
 *
 *   pnpm --filter @acropora/api invoice-text:reread -- --number HU00008659
 *   pnpm --filter @acropora/api invoice-text:reread -- --ids id1,id2
 *   ... ugyanez `--apply`-jal: csak ekkor ír
 *
 * ALAPBÓL SZÁRAZ: kiírja, melyik dokumentum olvasata mi lenne, és nem ír. Az
 * `--apply` CSAK a megváltozott `textReading` mezőt írja. Kiválasztás nélkül
 * nem fut: egy teljes újraolvasás nem ennek a parancsnak a dolga.
 */
export function parseSelector(
  argv: readonly string[],
): StoredTextSelector | null {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? (argv[at + 1] ?? null) : null;
  };
  const ids = (value("--ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const number = value("--number")?.trim() || null;
  return ids.length > 0 || number ? { ids, number } : null;
}

async function main(argv: readonly string[]): Promise<number> {
  const apply = argv.includes("--apply");
  const selector = parseSelector(argv);
  if (!selector) {
    process.stderr.write(
      "Adj meg kiválasztást: --ids id1,id2 vagy --number <tárolt számlaszám>.\n",
    );
    return 2;
  }
  const repository = new InvoiceCollectionRepository();
  const rows = await rereadStoredText(
    {
      documents: (s) =>
        prisma.incomingSupplierDocument.findMany({
          where: {
            OR: [
              ...(s.ids.length ? [{ id: { in: [...s.ids] } }] : []),
              ...(s.number
                ? [
                    {
                      textReading: {
                        path: ["invoiceNumber"],
                        equals: s.number,
                      },
                    },
                  ]
                : []),
            ],
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            fileName: true,
            subject: true,
            content: true,
            textReading: true,
            importResult: true,
          },
        }),
      lines: (content) => pdfTextLines(content),
      navNumbers: (base) => repository.navNumbers(base),
      save: async (id, reading) => {
        await prisma.incomingSupplierDocument.update({
          where: { id },
          data: { textReading: reading as unknown as Prisma.InputJsonValue },
        });
      },
    },
    selector,
    apply,
  );
  process.stdout.write(
    `${apply ? "ÉLES" : "SZÁRAZ"} szöveg-újraolvasás\n${rereadReport(rows, apply)}`,
  );
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
