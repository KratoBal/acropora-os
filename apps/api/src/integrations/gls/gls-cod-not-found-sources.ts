import { prisma } from "@acropora/database";

/**
 * WHERE A NOT_FOUND INVOICE IS, FOR THE LINE A PERSON READS (Balázs's live run 2026-11-05: ACRW-2026/00469 NOT_FOUND
 * while the GLS page showed it paired). The paid-mark loader reads only Számlázz.hu's rows (`ebiz-paid-marks-scope`),
 * so it cannot tell "not in the feed" from "there, but only as eBIZ". This module asks the other sources, and on
 * purpose lives OUTSIDE the loader: it reads the number and the source, nothing that could become an invoice to mark,
 * and the loader stays under the guard that keeps it to Számlázz.hu. Its own guard is in the same spec.
 */
export async function invoiceSourcesOutsideTheFeed(
  numbers: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (numbers.length === 0) return out;
  for (const row of await prisma.externalBillingDocument.findMany({
    where: {
      source: { not: "SZAMLAZZ" },
      documentNumber: { in: [...numbers] },
    },
    select: { documentNumber: true, source: true },
    orderBy: { source: "asc" },
  })) {
    const sources = out.get(row.documentNumber) ?? [];
    if (!sources.includes(row.source)) sources.push(row.source);
    out.set(row.documentNumber, sources);
  }
  return out;
}
