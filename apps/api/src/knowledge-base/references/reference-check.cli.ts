import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  ScholarlyClient,
  type ApiFetch,
} from "../discovery/scholarly-client.js";
import {
  checkReferences,
  referenceReportText,
  type ReferenceSource,
} from "./reference-check.js";

/**
 * T1 OF THE RESEARCH TEST SET, BY HAND, ON THE STAGE API (plan v4, 10; S7):
 *
 *   pnpm --filter @acropora/api knowledge:check-references [--json]
 *
 * Reads the INCLUDED sources (what a claim can rest on) that have a DOI or a
 * PMID, and resolves each at Crossref and Europe PMC. Writes nothing. The
 * output carries identifiers, counts and reason codes, never a title.
 *
 * Exit: 0 every identifier resolved to its source; 3 some did not exist or
 * pointed to another work; 4 a registry did not answer, so the run measured
 * less than all (not a pass); 2 nothing to check.
 */
export const MAX_SOURCES = 500;

export interface ReferenceCliDeps {
  sources: () => Promise<{ checkable: ReferenceSource[]; withoutId: number }>;
  fetch: ApiFetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

export async function runReferenceCli(
  argv: readonly string[],
  out: { stdout: (t: string) => void; stderr: (t: string) => void },
  deps: ReferenceCliDeps,
): Promise<number> {
  const { checkable, withoutId } = await deps.sources();
  if (checkable.length === 0) {
    out.stderr("Nincs DOI-val vagy PMID-vel rendelkező befogadott forrás.\n");
    return 2;
  }
  if (checkable.length > MAX_SOURCES) {
    out.stderr(
      `Több mint ${MAX_SOURCES} forrás; a mérés ennyit visz egy futásban.\n`,
    );
    return 2;
  }
  const client = new ScholarlyClient({
    fetch: deps.fetch,
    sleep: deps.sleep,
    now: deps.now,
    // two identifiers a source at most, each with its two 429 retries
    requestLimit: checkable.length * 2 * 3,
  });
  const report = await checkReferences(checkable, client);
  out.stdout(
    argv.includes("--json")
      ? `${JSON.stringify({ ...report, withoutIdentifier: withoutId })}\n`
      : `${referenceReportText(report)}Azonosító nélküli befogadott forrás (nem mérhető): ${withoutId}\nKérések: ${client.requestCount}\n`,
  );
  if (report.results.some((r) => r.verdict === "UNREACHABLE")) return 4;
  return report.met ? 0 : 3;
}

/* c8 ignore start */
async function main(): Promise<void> {
  const code = await runReferenceCli(
    process.argv.slice(2),
    {
      stdout: (t) => process.stdout.write(t),
      stderr: (t) => process.stderr.write(t),
    },
    {
      sources: async () => {
        const included = { screeningStatus: "INCLUDED" as const };
        const [checkable, withoutId] = await Promise.all([
          prisma.knowledgeSource.findMany({
            where: {
              ...included,
              OR: [{ doi: { not: null } }, { pmid: { not: null } }],
            },
            select: {
              id: true,
              doi: true,
              pmid: true,
              title: true,
              year: true,
            },
            orderBy: { id: "asc" },
          }),
          prisma.knowledgeSource.count({
            where: { ...included, doi: null, pmid: null },
          }),
        ]);
        return { checkable, withoutId };
      },
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
    },
  );
  await prisma.$disconnect();
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
