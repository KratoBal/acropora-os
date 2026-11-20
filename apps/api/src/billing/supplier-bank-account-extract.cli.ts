import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";

import { InvoiceCollectionRepository } from "../missing-invoices/collection/invoice-collection.repository.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { PAYABLE_KINDS, isTransferMethod } from "./due-invoices.js";
import { loadCollectedPdfIndex } from "./incoming-collected-pdf.js";
import { attachedPdfIds } from "./incoming-pdf-attach.js";
import { incomingPdfIds } from "./incoming-pdf-state.js";
import {
  extractSupplierAccounts,
  formatExtractReport,
} from "./supplier-bank-account-extract.js";

/**
 * A LEJÁRÓ SZÁMLÁK SZÁMLASZÁM NÉLKÜLI SORAINAK PDF-ES MÉRÉSE, CSAK OLVASVA (acrobot 58433; task os-lejaro-bankszamla-potlas-20261120).
 *
 *   pnpm --filter @acropora/api billing:supplier-accounts
 *
 * SEMMIT NEM ÍR: nincs `--apply`, a kimenet a standard kimenetre megy. A célsorok a Lejáró számlák szűrőit követik (fizetendő típus, nem sztornó, nem „nem könyvelendő”,
 * átutalás vagy üres fizetési mód, a hátralék pozitív, a feed számlaszáma üres), a banki párosítás nélkül: a kifizetettséget ez NEM nézi, tehát a célhalmaz a lista
 * szűrt sorainak NAGYOBB része lehet. A PDF-eket ugyanaz a szabály adja, mint a lista PDF-jelzése (`incomingPdfIds`: a feed saját PDF-je, a kézzel csatolt és a begyűjtött).
 *
 * A KIMENET CSAK darabszám, a számlaszám vége (négy jegy), a találat fajtája és a címke, a szállító neve és a számla száma: a teljes számlaszám nem hagyja el a folyamatot.
 */
const blank = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === "";

async function main(): Promise<number> {
  const collection = new InvoiceCollectionRepository();
  const [rows, collected, attached] = await Promise.all([
    prisma.incomingBillingDocument.findMany({
      where: {
        OR: [{ supplierBankAccount: null }, { supplierBankAccount: "" }],
      },
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
        (blank(row.paymentMethod) || isTransferMethod(row.paymentMethod)) &&
        new Prisma.Decimal(row.grossAmount).gt(row.paidAmount),
    )
    .map((row) => ({
      id: row.id,
      supplierName: row.supplierName,
      documentNumber: row.documentNumber,
      // az EGY PDF-szabály (`incoming-pdf-state.ts`): a feed saját PDF-je, a kézzel csatolt és a begyűjtött
      pdfIds: incomingPdfIds(row, { attached, collected }),
    }));
  const report = await extractSupplierAccounts({
    targets: async () => targets,
    content: async (id) =>
      (
        await prisma.incomingSupplierDocument.findUnique({
          where: { id },
          select: { content: true },
        })
      )?.content ?? null,
    lines: (content) => pdfTextLines(content),
    ownAccounts: () => collection.ownAccounts(),
  });
  process.stdout.write(formatExtractReport(report));
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
