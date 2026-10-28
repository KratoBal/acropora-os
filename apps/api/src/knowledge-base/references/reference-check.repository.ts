import { prisma } from "@acropora/database";

import type { ReferenceSource } from "./reference-check.js";

/**
 * The sources T1 measures: the INCLUDED ones (what a claim can rest on) with
 * a DOI or a PMID, by id; and the ids of the INCLUDED ones that have
 * neither, so the report says what it could not measure and the editor can
 * find them (the first stage run had three).
 */
export async function includedReferenceSources(): Promise<{
  checkable: ReferenceSource[];
  withoutId: string[];
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
    prisma.knowledgeSource.findMany({
      where: { ...included, doi: null, pmid: null },
      select: { id: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return { checkable, withoutId: withoutId.map((s) => s.id) };
}
