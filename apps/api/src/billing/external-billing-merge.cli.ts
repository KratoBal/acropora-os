import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";

import {
  planExternalMerges,
  type ExternalMergePlan,
  type ExternalMergeRow,
} from "./billing-duplicates.js";
import {
  szamlazzFieldsOf,
  takeOverEbizRow,
} from "./external-billing-one-row.js";

/**
 * THE OUTGOING INVOICES ALREADY STORED TWICE, MERGED ONCE (acrobot 26208:
 * in October four invoices had a Számlázz.hu row and an eBIZ row).
 *
 *   node dist/billing/external-billing-merge.cli.js            (dry: lists)
 *   node dist/billing/external-billing-merge.cli.js --apply
 *
 * DRY BY DEFAULT: prints every duplicate number and what would happen to it,
 * then the totals, and writes nothing. `--apply` merges only the expected
 * shape (one Számlázz.hu row + one eBIZ row with the same issue date,
 * currency and gross), each pair in its own transaction: the eBIZ row stays
 * (its id and its stored PDF), takes over Számlázz.hu's data and identity,
 * and the Számlázz.hu row is removed. The same rule the two syncs follow from
 * now on (`external-billing-one-row.ts`). Idempotent: a merged number has one
 * row, so a second run finds nothing.
 */
const SELECT = {
  id: true,
  source: true,
  externalId: true,
  documentNumber: true,
  issueDate: true,
  currency: true,
  grossAmount: true,
  pdfStorageKey: true,
  ebizExternalId: true,
} satisfies Prisma.ExternalBillingDocumentSelect;

const day = (date: Date) => date.toISOString().slice(0, 10);
const describe = (row: ExternalMergeRow) =>
  `${row.source}:${row.externalId} kelt ${day(row.issueDate)} ${row.grossAmount.toFixed(2)} ${row.currency}${row.pdfStorageKey ? " PDF" : ""}`;

export function mergeReport(plans: readonly ExternalMergePlan[]): string {
  const lines = plans.map((plan) =>
    plan.kind === "MERGE"
      ? `  ÖSSZEVONHATÓ  ${plan.number}  ${describe(plan.szamlazz)}  +  ${describe(plan.ebiz)}`
      : plan.kind === "DIFFERS"
        ? `  KIHAGYVA      ${plan.number}  ${plan.reason}: ${plan.rows.map(describe).join("  +  ")}`
        : `  KIHAGYVA      ${plan.number}  nem egy Számlázz.hu + egy eBIZ sor: ${plan.rows.map(describe).join("  +  ")}`,
  );
  const count = (kind: ExternalMergePlan["kind"]) =>
    plans.filter((plan) => plan.kind === kind).length;
  return [
    `Kétszer tárolt kimenő számlaszám: ${plans.length} (összevonható ${count("MERGE")}, eltérő ${count("DIFFERS")}, más alakú ${count("OTHER")}).`,
    ...lines,
  ].join("\n");
}

async function mergePair(szamlazzId: string, ebizId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const szamlazz = await tx.externalBillingDocument.findUniqueOrThrow({
      where: { id: szamlazzId },
    });
    const ebiz = await tx.externalBillingDocument.findUniqueOrThrow({
      where: { id: ebizId },
      select: { id: true, source: true, externalId: true },
    });
    if (szamlazz.source !== "SZAMLAZZ" || ebiz.source !== "EBIZ")
      throw new Error(`a pár közben megváltozott: ${szamlazz.documentNumber}`);
    // the Számlázz.hu row goes first: its (source, externalId) moves over
    await tx.externalBillingDocument.delete({ where: { id: szamlazz.id } });
    await tx.externalBillingDocument.update({
      where: { id: ebiz.id },
      data: takeOverEbizRow(
        ebiz,
        szamlazzFieldsOf(szamlazz as unknown as Record<string, unknown>),
      ),
    });
  });
}

export async function mergeExternalDuplicates(
  apply: boolean,
  /** Only for the integration spec, which must not touch other rows. */
  where: Prisma.ExternalBillingDocumentWhereInput = {},
): Promise<{ report: string; merged: number }> {
  const rows = await prisma.externalBillingDocument.findMany({
    where,
    select: SELECT,
  });
  const plans = planExternalMerges(rows);
  let merged = 0;
  if (apply)
    for (const plan of plans)
      if (plan.kind === "MERGE") {
        await mergePair(plan.szamlazz.id, plan.ebiz.id);
        merged++;
      }
  return { report: mergeReport(plans), merged };
}

async function main(argv: readonly string[]): Promise<number> {
  const apply = argv.includes("--apply");
  const { report, merged } = await mergeExternalDuplicates(apply);
  process.stdout.write(
    `${report}\n${apply ? `ÉLES: ${merged} pár összevonva.` : "SZÁRAZ: semmi nem íródott; --apply-jal vonja össze az összevonhatókat."}\n`,
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
    .catch((cause) => {
      process.stderr.write(`${String(cause)}\n`);
      process.exitCode = 2;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
