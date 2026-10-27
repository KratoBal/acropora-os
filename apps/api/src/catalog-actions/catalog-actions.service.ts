import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type {
  CatalogActionKind,
  CatalogActionMode,
  CatalogActionRun,
  CatalogActionsResponse,
} from "@acropora/types";

import {
  CATALOG_ACTION_RUNNERS,
  CATALOG_ACTION_RUNNERS_TOKEN,
  CATALOG_ACTIONS_ENV,
  catalogActionsEnabled,
  type CatalogActionRunner,
} from "./catalog-actions.runners.js";

/** A plan confirms an apply only while it is this fresh. */
export const PLAN_VALID_MS = 30 * 60 * 1000;
const KEPT_RUNS = 20;

/**
 * THE RUNS LIVE IN THE API PROCESS, NOT IN A REQUEST.
 *
 * The brand links make one or two shop calls per product: with some seven
 * hundred products that is minutes, and the web proxy gives up at 50 s with a
 * bare 500. So the request starts the run and returns it; the page asks again.
 *
 * In memory, on purpose: both operations are repeatable (what is done is
 * skipped the next time), so a run lost to a restart costs one more click, and
 * a table for a test-only button would outlive the reason it was made.
 *
 * ONE RUN AT A TIME, across the kinds: the brand links read what the backfill
 * writes, and two writers on the same rows would make both summaries wrong.
 * The lock is this process's memory, so it holds for ONE API instance (the
 * test OS runs one). With more instances two runs could start at once, and
 * the lock would have to move to the database.
 *
 * AN APPLY RECOMPUTES: the commands plan again when they write, so the plan
 * run is what the confirmation SHOWS, not what the apply is bound to. If the
 * data changed since the plan, the apply's own summary says so (barracuda,
 * #1915); the page shows the two side by side.
 */
@Injectable()
export class CatalogActionsService {
  private readonly logger = new Logger(CatalogActionsService.name);
  private readonly runs = new Map<string, CatalogActionRun>();
  private readonly runners: readonly CatalogActionRunner[];
  private readonly environment: NodeJS.ProcessEnv;
  private readonly pending = new Map<string, Promise<void>>();
  /** The clock; a field so a test can move it. */
  now: () => Date = () => new Date();

  constructor(
    @Optional()
    @Inject(CATALOG_ACTION_RUNNERS_TOKEN)
    runners?: readonly CatalogActionRunner[],
    @Optional()
    @Inject(CATALOG_ACTIONS_ENV)
    environment?: NodeJS.ProcessEnv,
  ) {
    this.runners = runners ?? CATALOG_ACTION_RUNNERS;
    this.environment = environment ?? process.env;
  }

  enabled(): boolean {
    return catalogActionsEnabled(this.environment);
  }

  overview(): CatalogActionsResponse {
    if (!this.enabled()) return { enabled: false, actions: [] };
    return {
      enabled: true,
      actions: this.runners.map((runner) => ({
        kind: runner.kind,
        title: runner.title,
        description: runner.description,
        lastRun: this.latest(runner.kind) ?? null,
      })),
    };
  }

  get(id: string): CatalogActionRun {
    this.requireEnabled();
    const run = this.runs.get(id);
    if (!run) throw new NotFoundException("Nincs ilyen futás.");
    return run;
  }

  plan(kind: string, actorUserId: string): CatalogActionRun {
    this.requireEnabled();
    return this.start(this.runner(kind), "plan", actorUserId, null);
  }

  apply(
    kind: string,
    planRunId: unknown,
    actorUserId: string,
  ): CatalogActionRun {
    this.requireEnabled();
    const runner = this.runner(kind);
    if (typeof planRunId !== "string" || !planRunId)
      throw new BadRequestException(
        "A végrehajtáshoz meg kell adni a próba-futást (planRunId).",
      );
    const plan = this.runs.get(planRunId);
    if (!plan || plan.kind !== runner.kind || plan.mode !== "plan")
      throw new BadRequestException(
        "Ehhez a művelethez nincs ilyen próba-futás. Futtasd újra a próbát.",
      );
    if (plan.status !== "succeeded")
      throw new BadRequestException(
        "A próba nem fejeződött be sikeresen, ezért nem erősíthető meg.",
      );
    if (plan.appliedByRunId)
      throw new ConflictException(
        "Ezt a próbát már végrehajtották. Új végrehajtáshoz új próba kell.",
      );
    const finished = plan.finishedAt ? Date.parse(plan.finishedAt) : NaN;
    if (!(this.now().getTime() - finished <= PLAN_VALID_MS))
      throw new BadRequestException(
        "A próba 30 percnél régebbi, az adat azóta változhatott. Futtasd újra.",
      );
    const run = this.start(runner, "apply", actorUserId, plan.id);
    plan.appliedByRunId = run.id;
    return run;
  }

  /** Resolves when the given run has finished; for tests and shutdown. */
  async settled(id: string): Promise<CatalogActionRun> {
    await this.pending.get(id);
    return this.get(id);
  }

  private requireEnabled(): void {
    if (!this.enabled()) throw new NotFoundException();
  }

  private runner(kind: string): CatalogActionRunner {
    const runner = this.runners.find((r) => r.kind === kind);
    if (!runner) throw new NotFoundException("Nincs ilyen művelet.");
    return runner;
  }

  private latest(kind: CatalogActionKind): CatalogActionRun | undefined {
    let latest: CatalogActionRun | undefined;
    for (const run of this.runs.values()) if (run.kind === kind) latest = run;
    return latest;
  }

  private start(
    runner: CatalogActionRunner,
    mode: CatalogActionMode,
    actorUserId: string,
    planRunId: string | null,
  ): CatalogActionRun {
    const running = [...this.runs.values()].find((r) => r.status === "running");
    if (running)
      throw new ConflictException(
        `Már fut egy művelet (${running.kind}, ${running.mode === "plan" ? "próba" : "végrehajtás"}). Várd meg a végét.`,
      );

    const run: CatalogActionRun = {
      id: randomUUID(),
      kind: runner.kind,
      mode,
      status: "running",
      startedAt: this.now().toISOString(),
      finishedAt: null,
      actorUserId,
      exitCode: null,
      output: "",
      error: null,
      planRunId,
      appliedByRunId: null,
    };
    this.runs.set(run.id, run);
    this.forgetOld();
    this.logger.log(
      `catalog action ${run.kind} ${mode} started by user ${actorUserId} (run ${run.id})`,
    );

    const write = (value: string) => {
      run.output += value;
    };
    const done = (async () => {
      try {
        run.exitCode = await runner.run(mode === "apply", actorUserId, {
          stdout: write,
          stderr: write,
        });
        run.status = run.exitCode === 0 ? "succeeded" : "failed";
      } catch (error) {
        run.status = "failed";
        run.error = error instanceof Error ? error.message : String(error);
      }
      run.finishedAt = this.now().toISOString();
      this.logger.log(
        `catalog action ${run.kind} ${mode} ${run.status} (run ${run.id}, exit ${run.exitCode ?? "-"})`,
      );
    })();
    this.pending.set(run.id, done);
    void done.finally(() => this.pending.delete(run.id));
    return run;
  }

  private forgetOld(): void {
    const finished = [...this.runs.values()].filter(
      (r) => r.status !== "running",
    );
    for (const run of finished.slice(
      0,
      Math.max(0, this.runs.size - KEPT_RUNS),
    ))
      this.runs.delete(run.id);
  }
}
