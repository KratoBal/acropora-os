import "reflect-metadata";
import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";

import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { PAYABLE_KINDS } from "./due-invoices.js";
import {
  formatPaymentMethodReport,
  readPaymentMethods,
} from "./due-invoices-payment-method.js";
import { loadCollectedPdfIndex } from "./incoming-collected-pdf.js";
import { attachedPdfIds } from "./incoming-pdf-attach.js";
import { pdfIdsToRead } from "./supplier-bank-account-extract.js";

/**
 * A LEJÁRÓ SZÁMLÁK FIZETÉSI MÓD NÉLKÜLI SORAINAK PDF-ES MÉRÉSE, CSAK OLVASVA (acrobot 58710, 58713, 58718):
 *
 *   pnpm --filter @acropora/api billing:payment-methods
 *
 * SEMMIT NEM ÍR: nincs `--apply`, a kimenet a standard kimenetre megy. A célsorok a Lejáró számlák szűrőit követik (fizetendő
 * típus, nem sztornó, nem „nem könyvelendő”, a hátralék pozitív), és csak az ÜRES fizetési módúak; a banki párosítást nem nézi,
 * tehát a célhalmaz a lista ilyen sorainál nagyobb lehet. A PDF-eket ugyanaz a szabály adja, mint a lista PDF-jelzését
 * (`pdfIdsToRead`: az `incomingPdfIds`, a nem PDF feed-dokumentum nélkül), ugyanaz az olvasó, mint a #2791 bankszámla-kinyerését (`supplier-bank-account-extract.cli.ts`).
 * A webes végpont (`/billing/incoming-documents/:id/pdf`) `billing.view` jogot kér, a flotta fiók nem hordja (acrobot 58718):
 * ezért fut a konténerben, az adatbázisból.
 *
 * A KIMENET soronként: a besorolás, a szállító, a számla száma, a PDF-ek száma, a fizetve-jelzés és a PDF fizetési-mód sora
 * (a 4+ jegyű számok kitakarva). Más PDF-szöveg nem hagyja el a folyamatot.
 */
const blank = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === "";

async function main(): Promise<number> {
  const [rows, collected, attached] = await Promise.all([
    prisma.incomingBillingDocument.findMany({
      where: { OR: [{ paymentMethod: null }, { paymentMethod: "" }] },
    }),
    loadCollectedPdfIndex(prisma),
    attachedPdfIds(prisma),
  ]);
  const targets = rows
    .filter(
      (row) =>
        PAYABLE_KINDS.has(row.kindCode.toUpperCase()) &&
        !row.cancelled &&
        !row.notBookable &&
        blank(row.paymentMethod) &&
        new Prisma.Decimal(row.grossAmount).gt(row.paidAmount),
    )
    .map((row) => ({
      id: row.id,
      supplierName: row.supplierName,
      documentNumber: row.documentNumber,
      // the feed's own document only when it IS a PDF (`hasPdf`): the same rule as the #2800 fix of the #2791 reader. Without it
      // every row whose feed document is XML read as "unreadable" (live 2026-11-20: 24 of 52, acrobot 58843)
      pdfIds: pdfIdsToRead(row, { attached, collected }),
    }));
  const report = await readPaymentMethods({
    targets: async () => targets,
    content: async (id) =>
      (
        await prisma.incomingSupplierDocument.findUnique({
          where: { id },
          select: { content: true },
        })
      )?.content ?? null,
    lines: (content) => pdfTextLines(content),
  });
  process.stdout.write(formatPaymentMethodReport(report));
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
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
