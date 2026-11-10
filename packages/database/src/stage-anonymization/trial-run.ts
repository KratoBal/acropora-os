import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
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
  /** Who holds the listening socket (tests); the default reads `/proc`. */
  readonly ownsPortImpl?: typeof processOwnsListeningPort;
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

/**
 * IS THE PORT STILL FREE (card a46fcda6): `freePort` frees the port it measured, so between that moment and the instance's own
 * bind ANOTHER process can take it. If one answers `/health` there, the trial would take its answer for the instance's and log in
 * against a foreign process. Measured on the one CI failure: the test ended in 387 ms, while a pass needs at least 500 ms (the
 * first `/health` try is refused and the wait sleeps), so the first try was ANSWERED, before the stand-in had even written its
 * first line. A bind attempt right before the spawn closes most of that window; the alive check after `/health` answers (below)
 * closes the rest.
 */
export function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

/** How long the instance gets, after `/health` answered, to show it is still the one that is running (the fallback of `waitForHealth`). */
const SETTLE_MS = 250;

/**
 * DOES THIS PROCESS HOLD THE LISTENING SOCKET OF THE PORT (card eb2ed687): the IDENTITY of whoever answers `/health`, instead of
 * a guess from timing. Two listeners cannot share a port, so when the child owns the listening socket, every answer on that port
 * is the child's. It reads the kernel's table (`/proc/net/tcp` and `tcp6`: the listening sockets of the port and their inodes)
 * and the process's open files (`/proc/<pid>/fd`: `socket:[inode]`), so it needs NO change in the instance (the real API, a
 * stand-in), no nonce and no port chosen by the instance.
 *
 * `true` / `false`: measured. `null`: it cannot be measured here (no `/proc`, no pid, a file that cannot be read): the caller
 * falls back to the timing guards and does not pretend to know. The trial runs on Linux (the stage container); on another system
 * the fallback is what remains.
 */
export function processOwnsListeningPort(
  pid: number | undefined,
  port: number,
  proc = "/proc",
): boolean | null {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
    const listening = new Set<string>();
    for (const table of ["tcp", "tcp6"]) {
      let text: string;
      try {
        text = readFileSync(`${proc}/net/${table}`, "utf8");
      } catch (error) {
        // IPv6 may be off (no tcp6); the IPv4 table is the one that must be there
        if (table === "tcp6") continue;
        throw error;
      }
      for (const line of text.split("\n").slice(1)) {
        const cols = line.trim().split(/\s+/);
        // sl local_address rem_address st tx:rx tr:when retrnsmt uid timeout inode
        const [, local, , state, , , , , , inode] = cols;
        if (
          state === "0A" &&
          local !== undefined &&
          local.split(":")[1]?.toUpperCase() === hexPort &&
          inode !== undefined
        )
          listening.add(inode);
      }
    }
    for (const fd of readdirSync(`${proc}/${pid}/fd`)) {
      let target: string;
      try {
        target = readlinkSync(`${proc}/${pid}/fd/${fd}`);
      } catch {
        continue; // a descriptor closed while we read
      }
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (match && listening.has(match[1]!)) return true;
    }
    return false;
  } catch {
    return null;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(
  baseUrl: string,
  child: ChildProcess,
  timeoutMs: number,
  doFetch: typeof fetch,
  port: number,
  ownsPort: typeof processOwnsListeningPort = processOwnsListeningPort,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      return `exited with code ${child.exitCode} before it answered`;
    /*
      THE ANSWER IS THE INSTANCE'S OWN ONLY WHEN THE INSTANCE HOLDS THE PORT (card eb2ed687). Measured: the child's listening
      socket on the port. Not yet (it is still starting, or another process holds the port): do not ask `/health` at all, a
      foreign process would answer it. Held: the answer is the child's, nobody else can listen there. Not measurable (`null`):
      the timing guards below, as before.
    */
    const owned = ownsPort(child.pid, port);
    if (owned === false) {
      await sleep(100);
      continue;
    }
    try {
      const response = await doFetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) {
        // measured identity: nothing more to wait for
        if (owned === true) return null;
        /*
          NOT MEASURABLE here: an instance that could not bind (the port was taken, so another process answered) exits within
          moments. Give it a moment, and a child that is gone is not the one that answered.
        */
        await sleep(SETTLE_MS);
        if (child.exitCode !== null)
          return `exited with code ${child.exitCode} right after /health answered (another process on the port may have answered)`;
        return null;
      }
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

  if (!(await portIsFree(port)))
    return [
      ...integration,
      {
        name: `${API_CHECK} (port ${port} is already in use by another process: the instance is not started, and nothing that answers there is taken for it)`,
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
      port,
      options.ownsPortImpl,
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
