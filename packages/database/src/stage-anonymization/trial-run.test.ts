import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { TrialDatabase } from "./trial-database.js";
import { freePort, runTrial } from "./trial-run.js";
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
