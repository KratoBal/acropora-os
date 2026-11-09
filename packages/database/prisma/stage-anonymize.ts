/// Command line for the stage anonymization run (chain slice S6; card 07b56a1f; runbook: docs/stage-anonymization.md).
///
/// Invoked by the stage operator, never by the API: `pnpm --filter @acropora/database stage:anonymize`. Everything comes from
/// the environment (no flags, no shell quoting):
///
///   DATABASE_URL                     the TEMPORARY database the dump was restored into (its name must be stage_anon_tmp_...)
///   STAGE_ANON_PSEUDONYM_KEY         at least 32 bytes; the fakes of this run
///   STAGE_ANON_SCAN_KEY              at least 32 bytes; the residual-scan dictionary key, for this run only
///   STAGE_ANON_PASSWORD_HASH         the hash of the stage-only password that replaces every password hash
///   STAGE_TRIAL_PASSWORD             the PLAIN stage password (the one STAGE_ANON_PASSWORD_HASH was made from). With it and no
///                                    STAGE_ANON_TRIAL_COMMAND, the built-in working trial runs (`stage:trial`).
///   STAGE_ANON_TRIAL_COMMAND         optional; a JSON array of strings (program and arguments) to run INSTEAD of the built-in trial,
///                                    WITHOUT a shell, after the transform and BEFORE any swap. It runs on a throwaway COPY of the
///                                    temporary database (made and dropped here), with a small environment: DATABASE_URL (the copy),
///                                    STAGE_TRIAL_PASSWORD, REDIS_URL, STAGE_TRIAL_API_MAIN, PATH, HOME. Its last stdout line must be
///                                    {"checks":[{"name":"...","passed":true}]} and its exit code 0; no trial, or no named check:
///                                    the gate fails.
///   STAGE_TRIAL_API_MAIN             optional; the built API entry point for the trial (default apps/api/dist/main.js)
///   REDIS_URL                        optional; the Redis the trial instance's health check pings
///
/// The run never swaps anything. It prints the gate report as JSON on stdout (counts and column names only, never a value) and
/// exits 0 only when the gate passed, so a host script can chain the swap on the exit code. Production and the stage database
/// are refused by the runner's name guard before a row is read.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import { ANONYMIZATION_REGISTER } from "../src/anonymization-register.js";
import type { RunnerOptions } from "../src/stage-anonymization/runner.js";
import {
  describeRunFailure,
  runStageAnonymization,
} from "../src/stage-anonymization/stage-run.js";
import { createTrialCommand } from "../src/stage-anonymization/trial-command.js";
import { withDatabaseName } from "../src/stage-anonymization/trial-environment.js";

const REQUIRED = [
  "DATABASE_URL",
  "STAGE_ANON_PSEUDONYM_KEY",
  "STAGE_ANON_SCAN_KEY",
  "STAGE_ANON_PASSWORD_HASH",
] as const;

function readEnvironment(): Record<(typeof REQUIRED)[number], string> {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`missing environment variable(s): ${missing.join(", ")}`);
    process.exit(2);
  }
  return Object.fromEntries(
    REQUIRED.map((name) => [name, process.env[name] as string]),
  ) as Record<(typeof REQUIRED)[number], string>;
}

/**
 * The trial command as an argument array: no shell, so nothing in it is interpreted. It runs on a throwaway COPY of the temporary
 * database, before any swap (see `createTrialCommand`), and reports its named checks as one JSON line on stdout (see
 * `parseTrialResult`); its progress goes to the terminal through stderr only, because stdout is where the result is read. The
 * default, when only STAGE_TRIAL_PASSWORD is set, is the built-in trial (`stage:trial`).
 */
function trialFromEnvironment(
  client: PrismaClient,
  databaseUrl: string,
): RunnerOptions["trial"] {
  const raw = process.env.STAGE_ANON_TRIAL_COMMAND;
  const password = process.env.STAGE_TRIAL_PASSWORD;
  let command: [string, ...string[]];
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      !parsed.every((part): part is string => typeof part === "string")
    ) {
      console.error("STAGE_ANON_TRIAL_COMMAND must be a JSON array of strings");
      process.exit(2);
    }
    command = parsed as [string, ...string[]];
  } else if (password) {
    command = ["pnpm", "--filter", "@acropora/database", "stage:trial"];
  } else {
    return undefined;
  }
  return createTrialCommand({
    databaseUrl,
    disconnect: () => client.$disconnect(),
    openAdmin: () =>
      new PrismaClient({
        datasources: { db: { url: withDatabaseName(databaseUrl, "postgres") } },
      }),
    command,
    password,
    redisUrl: process.env.REDIS_URL,
    apiMain: process.env.STAGE_TRIAL_API_MAIN,
    path: process.env.PATH,
    home: process.env.HOME,
  });
}

async function main(): Promise<void> {
  const env = readEnvironment();
  const schema = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "schema.prisma"),
    "utf8",
  );
  const client = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
  });
  try {
    const result = await runStageAnonymization({
      client,
      schema,
      register: ANONYMIZATION_REGISTER,
      pseudonymizationKey: env.STAGE_ANON_PSEUDONYM_KEY,
      scanKey: env.STAGE_ANON_SCAN_KEY,
      stagePasswordHash: env.STAGE_ANON_PASSWORD_HASH,
      trial: trialFromEnvironment(client, env.DATABASE_URL),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.swapAllowed ? 0 : 1;
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  // the runner's and the transformer's messages name fields and counts, never a value; a database error prints name and code only
  console.error(describeRunFailure(error));
  process.exit(3);
});
