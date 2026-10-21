import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";

import { startOfBudapestDay } from "../../dashboard/budapest-day.js";
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
 *   pnpm --filter @acropora/api invoice-text:reread -- --unread-uploads
 *   pnpm --filter @acropora/api invoice-text:reread -- --failed-uploads --since 2026-10-01
 *   ... ugyanez `--apply`-jal: csak ekkor ír
 *   ... és `--allow-clear`-rel: csak ekkor írhat meglévő számot üresre
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
  const unreadUploads = argv.includes("--unread-uploads");
  const failedUploads = argv.includes("--failed-uploads");
  const sinceText = value("--since");
  // a --since csak napot fogad, és csak a --failed-uploads mellett: egy elírt
  // dátum nem futhat csendben az összes feltöltésre
  if (
    argv.includes("--since") &&
    (!failedUploads || sinceText === null || !isDay(sinceText))
  )
    return null;
  // a nap budapesti éjfele: a 10-01-i feltöltés 00:30-kor is a 10-01-é
  const since =
    sinceText === null
      ? null
      : startOfBudapestDay(new Date(`${sinceText}T12:00:00Z`));
  return ids.length > 0 || number || unreadUploads || failedUploads
    ? {
        ids,
        number,
        ...(unreadUploads ? { unreadUploads: true as const } : {}),
        ...(failedUploads ? { failedUploads: { since } } : {}),
      }
    : null;
}

const isDay = (text: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(text) &&
  !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) &&
  new Date(`${text}T00:00:00Z`).toISOString().startsWith(text);

async function main(argv: readonly string[]): Promise<number> {
  const apply = argv.includes("--apply");
  const allowClear = argv.includes("--allow-clear");
  const selector = parseSelector(argv);
  if (!selector) {
    process.stderr.write(
      "Adj meg kiválasztást: --ids id1,id2, --number <tárolt számlaszám>, --unread-uploads vagy --failed-uploads [--since ÉÉÉÉ-HH-NN].\n",
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
              ...(s.unreadUploads
                ? [
                    {
                      origin: "UPLOAD",
                      importResult: { equals: Prisma.AnyNull },
                      textReading: { equals: Prisma.AnyNull },
                    },
                  ]
                : []),
              ...(s.failedUploads
                ? [
                    {
                      origin: "UPLOAD",
                      status: "FAILED" as const,
                      importResult: { equals: Prisma.AnyNull },
                      ...(s.failedUploads.since
                        ? { createdAt: { gte: s.failedUploads.since } }
                        : {}),
                    },
                  ]
                : []),
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
            kind: true,
            origin: true,
          },
        }),
      lines: (content) => pdfTextLines(content),
      navNumbers: (base) => repository.navNumbers(base),
      knownNumbers: () => repository.knownNumbers(),
      // a kézi feltöltés párosított terhelése (feltöltés vagy díjértesítő)
      narratives: async (documentId) =>
        (
          await prisma.bankTransactionMatch.findMany({
            where: {
              documentId,
              documentSource: { in: ["UPLOAD", "PREMIUM_NOTICE"] },
            },
            select: { bankTransaction: { select: { narrative: true } } },
          })
        ).map((match) => match.bankTransaction.narrative),
      save: async (id, reading, kind) => {
        await prisma.incomingSupplierDocument.update({
          where: { id },
          data: {
            textReading: reading as unknown as Prisma.InputJsonValue,
            ...(kind === "INVOICE" || kind === "PROFORMA" ? { kind } : {}),
          },
        });
      },
    },
    selector,
    apply,
    allowClear,
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
