import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { report } from "./billing-issuing-diagnose.js";

/**
 * AZ ISSUING-BEN ÁLLÓ KIMENŐ BIZONYLATOK (`billing-issuing-diagnose.ts`). CSAK OLVAS.
 *
 *   pnpm --filter @acropora/api billing:issuing-diagnose
 *   (élesen) node dist/billing/billing-issuing-diagnose.cli.js
 *
 * Kilépési kód: 0, ha lefutott (akkor is, ha van ISSUING-ben álló bizonylat). Személyes adatot nem ír ki:
 * azonosító, fajta, szám, kor, a próbák száma.
 */
async function main(): Promise<number> {
  const rows = await prisma.invoice.findMany({
    where: {
      direction: "OUTBOUND",
      status: { in: ["ISSUING", "ISSUE_FAILED"] },
    },
    select: {
      id: true,
      documentType: true,
      status: true,
      syncError: true,
      invoiceNumber: true,
      issueAttemptCount: true,
      updatedAt: true,
    },
  });
  process.stdout.write(report(rows, new Date()));
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
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
