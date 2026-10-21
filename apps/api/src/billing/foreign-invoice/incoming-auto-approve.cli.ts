import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { MissingInvoicesRepository } from "../../missing-invoices/missing-invoices.repository.js";
import { MissingInvoicesService } from "../../missing-invoices/missing-invoices.service.js";
import { SupplierInvoiceImportService } from "../../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import { parseArguments } from "./incoming-foreign-read.cli.js";
import {
  IncomingReviewService,
  type AutoApproveReport,
} from "./incoming-review.service.js";

/**
 * AZ „ELLENŐRIZENDŐ” OLVASATOK AUTOMATIKUS JÓVÁHAGYÁSA (acrobot 34633, 34636;
 * `auto-approval.ts`). Alapból SZÁRAZ: soronként kiírja, melyik sor mehetne
 * (NAV vagy BANK alapon) és melyik miért marad; `--apply` hagyja jóvá. Az
 * időzített olvasó ugyanezt futtatja minden kör végén; ez a meglévő sorokra és
 * az ellenőrzésre való.
 *
 *   pnpm --filter @acropora/api billing:incoming-auto-approve [--since=2026-09-01] [--apply]
 *   (élesen) node dist/billing/foreign-invoice/incoming-auto-approve.cli.js [--since=...] [--apply]
 */
export function formatAutoApprove(
  report: AutoApproveReport,
  apply: boolean,
): string {
  const lines = [
    `mód: ${apply ? "ÍR (--apply)" : "csak olvas"}`,
    `ellenőrizendő olvasat: ${report.considered}; jóváhagyható: ${report.approvable}; jóváhagyva: ${report.approved}; hiba: ${report.failed}`,
    "",
    ...report.rows.map((row) => {
      const what = `${row.number ?? "-"}\t${row.supplier ?? "-"}\t${row.gross ?? "-"}\t${row.documentId}`;
      if (row.basis === null) return `marad\t${what}\t${row.reason}`;
      if (row.reason) return `HIBA\t${what}\t${row.basis}\t${row.reason}`;
      return `${row.written ? "jóváhagyva" : "jóváhagyná"}\t${what}\t${row.basis}`;
    }),
  ];
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<number> {
  const options = parseArguments(process.argv.slice(2));
  const missing = new MissingInvoicesService(
    new MissingInvoicesRepository(),
    new SupplierInvoiceImportService(),
  );
  const report = await new IncomingReviewService(missing).autoApprovePending({
    apply: options.apply,
    since: options.since,
  });
  process.stdout.write(formatAutoApprove(report, options.apply));
  return report.failed ? 3 : 0;
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
