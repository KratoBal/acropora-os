import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Vocabulary } from "@acropora/knowledge-base";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  DISCOVERY_SWITCH_ENV,
  HEARTBEAT_MS,
  STALE_AFTER_MS,
  everyInterval,
  runDiscovery,
  type DiscoveryInput,
  type DiscoveryResult,
} from "../discovery/discovery-run.js";
import {
  ScholarlyClient,
  type ApiFetch,
} from "../discovery/scholarly-client.js";
import {
  AI_CLAIM_EXTRACTION_PATH_ENV,
  claimExtractorFromEnv,
  type ClaimExtractor,
} from "../extraction/claim-extractor.js";
import {
  readFullTextClaims,
  type TextFetch,
} from "../extraction/extraction-run.js";
import { VocabularyRepository } from "../vocabulary/vocabulary.repository.js";
import {
  AI_RESEARCH_QUERIES_PATH_ENV,
  AI_RESEARCH_SUMMARY_PATH_ENV,
  researchAskerFromEnv,
  type ResearchAsker,
} from "./research-draft-client.js";
import {
  DRAFT_REQUEST_LIMIT,
  MAX_CHUNKS_PER_DRAFT_SOURCE,
  ResearchQuestionError,
  parseResearchQuestion,
  runResearchDraft,
} from "./research-draft.js";
import {
  DraftAlreadyRunning,
  PrismaDraftStore,
  type DraftDetail,
  type DraftRow,
  type DraftStore,
} from "./research-draft.store.js";

export const RESEARCH_DRAFT_DEPS = Symbol("KNOWLEDGE_RESEARCH_DRAFT_DEPS");

/**
 * The draft's searches, each with its own client and one request budget between them. A client
 * closes an API for the rest of its run on a refusal; with one client for both, a 400 on the
 * title-and-abstract field would have closed Europe PMC before the full-text fallback could ask.
 */
export function budgetedDiscovery(
  newClient: (requestLimit: number) => ScholarlyClient,
  now: () => Date,
): (input: DiscoveryInput) => Promise<DiscoveryResult> {
  let used = 0;
  return async (input) => {
    const client = newClient(Math.max(0, DRAFT_REQUEST_LIMIT - used));
    try {
      return await runDiscovery(input, { client, now });
    } finally {
      used += client.requestCount;
    }
  };
}
export const LIST_LIMIT = 20;

export interface ResearchDraftDeps {
  env: NodeJS.ProcessEnv;
  store: DraftStore;
  ask: ResearchAsker | null;
  extractor: ClaimExtractor | null;
  approvedVocabulary: () => Promise<Vocabulary>;
  fetch: ApiFetch & TextFetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  every?: (beat: () => void, ms: number) => () => void;
}

/**
 * MODE B, STARTED OVER HTTP (S6 slice 4b). The chain takes minutes (Crossref
 * allows one request a second, each AI call may take its timeout), so the
 * POST answers 202 with the draft's id, and the row is read back with GET,
 * as the discovery and the extraction runs are. `knowledge.manage`: an
 * editor's tool, never a customer's. The research switch must be on; one
 * draft at a time, and not while a discovery or an extraction runs (they
 * share the keyless scholarly budget and the AI).
 */
@Injectable()
export class ResearchDraftService {
  private readonly logger = new Logger(ResearchDraftService.name);
  private readonly deps: ResearchDraftDeps;
  /** Drafts started by this process, until they settle (tests wait on them). */
  readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @Optional()
    @Inject(RESEARCH_DRAFT_DEPS)
    deps: ResearchDraftDeps | null = null,
  ) {
    this.deps = deps ?? {
      env: process.env,
      store: new PrismaDraftStore(),
      ask: researchAskerFromEnv(process.env),
      extractor: claimExtractorFromEnv(process.env),
      approvedVocabulary: () => new VocabularyRepository().approvedVocabulary(),
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
    };
  }

  async start(
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<{ id: string; status: "RUNNING" }> {
    const { env, store, ask, extractor } = this.deps;
    if (env[DISCOVERY_SWITCH_ENV] !== "on")
      throw new ForbiddenException(
        `A kutatási tudástár ki van kapcsolva (${DISCOVERY_SWITCH_ENV}).`,
      );
    if (!ask || !extractor)
      throw new ServiceUnavailableException(
        `Nincs AI-kutató beállítva (${AI_RESEARCH_QUERIES_PATH_ENV}, ${AI_RESEARCH_SUMMARY_PATH_ENV}, ${AI_CLAIM_EXTRACTION_PATH_ENV}).`,
      );
    let question: string;
    try {
      question = parseResearchQuestion(body);
    } catch (error) {
      if (error instanceof ResearchQuestionError)
        throw new BadRequestException(error.message);
      throw error;
    }

    await store.abandonStale(
      new Date(this.deps.now().getTime() - STALE_AFTER_MS),
    );
    const busy =
      "Már fut egy kutatási tervezet, felderítés vagy kiolvasás; egyszerre egy futhat.";
    if (
      this.inFlight.size ||
      (await store.running()) ||
      (await store.otherRunRunning())
    )
      throw new ConflictException(busy);
    let id: string;
    try {
      id = await store.start({
        question,
        createdById: user.id,
        startedAt: this.deps.now(),
      });
    } catch (error) {
      if (error instanceof DraftAlreadyRunning)
        throw new ConflictException(busy);
      throw error;
    }

    const stop = (this.deps.every ?? everyInterval)(() => {
      void store.heartbeat(id).catch(() => undefined);
    }, HEARTBEAT_MS);
    const work = (async () => {
      // the version approved when the draft starts: an approval mid-run does not split it
      const vocabulary = await this.deps.approvedVocabulary();
      const discover = budgetedDiscovery(
        (requestLimit) =>
          new ScholarlyClient({
            fetch: this.deps.fetch,
            sleep: this.deps.sleep,
            now: this.deps.now,
            requestLimit,
          }),
        this.deps.now,
      );
      const result = await runResearchDraft(question, `research-draft ${id}`, {
        ask,
        discover,
        read: (pmcid, outcome) =>
          readFullTextClaims(pmcid, outcome, {
            extractor,
            fetch: this.deps.fetch,
            vocabulary,
            maxChunks: MAX_CHUNKS_PER_DRAFT_SOURCE,
          }),
      });
      await store.finish(id, result, this.deps.now());
      // codes and counts only: the question and the summary are text
      this.logger.log({
        msg: "research draft finished",
        id,
        status: result.status,
        reason: result.reason,
        queries: result.report.queries.length,
        found: result.report.discovery?.found ?? 0,
        read: result.sources.filter((s) => s.read === "READ").length,
        claims: result.candidateClaims.length,
        droppedHere: result.report.summaryDroppedHere,
      });
    })()
      .catch(async (error: unknown) => {
        // the name only: an error's text may carry a source's text
        const name = (error as Error)?.name ?? "Error";
        this.logger.error(`research draft ${id} failed: ${name}`);
        await store.fail(id, name, this.deps.now()).catch(() => undefined);
      })
      .finally(() => {
        stop();
        this.inFlight.delete(id);
      });
    this.inFlight.set(id, work);
    return { id, status: "RUNNING" };
  }

  list(): Promise<DraftRow[]> {
    return this.deps.store.list(LIST_LIMIT);
  }

  async get(id: string): Promise<DraftDetail> {
    const draft = await this.deps.store.get(id);
    if (!draft) throw new NotFoundException("Nincs ilyen kutatási tervezet.");
    return draft;
  }
}

/**
 * KUTATÁSI TERVEZET (S6 B mód): a szerkesztő kérdéséből külső, nyílt forrásokból
 * írt modell-szöveg, ellenőrzött jelölt állításokkal. Állítás SOHA nem lesz
 * belőle magától; `knowledge.manage` joggal, a `KNOWLEDGE_DISCOVERY` kapcsoló
 * mögött, csak a teszt környezetben.
 */
@Controller("knowledge-base/research-drafts")
export class ResearchDraftController {
  constructor(private readonly drafts: ResearchDraftService) {}

  @Post()
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  start(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.drafts.start(body, user);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  list() {
    return this.drafts.list();
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  get(@Param("id") id: string) {
    return this.drafts.get(id);
  }
}
