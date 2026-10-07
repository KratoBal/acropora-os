import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { MissingInvoicesRepository } from "../../missing-invoices/missing-invoices.repository.js";
import { MissingInvoicesService } from "../../missing-invoices/missing-invoices.service.js";
import { SupplierInvoiceImportService } from "../../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import {
  IncomingReviewService,
  type PendingReport,
} from "./incoming-review.service.js";

/**
 * A POSTAFIÓKOS (KÜLFÖLDI) SZÁMLÁK KINYERÉSE ÉS SZÁMLÁLÁSA (kártya e4c3b0fb).
 *
 *   pnpm --filter @acropora/api billing:incoming-foreign-read [--since=2026-01-01] [--limit=50] [--json]
 *   éles konténerben: node /app/dist/billing/foreign-invoice/incoming-foreign-read.cli.js
 *
 * ALAPBÓL CSAK OLVAS (acrobot 27599: az éles számlálást ő futtatja): a
 * postafiókos sorok PDF-jét kiolvassa, és megmondja, hány van, hánynak van
 * szövegrétege és illesztője, hány jóváhagyható egy kattintással, milyen
 * devizában és milyen feladótól. Adatbázisba NEM ír.
 *
 * `--apply`: a még nem olvasott sorok „Ellenőrizendő” olvasatot kapnak. A már
 * tárolt (vagy kézzel javított) olvasathoz nem nyúl, tehát újrafuttatható.
 * Élesen csak Balázs szavára.
 *
 * A kimenet személyes adatot nem ír ki: dokumentum-azonosító, dátum, deviza,
 * a feladó DOMAINJE, és mezőszámok.
 */
export function parseArguments(argv: readonly string[]) {
  const options = {
    apply: false,
    json: false,
    since: null as string | null,
    limit: null as number | null,
  };
  for (const argument of argv) {
    if (argument === "--apply") options.apply = true;
    else if (argument === "--json") options.json = true;
    else if (argument.startsWith("--since=")) {
      const value = argument.slice("--since=".length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error(`--since: YYYY-MM-DD kell, kapott: ${value}`);
      options.since = value;
    } else if (argument.startsWith("--limit=")) {
      const value = Number(argument.slice("--limit=".length));
      if (!Number.isInteger(value) || value < 1)
        throw new Error("--limit: pozitív egész kell");
      options.limit = value;
    } else throw new Error(`ismeretlen kapcsoló: ${argument}`);
  }
  return options;
}

export function formatReport(report: PendingReport, apply: boolean): string {
  const count = (record: Record<string, number>) =>
    Object.entries(record)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => `${key} ${value}`)
      .join(", ") || "-";
  const lines = [
    `mód: ${apply ? "ÍR (--apply)" : "csak olvas"}`,
    `postafiókos sor: ${report.total}; már olvasott: ${report.alreadyRead}; most olvasott: ${report.read}; írt: ${report.written}`,
    `szövegréteg: ${report.withText}/${report.read}; illesztő: ${report.withAdapter}/${report.read}; jóváhagyható egy kattintással: ${report.complete}/${report.read}`,
    `deviza: ${count(report.byCurrency)}`,
    `feladó: ${count(report.bySenderDomain)}`,
    "",
    "dokumentum\tdátum\tdeviza\tfeladó\tszöveg\tillesztő\tkitöltött\thiányzó\tfigyelm.",
    ...report.rows.map((row) =>
      [
        row.documentId,
        row.date,
        row.currency ?? "-",
        row.senderDomain ?? "-",
        row.hasText ? "igen" : "nem",
        row.adapter ? "igen" : "nem",
        row.filled,
        row.missing.join(",") || "-",
        row.warnings,
      ].join("\t"),
    ),
  ];
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<number> {
  const options = parseArguments(process.argv.slice(2));
  const missing = new MissingInvoicesService(
    new MissingInvoicesRepository(),
    new SupplierInvoiceImportService(),
  );
  const report = await new IncomingReviewService(missing).readPending(options);
  process.stdout.write(
    options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatReport(report, options.apply),
  );
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
