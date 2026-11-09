import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import type { TrialDatabase } from "./trial-database.js";
import { buildTrialEnvironment } from "./trial-environment.js";
import { runTrialFlows } from "./trial-flows.js";
import { assessTrialIntegrations } from "./trial-integrations.js";
import type { TrialCheck } from "./verification-gate.js";

/**
 * THE WORKING TRIAL, END TO END (task stage-anonim-proba; acrobot 45147). In this order, and each step gates the next:
 *   1. MEASURE that no external integration of the instance can reach a live third party (`assessTrialIntegrations`, over the
 *      environment the trial builds and the stored settings of the database it reads). One failed check and the instance is NOT
 *      STARTED: the trial returns the checks, with the integration's name in the failed one.
 *   2. START the API instance, with that environment and nothing else (output discarded: a log line of an application can carry
 *      data), and wait for `/health` to answer.
 *   3. RUN the four flows (`runTrialFlows`) as an owner or admin who logs in with the stage password.
 *   4. STOP the instance, whatever happened.
 * The database it is given is the trial COPY (`withTrialCopy`), never the swap candidate itself.
 */
export interface TrialRunOptions {
  /** The connection string of the trial COPY: its database name must be a `stage_anon_tmp_...` one (the environment builder refuses others). */
  readonly databaseUrl: string;
  /** The stage password (the plain one the owner hands out): the trial logs in with it. */
  readonly password: string;
  /** The built API entry point (`apps/api/dist/main.js`). */
  readonly apiMain: string;
  readonly database: TrialDatabase;
  /** The `.env` files the generated Prisma client would load (`prismaLoadedEnvFiles`); `null` when that could not be measured. */
  readonly loadedEnvFiles: readonly string[] | null;
  readonly port?: number;
  readonly redisUrl?: string;
  readonly path?: string;
  /** How long to wait for `/health`, in milliseconds. */
  readonly healthTimeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly spawnImpl?: typeof spawn;
  readonly progress?: (line: string) => void;
}

const API_CHECK =
  "api: the instance starts on the temporary database copy and answers /health";

/** A free TCP port on the loopback (the API cannot be told to pick one: it reads `PORT`). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(
  baseUrl: string,
  child: ChildProcess,
  timeoutMs: number,
  doFetch: typeof fetch,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      return `exited with code ${child.exitCode} before it answered`;
    try {
      const response = await doFetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return null;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return "did not answer /health in time (is Redis reachable, and is the API built?)";
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  await exited;
  clearTimeout(timer);
}

export async function runTrial(
  options: TrialRunOptions,
): Promise<TrialCheck[]> {
  const port = options.port ?? (await freePort());
  const env = buildTrialEnvironment({
    databaseUrl: options.databaseUrl,
    port,
    redisUrl: options.redisUrl,
    path: options.path,
  });

  options.progress?.("measuring the integrations");
  const integration = assessTrialIntegrations({
    env,
    settings: await options.database.connectionSettings(),
    deviceTokens: await options.database.deviceTokenCount(),
    loadedEnvFiles: options.loadedEnvFiles,
  });
  if (integration.some((check) => !check.passed)) return integration;

  const email = await options.database.loginEmail();
  if (email === null)
    return [
      ...integration,
      {
        name: "login: an active owner or admin with a password and no partner scope exists (none found)",
        passed: false,
      },
    ];

  options.progress?.("starting the API instance");
  const child = (options.spawnImpl ?? spawn)(
    process.execPath,
    [options.apiMain],
    {
      env,
      stdio: "ignore",
    },
  );
  // a spawn failure must not crash the trial: the health wait reports it
  child.on("error", () => undefined);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const failure = await waitForHealth(
      baseUrl,
      child,
      options.healthTimeoutMs ?? 90_000,
      options.fetchImpl ?? fetch,
    );
    if (failure !== null)
      return [
        ...integration,
        { name: `${API_CHECK} (${failure})`, passed: false },
      ];
    const flows = await runTrialFlows({
      baseUrl,
      email,
      password: options.password,
      fetchImpl: options.fetchImpl,
      progress: options.progress,
    });
    return [...integration, { name: API_CHECK, passed: true }, ...flows];
  } finally {
    await stop(child);
  }
}
