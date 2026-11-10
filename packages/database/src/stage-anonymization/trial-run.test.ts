import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { describe, it } from "node:test";

import type { TrialDatabase } from "./trial-database.js";
import {
  freePort,
  portIsFree,
  processOwnsListeningPort,
  runTrial,
} from "./trial-run.js";
import type { ConnectionSettingState } from "./trial-integrations.js";

/*
  THE TRIAL END TO END (S-trial). WHAT TURNS THIS RED: an integration that is not closed and an instance that is STARTED anyway;
  an instance that does not answer and a trial that passes; an instance left running; a login user that is missing and a trial that
  carries on; a database name that is not a temporary one and a trial that builds an environment for it. It runs REAL child
  processes (a tiny stand-in for the API) so the start, the health wait and the stop are the real ones.
*/
const clean: ConnectionSettingState[] = (
  ["UNAS", "NAV", "Számlázz", "Medusa"] as const
).map((integration) => ({
  integration,
  credentialMode: "ENV_FALLBACK",
  storedCredentialColumns: 0,
}));
const database = (over: Partial<TrialDatabase> = {}): TrialDatabase => ({
  connectionSettings: async () => clean,
  deviceTokenCount: async () => 0,
  loginEmail: async () => "u1abc@teszt.acropora.invalid",
  ...over,
});
const URL_OK = "postgresql://u:p@localhost:5432/stage_anon_tmp_x_trial";
const dir = mkdtempSync(join(tmpdir(), "stage-trial-"));
const script = (name: string, body: string): string => {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
};
/** A stand-in for apps/api/dist/main.js: answers /health on PORT, writes a marker file, 404 for everything else. */
const standIn = (marker: string): string =>
  script(
    `api-${marker}.mjs`,
    `import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(dir, marker))}, "started");
createServer((req, res) => {
  res.statusCode = req.url === "/health" ? 200 : 404;
  res.setHeader("content-type", "application/json");
  res.end("{}");
}).listen(Number(process.env.PORT), "127.0.0.1");
process.on("SIGTERM", () => process.exit(0));
`,
  );
const base = {
  loadedEnvFiles: [] as string[] | null,
  databaseUrl: URL_OK,
  password: "stage-jelszo-nem-igazi-1", // scan-secrets: allow (an invented test string, not a credential)
  path: process.env.PATH,
};

describe("the integration measurement gates the start", () => {
  it("does NOT start the instance when an integration is not closed, and returns the failed check with its name", async () => {
    const apiMain = standIn("must-not-start");
    const checks = await runTrial({
      ...base,
      apiMain,
      database: database({
        connectionSettings: async () =>
          clean.map((s) =>
            s.integration === "UNAS" ? { ...s, storedCredentialColumns: 1 } : s,
          ),
      }),
    });
    assert.ok(
      checks.some(
        (c) => !c.passed && c.name.startsWith("integration closed: UNAS"),
      ),
    );
    assert.ok(
      !checks.some((c) => c.name.startsWith("api:")),
      "no instance check: it was never started",
    );
    assert.equal(existsSync(join(dir, "must-not-start")), false);
  });

  it("does not start the instance when a device token is left or the settings were not read", async () => {
    for (const over of [
      { deviceTokenCount: async () => 2 },
      { connectionSettings: async () => [] },
    ]) {
      const checks = await runTrial({
        ...base,
        apiMain: standIn("never"),
        database: database(over),
      });
      assert.ok(checks.some((c) => !c.passed));
      assert.equal(existsSync(join(dir, "never")), false);
    }
  });

  it("does not start the instance when a .env file would be loaded into it, or when that was not measured", async () => {
    for (const loadedEnvFiles of [["/srv/acropora/.env"], null]) {
      const checks = await runTrial({
        ...base,
        loadedEnvFiles,
        apiMain: standIn("envfile"),
        database: database(),
      });
      assert.ok(checks.some((c) => !c.passed && c.name.includes(".env file")));
      assert.equal(existsSync(join(dir, "envfile")), false);
    }
  });

  it("refuses a database that is not a temporary one before it measures or starts anything", async () => {
    await assert.rejects(
      runTrial({
        ...base,
        databaseUrl: "postgresql://u:p@h:5432/acropora",
        apiMain: standIn("n2"),
        database: database(),
      }),
      /temporary database/,
    );
    assert.equal(existsSync(join(dir, "n2")), false);
  });
});

describe("the instance", () => {
  it("is started with the built environment, answers /health, runs the flows (here against an API that knows nothing: they fail and are named) and is STOPPED afterwards", async () => {
    const port = await freePort();
    const checks = await runTrial({
      ...base,
      port,
      apiMain: standIn("started"),
      database: database(),
      healthTimeoutMs: 20_000,
    });
    assert.equal(existsSync(join(dir, "started")), true);
    assert.ok(checks.find((c) => c.name.startsWith("api:"))!.passed);
    assert.ok(
      checks
        .filter((c) => c.name.startsWith("integration closed"))
        .every((c) => c.passed),
    );
    const login = checks.find((c) => c.name.startsWith("login:"))!;
    assert.equal(login.passed, false);
    assert.equal(
      checks.filter((c) => c.name.startsWith("integration closed")).length,
      12,
    );
    // stopped: nothing answers on the port any more
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2_000),
      }),
    );
  });

  it("reports an instance that exits before it answers, naming the exit code, and starts no flow", async () => {
    const apiMain = script("exits.mjs", "process.exit(3);\n");
    const checks = await runTrial({
      ...base,
      apiMain,
      database: database(),
      healthTimeoutMs: 10_000,
    });
    const api = checks.find((c) => c.name.startsWith("api:"))!;
    assert.equal(api.passed, false);
    assert.match(api.name, /exited with code 3 before it answered/);
    assert.ok(!checks.some((c) => c.name.startsWith("login:")));
  });

  /*
    A FOREIGN ANSWER (card a46fcda6): the one CI failure was a trial that took a /health answer from another process on its port
    (387 ms, the stand-in's marker file never written). WHAT TURNS THESE RED: a port that is taken and an instance started anyway;
    a foreign answer taken for the instance's; an instance that exited right after a /health answer counted as up.
  */
  it("does not start the instance on a port another process already holds, and does not take that process's /health for its own", async () => {
    const foreign = createServer((_req, res) => {
      res.statusCode = 200;
      res.end("{}");
    });
    await new Promise<void>((resolve) =>
      foreign.listen(0, "127.0.0.1", resolve),
    );
    const port = (foreign.address() as { port: number }).port;
    try {
      assert.equal(await portIsFree(port), false);
      const checks = await runTrial({
        ...base,
        port,
        apiMain: standIn("foreign-port"),
        database: database(),
        healthTimeoutMs: 5_000,
      });
      const api = checks.find((c) => c.name.startsWith("api:"))!;
      assert.equal(api.passed, false);
      assert.match(api.name, /already in use/);
      assert.equal(existsSync(join(dir, "foreign-port")), false);
      assert.ok(!checks.some((c) => c.name.startsWith("login:")));
    } finally {
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
    assert.equal(await portIsFree(port), true);
  });

  it("does not count an instance that exits right after a /health answer as up (another process may have answered)", async () => {
    // a stand-in child whose exit is DETERMINISTIC (20 ms after the spawn), not a real process whose start-up time varies under load
    const fake = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      kill: () => true,
    });
    setTimeout(() => {
      fake.exitCode = 5;
    }, 20);
    const checks = await runTrial({
      ...base,
      apiMain: standIn("never-spawned"),
      database: database(),
      healthTimeoutMs: 10_000,
      spawnImpl: (() => fake) as unknown as typeof spawn,
      // an answer that comes at once, as a foreign process on the port would give it
      fetchImpl: (async () =>
        new Response("{}", { status: 200 })) as typeof fetch,
    });
    const api = checks.find((c) => c.name.startsWith("api:"))!;
    assert.equal(api.passed, false);
    assert.match(api.name, /exited with code 5 right after \/health answered/);
    assert.ok(!checks.some((c) => c.name.startsWith("login:")));
  });

  /*
    THE IDENTITY OF WHOEVER ANSWERS (card eb2ed687). WHAT TURNS THESE RED: a /health answer asked for, and taken, before the
    instance holds the port (a foreign process would give it); the ownership read that counts a connected socket (state 01), a
    socket of another port, or another process's socket as the instance's; an unmeasurable system (no /proc, no pid) read as "not
    the owner" (it must be `null`, so the timing guards still run).
  */
  it("reads the listening socket of the port from the kernel table: only LISTEN, only that port, only that process's descriptors (IPv4 and IPv6)", () => {
    const proc = mkdtempSync(join(tmpdir(), "fake-proc-"));
    mkdirSync(join(proc, "net"), { recursive: true });
    const header =
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";
    const row = (local: string, state: string, inode: number) =>
      `   0: ${local} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1 0000000000000000 100 0 0 10 0\n`;
    // 8080 = 1F90: a LISTEN row (inode 111), the same port ESTABLISHED (inode 222), another port LISTEN (inode 333)
    writeFileSync(
      join(proc, "net", "tcp"),
      header +
        row("0100007F:1F90", "0A", 111) +
        row("0100007F:1F90", "01", 222) +
        row("0100007F:1F91", "0A", 333),
    );
    // IPv6: 9000 = 2328, LISTEN (inode 444)
    writeFileSync(
      join(proc, "net", "tcp6"),
      header + row("00000000000000000000000001000000:2328", "0A", 444),
    );
    const fds = (pid: number, inodes: number[]) => {
      mkdirSync(join(proc, String(pid), "fd"), { recursive: true });
      inodes.forEach((inode, index) =>
        symlinkSync(
          `socket:[${inode}]`,
          join(proc, String(pid), "fd", String(index + 3)),
        ),
      );
    };
    fds(100, [111, 999]); // holds the LISTEN socket of 8080
    fds(200, [222, 333]); // an ESTABLISHED socket of 8080 and a LISTEN of another port
    fds(300, [444]); // the IPv6 listener of 9000
    assert.equal(processOwnsListeningPort(100, 8080, proc), true);
    assert.equal(processOwnsListeningPort(200, 8080, proc), false);
    assert.equal(processOwnsListeningPort(100, 8081, proc), false);
    assert.equal(processOwnsListeningPort(300, 9000, proc), true);
    assert.equal(processOwnsListeningPort(100, 9000, proc), false);
    // not measurable: no pid, a process with no fd directory, no /proc at all
    assert.equal(processOwnsListeningPort(undefined, 8080, proc), null);
    assert.equal(processOwnsListeningPort(999, 8080, proc), null);
    assert.equal(
      processOwnsListeningPort(100, 8080, join(proc, "nincs")),
      null,
    );
  });

  it(
    "on Linux the real kernel table agrees: this process owns a port it listens on, a child that never listens does not",
    { skip: process.platform !== "linux" },
    async () => {
      const server = createServer();
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const port = (server.address() as { port: number }).port;
      try {
        assert.equal(processOwnsListeningPort(process.pid, port), true);
        assert.equal(processOwnsListeningPort(process.ppid, port), false);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      assert.equal(processOwnsListeningPort(process.pid, port), false);
    },
  );

  it(
    "never asks /health, and never takes an answer, while the instance does not hold the port (a foreign process would give it)",
    { skip: process.platform !== "linux" },
    async () => {
      const silent = script(
        "never-listens.mjs",
        "setInterval(() => {}, 1000);\nprocess.on('SIGTERM', () => process.exit(0));\n",
      );
      let asked = 0;
      const checks = await runTrial({
        ...base,
        apiMain: silent,
        database: database(),
        healthTimeoutMs: 1_500,
        // a foreign process that answers at once, whatever is asked
        fetchImpl: (async () => {
          asked += 1;
          return new Response("{}", { status: 200 });
        }) as typeof fetch,
      });
      const api = checks.find((c) => c.name.startsWith("api:"))!;
      assert.equal(api.passed, false);
      assert.match(api.name, /did not answer \/health in time/);
      assert.equal(
        asked,
        0,
        "no /health request while the port is not the instance's",
      );
      assert.ok(!checks.some((c) => c.name.startsWith("login:")));
    },
  );

  it("reports an instance that never answers /health in time", async () => {
    const apiMain = script(
      "silent.mjs",
      "setInterval(() => {}, 1000);\nprocess.on('SIGTERM', () => process.exit(0));\n",
    );
    const checks = await runTrial({
      ...base,
      apiMain,
      database: database(),
      healthTimeoutMs: 1_500,
    });
    const api = checks.find((c) => c.name.startsWith("api:"))!;
    assert.equal(api.passed, false);
    assert.match(api.name, /did not answer \/health in time/);
  });

  it("stops without a login user: an active owner or admin that can log in must exist", async () => {
    const checks = await runTrial({
      ...base,
      apiMain: standIn("nologin"),
      database: database({ loginEmail: async () => null }),
    });
    assert.ok(checks.some((c) => !c.passed && c.name.startsWith("login:")));
    assert.equal(existsSync(join(dir, "nologin")), false);
  });

  it("gives the instance the stage environment and NOT the operator's: a live key in the shell does not reach it", async () => {
    const saved = process.env.UNAS_API_KEY;
    process.env.UNAS_API_KEY = "kulcs-ami-nem-mehet-1";
    try {
      const dump = join(dir, "env-dump.json");
      const apiMain = script(
        "env.mjs",
        `import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(dump)}, JSON.stringify(Object.keys(process.env).sort()));
createServer((req, res) => { res.statusCode = 200; res.end("{}"); }).listen(Number(process.env.PORT), "127.0.0.1");
process.on("SIGTERM", () => process.exit(0));
`,
      );
      await runTrial({
        ...base,
        apiMain,
        database: database(),
        healthTimeoutMs: 20_000,
      });
      const keys = JSON.parse(
        (await import("node:fs")).readFileSync(dump, "utf8"),
      ) as string[];
      assert.ok(!keys.includes("UNAS_API_KEY"));
      assert.ok(
        keys.includes("DATABASE_URL") && keys.includes("SZAMLAZZ_AGENT_MODE"),
      );
    } finally {
      if (saved === undefined) delete process.env.UNAS_API_KEY;
      else process.env.UNAS_API_KEY = saved;
    }
  });
});
