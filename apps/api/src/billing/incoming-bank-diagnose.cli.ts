import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { MissingInvoicesRepository } from "../missing-invoices/missing-invoices.repository.js";
import { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
import { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import {
  diagnoseReport,
  diagnoseSummary,
  diagnoseUnpaired,
  type DiagnoseDebit,
} from "./incoming-bank-diagnose.js";

/**
 * MIÉRT PÁROSÍTATLAN A LISTÁN (`incoming-bank-diagnose.ts`). CSAK OLVAS.
 *
 *   pnpm --filter @acropora/api billing:incoming-bank-diagnose -- --since 2026-09-01
 *   (élesen) node dist/billing/incoming-bank-diagnose.cli.js --since 2026-09-01
 *
 * A Számlázz.hu-sorok, amelyek a felülettel azonos számítás szerint a listán
 * párosítatlanok, a megadott keltétől; mindegyiknél a pontosan ilyen összegű
 * terhelések az időablakban, a számított állapotukkal. Kilépési kód: 0, ha
 * lefutott (akkor is, ha van párosítatlan sor); 2, ha a paraméter hibás.
 */
export function parseSince(argv: readonly string[]): string | null {
  const at = argv.indexOf("--since");
  const value = at >= 0 ? (argv[at + 1] ?? "") : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
    ? value
    : null;
}

async function main(argv: readonly string[]): Promise<number> {
  const since = parseSince(argv);
  if (!since) {
    process.stderr.write("Add meg a kezdő keltét: --since ÉÉÉÉ-HH-NN.\n");
    return 2;
  }
  const missing = new MissingInvoicesService(
    new MissingInvoicesRepository(),
    new SupplierInvoiceImportService(),
  );
  const rows = await prisma.incomingBillingDocument.findMany({
    where: {
      source: "SZAMLAZZ",
      issueDate: { gte: new Date(`${since}T00:00:00Z`) },
    },
    orderBy: [{ issueDate: "asc" }, { documentNumber: "asc" }],
  });
  const pairings = await missing.documentPairings();
  // a terhelések a kelte hónapjától a mai hónapig, a lista számításából
  const months: string[] = [];
  const now = new Date().toISOString().slice(0, 7);
  for (let m = since.slice(0, 7); m <= now;) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number) as [number, number];
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  const debits: DiagnoseDebit[] = [];
  // the month view pages its items (DEFAULT_PAGE_SIZE): one page covering all of them, never a silent cut
  for (const month of months) {
    const detail = await missing.month(month, {
      tab: "ALL",
      page: 1,
      pageSize: 1_000_000,
    });
    // barracuda #1789: if a maximum page size ever cut the page, the missing debits would read as "no debit of
    // this amount", which is exactly a false diagnosis; so a short page stops the run
    if (detail.items.length !== detail.pagination.totalItems) {
      process.stderr.write(
        `A ${month} hónap lapja ${detail.items.length} terhelést adott ${detail.pagination.totalItems} helyett: a diagnózis hamis lenne, nem fut tovább.\n`,
      );
      return 3;
    }
    debits.push(...detail.items);
  }
  process.stdout.write(
    `CSAK OLVASÁS, kelte ${since} óta, ${rows.length} Számlázz.hu-sor, ${debits.length} terhelés (${months.join(", ")})\n`,
  );
  const lines = diagnoseUnpaired(rows, pairings, debits);
  // acrobot 34662: the daily check takes one number per month, instead of a count of BankTransactionMatch rows
  // (that table holds the manual pairings only, so a count of it overstates)
  process.stdout.write(
    argv.includes("--osszesito")
      ? diagnoseSummary(lines)
      : diagnoseReport(lines),
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
