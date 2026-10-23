import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  parseDiscoveryInput,
  runDiscovery,
  type DiscoveryResult,
} from "./discovery-run.js";
import {
  PrismaDiscoveryStore,
  type DiscoveryStore,
  type StoreSummary,
} from "./discovery-run.store.js";
import { ScholarlyClient, type ApiFetch } from "./scholarly-client.js";

/**
 * THE SOURCE DISCOVERY OF THE RESEARCH ENGINE, BY HAND (plan v4, 9.2 S2).
 *
 *   pnpm --filter @acropora/api knowledge:discover --input <file.json>
 *       [--max-requests N] [--apply --actor <userId>]
 *
 * The input names the queries (see `parseDiscoveryInput`):
 *
 *   { "label": "foszfat-sps-pilot",
 *     "openalex":  [ { "search": "phosphate Acropora", "maxResults": 100 } ],
 *     "europePmc": [ { "query": "phosphate AND Acropora", "maxResults": 100 } ],
 *     "dois":      [ "10.1016/..." ],
 *     "citations": [ { "doi": "10.1016/...", "direction": "references", "maxResults": 50 } ] }
 *
 * WITHOUT `--apply` it reads: the three APIs, and the knowledge tables to say
 * what is new. It writes nothing.
 *
 * WITH `--apply` it stores the sources, their versions and the run record. It
 * needs `KNOWLEDGE_DISCOVERY=on` (stage only; the production templates keep it
 * `off`) and `--actor` naming an existing user. It stores nothing when the run
 * stopped before every DOI went through the Crossref notice check.
 *
 * The output carries identifiers and counts, never a title or an abstract:
 * those are third-party text, and they stay data in the table.
 *
 * Exit: 0 finished; 1 the switch is off; 2 bad input or unknown actor; 3 the
 * run stopped (request limit, or Crossref refused) and nothing was stored;
 * 4 stored, but some works matched more than one row (each one reported).
 */
export const DEFAULT_REQUEST_LIMIT = 150;
export const MAX_REQUEST_LIMIT = 1_000;
export const DISCOVERY_SWITCH_ENV = "KNOWLEDGE_DISCOVERY";

export interface DiscoveryCliDeps {
  env: NodeJS.ProcessEnv;
  readInput: (path: string) => Promise<string>;
  store: DiscoveryStore;
  actorExists: (userId: string) => Promise<boolean>;
  fetch: ApiFetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

type Output = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

function option(argv: readonly string[], name: string): string | null {
  const at = argv.indexOf(name);
  return at >= 0 ? (argv[at + 1] ?? null) : null;
}

export async function runDiscoveryCli(
  argv: readonly string[],
  out: Output,
  deps: DiscoveryCliDeps,
): Promise<number> {
  const inputPath = option(argv, "--input");
  if (!inputPath) {
    out.stderr(
      "Használat: --input <fájl.json> [--max-requests N] [--apply --actor <userId>]\n",
    );
    return 2;
  }
  const rawLimit = option(argv, "--max-requests");
  const requestLimit =
    rawLimit === null ? DEFAULT_REQUEST_LIMIT : Number(rawLimit);
  if (
    !Number.isInteger(requestLimit) ||
    requestLimit < 1 ||
    requestLimit > MAX_REQUEST_LIMIT
  ) {
    out.stderr(
      `--max-requests: 1 és ${MAX_REQUEST_LIMIT} közötti egész szám kell (most: ${rawLimit}).\n`,
    );
    return 2;
  }
  const parsed = parseDiscoveryInput(await deps.readInput(inputPath));
  if (!parsed.ok) {
    out.stderr(parsed.problems.map((p) => `- ${p}\n`).join(""));
    return 2;
  }
  const apply = argv.includes("--apply");
  let actor: string | null = null;
  if (apply) {
    if (deps.env[DISCOVERY_SWITCH_ENV] !== "on") {
      out.stderr(
        `A tároláshoz ${DISCOVERY_SWITCH_ENV}=on kell (csak a teszt környezetben).\n`,
      );
      return 1;
    }
    actor = option(argv, "--actor");
    if (!actor || !(await deps.actorExists(actor))) {
      out.stderr("Az --apply-hoz létező felhasználó kell: --actor <userId>\n");
      return 2;
    }
  }

  const startedAt = deps.now();
  const client = new ScholarlyClient({
    fetch: deps.fetch,
    sleep: deps.sleep,
    now: deps.now,
    requestLimit,
  });
  const result = await runDiscovery(parsed.input, { client, now: deps.now });
  out.stdout(discoveryReport(parsed.input.label, result));

  if (result.status !== "FINISHED") {
    out.stdout(
      result.status === "LIMIT_REACHED"
        ? `KORLÁT ELÉRVE (${requestLimit} lekérés): semmi nem tárolódott. Emeld a --max-requests értékét, vagy szűkítsd a bemenetet.\n`
        : "NEM TELJES: nem minden DOI ment át a Crossref visszavonás-ellenőrzésén, ezért semmi nem tárolódott.\n",
    );
    return 3;
  }
  if (!apply) {
    out.stdout(storeReport(await deps.store.preview(result), false));
    out.stdout(
      "Próbafutás: semmi nem tárolódott. Tárolás: --apply --actor <userId>\n",
    );
    return 0;
  }
  const summary = await deps.store.save({
    input: parsed.input,
    result,
    requestedById: actor!,
    startedAt,
  });
  out.stdout(storeReport(summary, true));
  return summary.ambiguous.length ? 4 : 0;
}

export function discoveryReport(
  label: string,
  result: DiscoveryResult,
): string {
  const lines = [
    `Felderítés „${label}”: ${result.status}, ${result.requestCount} lekérés, ${result.candidates.length} egyedi mű.`,
  ];
  for (const q of result.queries)
    lines.push(
      `- ${q.api} ${q.kind} ${q.executedAt}: találat ${q.hitCount ?? "?"}, letöltve ${q.fetched}${q.stoppedBy ? `, megállt: ${q.stoppedBy}` : ""}`,
      `    ${q.url}`,
    );
  const skipped = Object.entries(result.skipped);
  if (skipped.length)
    lines.push(
      `Kihagyva: ${skipped.map(([reason, n]) => `${reason} ${n}`).join(", ")}`,
    );
  const licences = new Map<string, number>();
  for (const c of result.candidates)
    licences.set(c.licence, (licences.get(c.licence) ?? 0) + 1);
  lines.push(
    `Licenc: ${[...licences].map(([l, n]) => `${l} ${n}`).join(", ") || "-"}`,
    `Nyílt teljes szöveg (Europe PMC vagy OpenAlex): ${result.candidates.filter((c) => c.oaUrl).length}`,
    `Crossref-ellenőrzött DOI: ${result.checkedDois.length}; a Crossref nem ismeri: ${result.crossrefUnknownDois.length}`,
  );
  for (const n of result.notices)
    lines.push(
      `VÁLTOZAT: ${n.doi} ${n.versionKind} (${n.detectedVia}${n.relatedDoi ? `, értesítés ${n.relatedDoi}` : ""})`,
    );
  for (const c of result.candidates.filter((x) => x.retractedFlag))
    lines.push(
      `VISSZAVONTNAK JELÖLT (OpenAlex): ${c.doi ?? c.openalexId ?? c.pmid}`,
    );
  if (result.notFoundDois.length)
    lines.push(`Egyik API sem ismeri: ${result.notFoundDois.join(", ")}`);
  for (const conflict of result.conflicts)
    lines.push(
      `AZONOSÍTÓ-ÜTKÖZÉS (${conflict.identifier}): ${conflict.values.join(" / ")}`,
    );
  for (const [api, reason] of Object.entries(result.unavailable))
    lines.push(`NEM ELÉRHETŐ: ${api} (${reason})`);
  return `${lines.join("\n")}\n`;
}

export function storeReport(summary: StoreSummary, stored: boolean): string {
  const verb = stored ? "" : " lenne";
  const lines = [
    `${stored ? `Futás ${summary.runId}: ` : ""}új forrás${verb}: ${summary.created}, már ismert${verb}: ${summary.matched}${stored ? `, új változat: ${summary.versionsCreated}, vitatottá vált állítás: ${summary.claimsDisputed}` : ""}.`,
  ];
  if (summary.unchecked)
    lines.push(`Nem tárolható (DOI ellenőrzés nélkül): ${summary.unchecked}`);
  for (const a of summary.ambiguous)
    lines.push(
      `TÖBB SORRA ILLIK, KIHAGYVA: ${a.identifiers} -> ${a.rowIds.join(", ")}`,
    );
  return `${lines.join("\n")}\n`;
}

/* c8 ignore start */
async function main(): Promise<void> {
  const code = await runDiscoveryCli(
    process.argv.slice(2),
    {
      stdout: (t) => process.stdout.write(t),
      stderr: (t) => process.stderr.write(t),
    },
    {
      env: process.env,
      readInput: (path) => readFile(path, "utf8"),
      store: new PrismaDiscoveryStore(),
      actorExists: async (id) =>
        (await prisma.user.findUnique({
          where: { id },
          select: { id: true },
        })) !== null,
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
