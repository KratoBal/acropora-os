/// The working trial (task stage-anonim-proba; runbook: docs/stage-anonymization.md). Run by the anonymization command, as its
/// STAGE_ANON_TRIAL_COMMAND (the default when STAGE_TRIAL_PASSWORD is set), against a throwaway COPY of the temporary database,
/// BEFORE any swap: `pnpm --filter @acropora/database stage:trial`.
///
/// It measures first that no external integration of the instance can reach a live third party (and stops, naming the integration,
/// if one can), then starts the API on the copy and runs a stub invoice, an order, a work sheet and a ticket as an owner or admin who
/// logs in with the stage password. Progress goes to stderr; the LAST line of stdout is the result the gate reads:
///   {"checks":[{"name":"...","passed":true}, ...]}
/// and the exit code is 0 only when every check passed.
///
/// Environment (the anonymization command passes only these to it, not its own whole environment):
///   DATABASE_URL            the trial COPY (its name must be stage_anon_tmp_...)
///   STAGE_TRIAL_PASSWORD    the plain stage password the owner hands out (the one STAGE_ANON_PASSWORD_HASH was made from)
///   STAGE_TRIAL_API_MAIN    optional; the built API entry point, default apps/api/dist/main.js in this repository
///   REDIS_URL               optional; the Redis the API's health check pings
///   PATH                    so the API process can find what it needs
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import { describeRunFailure } from "../src/stage-anonymization/stage-run.js";
import { createTrialDatabase } from "../src/stage-anonymization/trial-database.js";
import { runTrial } from "../src/stage-anonymization/trial-run.js";
import type { TrialCheck } from "../src/stage-anonymization/verification-gate.js";

const finish = (checks: TrialCheck[]): never => {
  console.log(JSON.stringify({ checks }));
  process.exit(
    checks.length > 0 && checks.every((check) => check.passed) ? 0 : 1,
  );
};

const databaseUrl = process.env.DATABASE_URL;
const password = process.env.STAGE_TRIAL_PASSWORD;
if (!databaseUrl || !password)
  finish([
    {
      name: "trial: DATABASE_URL and STAGE_TRIAL_PASSWORD must both be set",
      passed: false,
    },
  ]);

const apiMain =
  process.env.STAGE_TRIAL_API_MAIN ??
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../apps/api/dist/main.js",
  );
const client = new PrismaClient({
  datasources: { db: { url: databaseUrl as string } },
});
let checks: TrialCheck[];
try {
  checks = await runTrial({
    databaseUrl: databaseUrl as string,
    password: password as string,
    apiMain,
    database: createTrialDatabase(client),
    redisUrl: process.env.REDIS_URL,
    path: process.env.PATH,
    progress: (line) => console.error(`trial: ${line}`),
  });
} catch (error) {
  checks = [
    {
      name: `trial: it could not run (${describeRunFailure(error)})`,
      passed: false,
    },
  ];
} finally {
  await client.$disconnect();
}
finish(checks);
