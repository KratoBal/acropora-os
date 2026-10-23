import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  DEFAULT_REQUEST_LIMIT,
  DISCOVERY_SWITCH_ENV,
  MAX_REQUEST_LIMIT,
  parseDiscoveryInput,
  runDiscovery,
  type DiscoveryInput,
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

  const client = new ScholarlyClient({
    fetch: deps.fetch,
    sleep: deps.sleep,
    now: deps.now,
    requestLimit,
  });
  // stored runs are recorded from their start, so a stopped one is in the log too
  const runId = apply
    ? await deps.store.startRun({
        input: parsed.input,
        requestedById: actor!,
        startedAt: deps.now(),
      })
    : null;
  try {
    return await discoverAndStore(
      parsed.input,
      runId,
      requestLimit,
      client,
      out,
      deps,
    );
  } catch (error) {
    // the name only: an error's text may carry an API's answer
    if (runId)
      await deps.store.failRun(runId, (error as Error)?.name ?? "Error");
    throw error;
  }
}

async function discoverAndStore(
  input: DiscoveryInput,
  runId: string | null,
  requestLimit: number,
  client: ScholarlyClient,
  out: Output,
  deps: DiscoveryCliDeps,
): Promise<number> {
  const result = await runDiscovery(input, { client, now: deps.now });
  out.stdout(discoveryReport(input.label, result));

  if (result.status !== "FINISHED") {
    if (runId) await deps.store.finishRun(runId, result);
    out.stdout(
      result.status === "LIMIT_REACHED"
        ? `KORLÁT ELÉRVE (${requestLimit} lekérés): forrás nem tárolódott. Emeld a --max-requests értékét, vagy szűkítsd a bemenetet.\n`
        : "NEM TELJES: nem minden DOI ment át a Crossref visszavonás-ellenőrzésén, ezért forrás nem tárolódott.\n",
    );
    return 3;
  }
  if (!runId) {
    out.stdout(storeReport(await deps.store.preview(result), false));
    out.stdout(
      "Próbafutás: semmi nem tárolódott. Tárolás: --apply --actor <userId>\n",
    );
    return 0;
  }
  const summary = await deps.store.finishRun(runId, result);
  out.stdout(storeReport(summary, true));
  return summary.ambiguous.length ? 4 : 0;
}

/**
 * AN IDENTIFIER FROM AN API, AS THE REPORT SHOWS IT (barracuda, #1834 review).
 * A DOI suffix may hold almost any character, and the report lands in an
 * operator's (or an agent's) terminal: printable ASCII only (a normalised DOI
 * holds no space, so a space is ours: a joined list), at most `max`
 * characters, anything else a `?`. The stored value is not touched.
 */
export function shown(value: string, max = 100): string {
  const clean = value.replace(/[^\x20-\x7e]/g, "?");
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
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
      `Kihagyva: ${skipped.map(([reason, n]) => `${shown(reason)} ${n}`).join(", ")}`,
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
      `VÁLTOZAT: ${shown(n.doi)} ${n.versionKind} (${n.detectedVia}${n.relatedDoi ? `, értesítés ${shown(n.relatedDoi)}` : ""})`,
    );
  for (const c of result.candidates)
    for (const signal of c.versionSignals)
      lines.push(
        `A REKORD SZERINT ${signal.versionKind} (${signal.detectedVia}): ${shown(c.doi ?? c.openalexId ?? c.pmid ?? c.pmcid ?? "?")}`,
      );
  if (result.notFoundDois.length)
    lines.push(
      `Egyik API sem ismeri: ${result.notFoundDois.map(shown).join(", ")}`,
    );
  for (const conflict of result.conflicts)
    lines.push(
      `AZONOSÍTÓ-ÜTKÖZÉS (${conflict.identifier}): ${conflict.values.map(shown).join(" / ")}`,
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
  if (summary.retractionUnchecked)
    lines.push(
      `Visszavonás-ellenőrzés NÉLKÜL${stored ? "" : " lenne"} (nincs DOI, a Crossref nem nézhette meg): ${summary.retractionUnchecked}`,
    );
  for (const a of summary.ambiguous)
    lines.push(
      `TÖBB SORRA ILLIK, KIHAGYVA: ${shown(a.identifiers, 400)} -> ${a.rowIds.join(", ")}`,
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
