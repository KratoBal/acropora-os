import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { pdfTextLines } from "../../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { InvoiceCollectionRepository } from "./invoice-collection.repository.js";
import {
  OWN_INVOICE_REVIEW_STATE,
  markOwnInvoices,
  markReport,
} from "./own-invoice-mark.js";

/**
 * A RÉGEN TÁROLT SAJÁT KIMENŐ SZÁMLÁK JELÖLÉSE (`own-invoice-mark.ts`).
 *
 *   pnpm --filter @acropora/api invoice-collection:own-invoices            (száraz)
 *   pnpm --filter @acropora/api invoice-collection:own-invoices -- --apply
 *   pnpm --filter @acropora/api invoice-collection:own-invoices -- --undo --ids a,b
 *
 * ALAPBÓL SZÁRAZ. Az `--apply` a talált dokumentumokra `reviewState =
 * OWN_INVOICE`-t ír, mást nem. Az `--undo` a megnevezett, OWN_INVOICE jelölésű
 * dokumentumokról veszi le (vissza NULL-ra); azonosító nélkül nem fut.
 */
async function main(argv: readonly string[]): Promise<number> {
  const apply = argv.includes("--apply");
  const ki = (text: string) => process.stdout.write(text);

  if (argv.includes("--undo")) {
    const at = argv.indexOf("--ids");
    const ids = (at >= 0 ? (argv[at + 1] ?? "") : "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      process.stderr.write("Az --undo-hoz add meg: --ids id1,id2\n");
      return 2;
    }
    const { count } = await prisma.incomingSupplierDocument.updateMany({
      where: { id: { in: ids }, reviewState: OWN_INVOICE_REVIEW_STATE },
      data: { reviewState: null },
    });
    ki(`visszavonva: ${count} / ${ids.length} dokumentum\n`);
    return 0;
  }

  const collection = new InvoiceCollectionRepository();
  const report = await markOwnInvoices(
    {
      candidates: () =>
        prisma.incomingSupplierDocument.findMany({
          where: {
            reviewState: null,
            origin: { in: ["COLLECTED_MAIL", "COLLECTED_DRIVE"] },
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            fileName: true,
            content: true,
            textReading: true,
            importResult: true,
          },
        }),
      lines: (content) => pdfTextLines(content),
      ownAccounts: () => collection.ownAccounts(),
      manuallyPaired: async () =>
        new Set(
          (
            await prisma.bankTransactionMatch.findMany({
              select: { documentId: true },
            })
          ).map((row) => row.documentId),
        ),
      mark: async (ids) =>
        (
          await prisma.incomingSupplierDocument.updateMany({
            // a NULL feltétel a frissítésben is áll: egy közben jelölt sor nem íródik át
            where: { id: { in: [...ids] }, reviewState: null },
            data: { reviewState: OWN_INVOICE_REVIEW_STATE },
          })
        ).count,
    },
    apply,
  );
  ki(`${apply ? "ÉLES" : "SZÁRAZ"} saját-számla jelölés\n`);
  ki(markReport(report, apply));
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
    .catch((cause) => {
      process.stderr.write(`${String(cause)}\n`);
      process.exitCode = 2;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
