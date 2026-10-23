import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";
import { vocabularyV1, type Vocabulary } from "@acropora/knowledge-base";

import {
  DISCOVERY_SWITCH_ENV,
  HEARTBEAT_MS,
  STALE_AFTER_MS,
  everyInterval,
} from "../discovery/discovery-run.js";
import {
  RunAbandoned,
  RunAlreadyRunning,
} from "../discovery/discovery-run.store.js";
import {
  AI_CLAIM_EXTRACTION_PATH_ENV,
  claimExtractorFromEnv,
  type ClaimExtractor,
} from "./claim-extractor.js";
import {
  MAX_CHUNKS_PER_SOURCE,
  MAX_SOURCES_PER_RUN,
  extractSource,
  type SourceOutcome,
  type TextFetch,
} from "./extraction-run.js";
import {
  PrismaExtractionStore,
  type ExtractionStore,
} from "./extraction-store.js";

/**
 * THE CLAIM EXTRACTION, BY HAND (plan v4, 9.2 S3).
 *
 *   pnpm --filter @acropora/api knowledge:extract --source <id>[,<id>...]
 *       [--apply --actor <userId>] [--reextract]
 *
 * WITHOUT `--apply` it downloads the open full texts, calls the AI service
 * and checks every claim, and stores nothing: the output says what WOULD be
 * stored, as counts and codes.
 *
 * `--reextract` reads an already extracted source again; with `--apply` the
 * source's still CANDIDATE claims are withdrawn in the actor's name, in the
 * same transaction as the new ones are stored (a reviewed claim stays).
 *
 * WITH `--apply` it stores CANDIDATE claims with PENDING field anchors, and
 * needs an existing actor. BOTH need `KNOWLEDGE_DISCOVERY=on` (the research
 * knowledge base's stage switch): a preview calls the paid model too. Without `ACROPORA_AI_CLAIM_EXTRACTION_PATH` and the
 * AI configuration there is no call at all.
 *
 * Exit: 0 finished; 1 the switch is off or no AI; 2 bad input or unknown
 * actor; 5 another extraction is RUNNING; 6 this run was failed as stale by
 * another start while it ran (what it had not stored yet is not stored).
 */
export interface ExtractionCliDeps {
  env: NodeJS.ProcessEnv;
  store: ExtractionStore;
  extractor: ClaimExtractor | null;
  fetch: TextFetch;
  vocabulary: Vocabulary;
  actorExists: (userId: string) => Promise<boolean>;
  now: () => Date;
  every?: (beat: () => void, ms: number) => () => void;
}

type Output = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

function option(argv: readonly string[], name: string): string | null {
  const at = argv.indexOf(name);
  return at >= 0 ? (argv[at + 1] ?? null) : null;
}

/** Source ids from a comma list: cuid-like, at most `MAX_SOURCES_PER_RUN`. */
export function parseSourceIds(raw: unknown): string[] | string {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const ids = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
  if (!ids.length) return "Nincs forrás-azonosító.";
  if (ids.length > MAX_SOURCES_PER_RUN)
    return `Egy futás legfeljebb ${MAX_SOURCES_PER_RUN} forrást olvas ki (most: ${ids.length}).`;
  if (ids.some((id) => !/^[a-z0-9]{8,40}$/.test(id)))
    return "A forrás-azonosító kisbetű és szám (cuid).";
  return ids;
}

export function outcomeReport(outcomes: readonly SourceOutcome[]): string {
  const codes = (r: Record<string, number>) =>
    Object.entries(r)
      .map(([code, n]) => `${code} ${n}`)
      .join(", ") || "-";
  return `${outcomes
    .map((o) =>
      [
        `- ${o.sourceId}: ${o.status}${o.reason ? ` (${o.reason})` : ""}, ${o.sections} szakasz, ${o.calls} AI-hívás`,
        `    állítás ${o.claims}, mező ${o.fields}, szerkesztői kérdés ${o.questions}, tárolt állítás ${o.claimsCreated}`,
        `    elvetett állítás: ${codes(o.refusedClaims)}; elvetett mező: ${codes(o.refusedFields)}; AI nem válaszolt: ${codes(o.unavailable)}`,
        ...(o.claimsWithdrawn
          ? [
              `    újrakiolvasás: ${o.claimsWithdrawn} korábbi, ellenőrizetlen állítás visszavonva`,
            ]
          : []),
        ...(o.chunksDropped
          ? [
              `    KIMARADT DARAB (a ${MAX_CHUNKS_PER_SOURCE}-os korlát fölött): ${o.chunksDropped}`,
            ]
          : []),
        ...(o.retractionUnchecked
          ? [
              "    A VISSZAVONÁS-ELLENŐRZÉS NEM FUTOTT RAJTA (nincs DOI): a szerkesztő nézze meg",
            ]
          : []),
      ].join("\n"),
    )
    .join("\n")}\n`;
}

export async function runExtractionCli(
  argv: readonly string[],
  out: Output,
  deps: ExtractionCliDeps,
): Promise<number> {
  const ids = parseSourceIds(option(argv, "--source"));
  if (typeof ids === "string") {
    out.stderr(
      `${ids}\nHasználat: --source <id>[,<id>...] [--apply --actor <userId>] [--reextract]\n`,
    );
    return 2;
  }
  if (!deps.extractor) {
    out.stderr(
      `Nincs AI-kiolvasó: ${AI_CLAIM_EXTRACTION_PATH_ENV} és az AI beállítás nélkül nincs hívás.\n`,
    );
    return 1;
  }
  // the switch guards the AI call too, not only the store: a preview is a
  // paid model call on a third party's text (barracuda, #1838)
  if (deps.env[DISCOVERY_SWITCH_ENV] !== "on") {
    out.stderr(
      `A kiolvasáshoz ${DISCOVERY_SWITCH_ENV}=on kell (csak a teszt környezetben), próbafutáshoz is.\n`,
    );
    return 1;
  }
  const apply = argv.includes("--apply");
  const reextract = argv.includes("--reextract");
  let runId: string | null = null;
  let actor: string | null = null;
  if (apply) {
    actor = option(argv, "--actor");
    if (!actor || !(await deps.actorExists(actor))) {
      out.stderr("Az --apply-hoz létező felhasználó kell: --actor <userId>\n");
      return 2;
    }
    try {
      // a killed run leaves its row RUNNING: fail it once silent, as the endpoint does
      await deps.store.abandonStale(
        new Date(deps.now().getTime() - STALE_AFTER_MS),
      );
      runId = await deps.store.startRun({
        sourceIds: ids,
        requestedById: actor,
        startedAt: deps.now(),
      });
    } catch (error) {
      if (!(error instanceof RunAlreadyRunning)) throw error;
      out.stderr("Már fut egy kiolvasás; egyszerre egy futhat.\n");
      return 5;
    }
  }
  const beating = runId;
  const stop = beating
    ? (deps.every ?? everyInterval)(() => {
        void deps.store.heartbeat(beating).catch(() => undefined);
      }, HEARTBEAT_MS)
    : () => undefined;
  try {
    const outcomes: SourceOutcome[] = [];
    for (const id of ids)
      outcomes.push(
        await extractSource(id, apply, {
          store: deps.store,
          extractor: deps.extractor,
          fetch: deps.fetch,
          vocabulary: deps.vocabulary,
          now: deps.now,
          ...(runId ? { runId } : {}),
          ...(reextract ? { reextract: { actorUserId: actor } } : {}),
        }),
      );
    const created = outcomes.reduce((n, o) => n + o.claimsCreated, 0);
    if (runId)
      await deps.store.finishRun(runId, { sources: outcomes }, created);
    out.stdout(outcomeReport(outcomes));
    out.stdout(
      apply
        ? `Futás ${runId}: ${created} jelölt állítás tárolva (mind CANDIDATE, a mezők PENDING).\n`
        : "Próbafutás: semmi nem tárolódott. Tárolás: --apply --actor <userId>\n",
    );
    return 0;
  } catch (error) {
    if (error instanceof RunAbandoned) {
      out.stderr(
        "A futást közben egy másik indítás elhagyottnak jelölte (5 percig nem jött szívverés); ami addig nem tárolódott, az nem is fog.\n",
      );
      return 6;
    }
    if (runId)
      await deps.store.failRun(runId, (error as Error)?.name ?? "Error");
    throw error;
  } finally {
    stop();
  }
}

/* c8 ignore start */
async function main(): Promise<void> {
  const code = await runExtractionCli(
    process.argv.slice(2),
    {
      stdout: (t) => process.stdout.write(t),
      stderr: (t) => process.stderr.write(t),
    },
    {
      env: process.env,
      store: new PrismaExtractionStore(),
      extractor: claimExtractorFromEnv(process.env),
      fetch: (url, init) => fetch(url, init),
      vocabulary: vocabularyV1(),
      actorExists: async (id) =>
        (await prisma.user.findUnique({
          where: { id },
          select: { id: true },
        })) !== null,
      now: () => new Date(),
    },
  );
  await prisma.$disconnect();
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
