import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { MissingInvoicesRepository } from "../missing-invoices/missing-invoices.repository.js";
import {
  candidateDuplicates,
  incomingDuplicates,
  outgoingDuplicates,
  type DuplicateGroup,
} from "./billing-duplicates.js";

/**
 * THE DAILY DUPLICATE CHECK, READ ONLY (acrobot 26210; Balázs 2026-10-05
 * 09:07 UTC: "innentől ez legyen ellenőrizve"). Writes nothing.
 *
 *   node dist/billing/billing-duplicates.cli.js [--since 2026-09-01] [--until 2026-10-05]
 *
 * Three places where one invoice could count twice:
 *   KIMENŐ           the outgoing list (`ExternalBillingDocument`): one row per
 *                    own invoice number, whatever the source (Számlázz.hu, eBIZ)
 *   BEJÖVŐ LISTA     the incoming list (`IncomingBillingDocument`): one row
 *                    per supplier tax base + number
 *   BEJÖVŐ SZÁMOLÁS  the missing-invoice candidates in the window, after their
 *                    own merge (NAV + Számlázz.hu + mailbox are one candidate):
 *                    the pairing, the paid view and the accountant's export
 *                    all read these
 *
 * Exit 0: no duplicate; 1: at least one (the lines name them); 2: the check
 * itself failed. The NAV + Számlázz.hu pairs that ARE merged into one
 * candidate are counted too, so a zero there says the merge did its work, not
 * that the pairs are missing.
 */
function argument(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

const section = <T>(
  title: string,
  groups: readonly DuplicateGroup<T>[],
  describe: (row: T) => string,
): string[] => [
  `${title}: ${groups.length} dupla`,
  ...groups.map(
    (group) => `  ${group.key}  ${group.rows.map(describe).join("  +  ")}`,
  ),
];

async function main(argv: readonly string[]): Promise<number> {
  const since = argument(argv, "--since") ?? "2026-09-01";
  const until =
    argument(argv, "--until") ?? new Date().toISOString().slice(0, 10);
  const [outgoing, incoming, candidates] = await Promise.all([
    prisma.externalBillingDocument.findMany({
      select: {
        id: true,
        source: true,
        externalId: true,
        documentNumber: true,
      },
    }),
    prisma.incomingBillingDocument.findMany({
      select: {
        id: true,
        source: true,
        externalId: true,
        documentNumber: true,
        supplierTaxNumber: true,
        supplierName: true,
      },
    }),
    new MissingInvoicesRepository().candidates(since, until),
  ]);
  const out = outgoingDuplicates(outgoing);
  const inList = incomingDuplicates(incoming);
  const inCandidates = candidateDuplicates(candidates);
  const mergedPairs = candidates.filter(
    (candidate) => (candidate.aliasIds?.length ?? 0) > 0,
  ).length;
  const lines = [
    ...section("KIMENŐ", out, (row) => `${row.source}:${row.externalId}`),
    ...section(
      "BEJÖVŐ LISTA",
      inList,
      (row) => `${row.source}:${row.externalId}`,
    ),
    ...section(
      `BEJÖVŐ SZÁMOLÁS (${since}..${until})`,
      inCandidates,
      (row) => `${row.source}:${row.id}`,
    ),
    `  (több forrásból egy jelöltté vonva: ${mergedPairs})`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return out.length + inList.length + inCandidates.length > 0 ? 1 : 0;
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
