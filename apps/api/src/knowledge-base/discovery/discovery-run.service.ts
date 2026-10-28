import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import {
  DEFAULT_REQUEST_LIMIT,
  HEARTBEAT_MS,
  everyInterval,
  DISCOVERY_SWITCH_ENV,
  MAX_REQUEST_LIMIT,
  STALE_AFTER_MS,
  parseDiscoveryInput,
  runDiscovery,
} from "./discovery-run.js";
import {
  PrismaDiscoveryStore,
  type DiscoveryRunDetail,
  type DiscoveryRunLedger,
  type DiscoveryRunRow,
  type DiscoveryStore,
  RunAlreadyRunning,
} from "./discovery-run.store.js";
import { researchDraftRunning } from "../research-drafts/research-draft.store.js";
import { ScholarlyClient, type ApiFetch } from "./scholarly-client.js";

/**
 * THE SOURCE DISCOVERY, STARTED OVER HTTP (S2, acrobot 35604).
 *
 * The CLI needs a shell in the stage api container, which the fleet does not
 * have, so every run would take Balázs's hands. This is the same discovery
 * behind the same switch, started by a signed-in user with
 * `knowledge.research.run`, who is the run's actor. The run goes on after the
 * answer (it takes a minute or more: Crossref allows one request a second),
 * so the POST answers 202 with the run's id, and the run record is read back
 * with GET while it is RUNNING and after.
 *
 * One run at a time: the keyless OpenAlex budget and Crossref's public pool
 * are shared by everything behind the server's address. The database holds
 * the rule (a partial unique index on the RUNNING row), so two api instances
 * cannot both start (barracuda, #1834). A running process beats every
 * `HEARTBEAT_MS`; a RUNNING record silent for `STALE_AFTER_MS` belongs to a
 * process that died under it, and is marked FAILED before the next start. A
 * long run is not cut by its length, only by its silence.
 */
export { STALE_AFTER_MS };
export const DISCOVERY_DEPS = Symbol("KNOWLEDGE_DISCOVERY_DEPS");
export const LIST_LIMIT = 20;

export interface DiscoveryServiceDeps {
  env: NodeJS.ProcessEnv;
  store: DiscoveryStore & DiscoveryRunLedger;
  fetch: ApiFetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** Runs `beat` every `ms` until the returned stop is called. */
  every?: (beat: () => void, ms: number) => () => void;
  /** A mode B research draft running (it shares the keyless budget); absent: none. */
  draftRunning?: () => Promise<boolean>;
}

@Injectable()
export class KnowledgeDiscoveryService {
  private readonly logger = new Logger(KnowledgeDiscoveryService.name);
  private readonly deps: DiscoveryServiceDeps;
  /** Runs started by this process, until they settle (tests wait on them). */
  readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @Optional()
    @Inject(DISCOVERY_DEPS)
    deps: DiscoveryServiceDeps | null = null,
  ) {
    this.deps = deps ?? {
      env: process.env,
      store: new PrismaDiscoveryStore(),
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
      draftRunning: researchDraftRunning,
    };
  }

  async start(
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<{ id: string; status: "RUNNING" }> {
    const { env, store } = this.deps;
    if (env[DISCOVERY_SWITCH_ENV] !== "on")
      throw new ForbiddenException(
        `A kutatási forrás-felderítés ki van kapcsolva (${DISCOVERY_SWITCH_ENV}).`,
      );
    const raw = (body ?? {}) as Record<string, unknown>;
    const { maxRequests, ...rest } = raw;
    const requestLimit =
      maxRequests === undefined ? DEFAULT_REQUEST_LIMIT : maxRequests;
    if (
      typeof requestLimit !== "number" ||
      !Number.isInteger(requestLimit) ||
      requestLimit < 1 ||
      requestLimit > MAX_REQUEST_LIMIT
    )
      throw new BadRequestException(
        `maxRequests: 1 és ${MAX_REQUEST_LIMIT} közötti egész szám kell.`,
      );
    const parsed = parseDiscoveryInput(JSON.stringify(rest));
    if (!parsed.ok) throw new BadRequestException(parsed.problems);

    await store.abandonStale(
      new Date(this.deps.now().getTime() - STALE_AFTER_MS),
    );
    const running = await store.running();
    if (running || this.inFlight.size)
      throw new ConflictException(
        `Már fut egy felderítés${running ? ` (${running.id})` : ""}; egyszerre egy futhat.`,
      );
    if (await this.deps.draftRunning?.())
      throw new ConflictException(
        "Fut egy kutatási tervezet; a felderítés utána indítható.",
      );

    let runId: string;
    try {
      runId = await store.startRun({
        input: parsed.input,
        requestedById: user.id,
        startedAt: this.deps.now(),
      });
    } catch (error) {
      if (error instanceof RunAlreadyRunning)
        throw new ConflictException(
          "Már fut egy felderítés; egyszerre egy futhat.",
        );
      throw error;
    }
    const stopBeating = (this.deps.every ?? everyInterval)(() => {
      void store.heartbeat(runId).catch(() => undefined);
    }, HEARTBEAT_MS);
    const client = new ScholarlyClient({
      fetch: this.deps.fetch,
      sleep: this.deps.sleep,
      now: this.deps.now,
      requestLimit,
    });
    const work = runDiscovery(parsed.input, { client, now: this.deps.now })
      .then((result) => store.finishRun(runId, result))
      .then(
        () => undefined,
        async (error: unknown) => {
          // the name only: an error's text may carry an API's answer
          const name = (error as Error)?.name ?? "Error";
          this.logger.error(`knowledge discovery ${runId} failed: ${name}`);
          await store.failRun(runId, name).catch(() => undefined);
        },
      )
      .finally(() => {
        stopBeating();
        this.inFlight.delete(runId);
      });
    this.inFlight.set(runId, work);
    return { id: runId, status: "RUNNING" };
  }

  list(): Promise<DiscoveryRunRow[]> {
    return this.deps.store.listRuns(LIST_LIMIT);
  }

  async get(id: string): Promise<DiscoveryRunDetail> {
    const run = await this.deps.store.getRun(id);
    if (!run) throw new NotFoundException("Nincs ilyen felderítő futás.");
    return run;
  }
}
