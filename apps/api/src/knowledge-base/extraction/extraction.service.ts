import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { vocabularyV1, type Vocabulary } from "@acropora/knowledge-base";
import type { AuthenticatedUser } from "@acropora/types";

import {
  DISCOVERY_SWITCH_ENV,
  HEARTBEAT_MS,
  STALE_AFTER_MS,
  everyInterval,
} from "../discovery/discovery-run.js";
import { RunAlreadyRunning } from "../discovery/discovery-run.store.js";
import { researchDraftRunning } from "../research-drafts/research-draft.store.js";
import { VocabularyRepository } from "../vocabulary/vocabulary.repository.js";
import { claimExtractorFromEnv } from "./claim-extractor.js";
import { parseSourceIds } from "./extraction.cli.js";
import { extractSource, type SourceOutcome } from "./extraction-run.js";
import {
  PrismaExtractionStore,
  type ExtractionRunDetail,
  type ExtractionRunRow,
} from "./extraction-store.js";
import type { ExtractionCliDeps } from "./extraction.cli.js";

/**
 * THE CLAIM EXTRACTION, STARTED OVER HTTP (S3; the fleet has no shell in the
 * stage api container, acrobot 35604). Same switch, same permission and the
 * same one-at-a-time rule as the discovery: the run goes on after the 202,
 * beats every minute, and is read back with GET.
 */
export const EXTRACTION_DEPS = Symbol("KNOWLEDGE_EXTRACTION_DEPS");
export const LIST_LIMIT = 20;

export type ExtractionServiceDeps = Omit<ExtractionCliDeps, "actorExists"> & {
  /** The approved vocabulary at the run's start (S5: it lives in the database). */
  approvedVocabulary?: () => Promise<Vocabulary>;
  /** A mode B research draft running (it shares the AI and Europe PMC); absent: none. */
  draftRunning?: () => Promise<boolean>;
};

@Injectable()
export class KnowledgeExtractionService {
  private readonly logger = new Logger(KnowledgeExtractionService.name);
  private readonly deps: ExtractionServiceDeps;
  readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @Optional()
    @Inject(EXTRACTION_DEPS)
    deps: ExtractionServiceDeps | null = null,
  ) {
    this.deps = deps ?? {
      env: process.env,
      store: new PrismaExtractionStore(),
      extractor: claimExtractorFromEnv(process.env),
      fetch: (url, init) => fetch(url, init),
      vocabulary: vocabularyV1(),
      approvedVocabulary: () => new VocabularyRepository().approvedVocabulary(),
      now: () => new Date(),
      draftRunning: researchDraftRunning,
    };
  }

  async start(
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<{ id: string; status: "RUNNING" }> {
    const { env, store, extractor } = this.deps;
    if (env[DISCOVERY_SWITCH_ENV] !== "on")
      throw new ForbiddenException(
        `A kutatási tudástár ki van kapcsolva (${DISCOVERY_SWITCH_ENV}).`,
      );
    if (!extractor)
      throw new ServiceUnavailableException(
        "Nincs AI-kiolvasó beállítva (ACROPORA_AI_CLAIM_EXTRACTION_PATH).",
      );
    const ids = parseSourceIds(
      (body as Record<string, unknown> | null)?.sourceIds,
    );
    // read an already extracted source again, withdrawing its unreviewed claims
    const reextract =
      (body as Record<string, unknown> | null)?.reextract === true;
    if (typeof ids === "string") throw new BadRequestException(ids);

    await store.abandonStale(
      new Date(this.deps.now().getTime() - STALE_AFTER_MS),
    );
    if (this.inFlight.size)
      throw new ConflictException(
        "Már fut egy kiolvasás; egyszerre egy futhat.",
      );
    if (await this.deps.draftRunning?.())
      throw new ConflictException(
        "Fut egy kutatási tervezet; a kiolvasás utána indítható.",
      );
    let runId: string;
    try {
      runId = await store.startRun({
        sourceIds: ids,
        requestedById: user.id,
        startedAt: this.deps.now(),
      });
    } catch (error) {
      if (error instanceof RunAlreadyRunning)
        throw new ConflictException(
          "Már fut egy kiolvasás; egyszerre egy futhat.",
        );
      throw error;
    }
    const stop = (this.deps.every ?? everyInterval)(() => {
      void store.heartbeat(runId).catch(() => undefined);
    }, HEARTBEAT_MS);
    const work = (async () => {
      // the version approved when the run starts: an approval mid-run does not split it
      const vocabulary = this.deps.approvedVocabulary
        ? await this.deps.approvedVocabulary()
        : this.deps.vocabulary;
      const outcomes: SourceOutcome[] = [];
      for (const id of ids)
        outcomes.push(
          await extractSource(id, true, {
            store,
            extractor,
            fetch: this.deps.fetch,
            vocabulary,
            now: this.deps.now,
            runId,
            ...(reextract ? { reextract: { actorUserId: user.id } } : {}),
          }),
        );
      await store.finishRun(
        runId,
        { sources: outcomes },
        outcomes.reduce((n, o) => n + o.claimsCreated, 0),
      );
    })()
      .catch(async (error: unknown) => {
        // the name only: an error's text may carry a source's text
        const name = (error as Error)?.name ?? "Error";
        this.logger.error(`knowledge extraction ${runId} failed: ${name}`);
        await store.failRun(runId, name).catch(() => undefined);
      })
      .finally(() => {
        stop();
        this.inFlight.delete(runId);
      });
    this.inFlight.set(runId, work);
    return { id: runId, status: "RUNNING" };
  }

  list(): Promise<ExtractionRunRow[]> {
    return this.deps.store.listRuns(LIST_LIMIT);
  }

  async get(id: string): Promise<ExtractionRunDetail> {
    const run = await this.deps.store.getRun(id);
    if (!run) throw new NotFoundException("Nincs ilyen kiolvasó futás.");
    return run;
  }
}
