import { prisma } from "@acropora/database";

import type { ReferenceSource } from "./reference-check.js";

/**
 * The sources T1 measures: the INCLUDED ones (what a claim can rest on) with
 * a DOI or a PMID, by id; and how many INCLUDED ones have neither, so the
 * report says what it could not measure.
 */
export async function includedReferenceSources(): Promise<{
  checkable: ReferenceSource[];
  withoutId: number;
}> {
  const included = { screeningStatus: "INCLUDED" as const };
  const [checkable, withoutId] = await Promise.all([
    prisma.knowledgeSource.findMany({
      where: {
        ...included,
        OR: [{ doi: { not: null } }, { pmid: { not: null } }],
      },
      select: { id: true, doi: true, pmid: true, title: true, year: true },
      orderBy: { id: "asc" },
    }),
    prisma.knowledgeSource.count({
      where: { ...included, doi: null, pmid: null },
    }),
  ]);
  return { checkable, withoutId };
}
