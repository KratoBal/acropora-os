import { spawn } from "node:child_process";

import type { RunnerOptions } from "./runner.js";
import type { SqlClient } from "./prisma-adapter.js";
import { withTrialCopy } from "./trial-copy.js";
import { databaseNameOfUrl, withDatabaseName } from "./trial-environment.js";
import { parseTrialResult } from "./trial-result.js";

/**
 * THE TRIAL COMMAND AS THE ANONYMIZATION COMMAND RUNS IT (task stage-anonim-proba). Before the trial command starts it:
 *   1. the command's own connections to the temporary database are CLOSED (Postgres will not copy a database somebody is connected
 *      to; the run needs nothing from it after this point: the trial is the last step before the gate's report);
 *   2. a throwaway COPY of the temporary database is made (`withTrialCopy`), and dropped afterwards, whatever the trial did;
 *   3. the trial command gets a SMALL environment: the copy as `DATABASE_URL`, the stage password, and what it needs to run. Not the
 *      operator's whole environment: that holds the pseudonymization key, the scan key and whatever else is in the shell, and the
 *      trial has no use for any of it.
 * The command is an argument array run WITHOUT a shell. Its last stdout line is its result (`parseTrialResult`).
 */
export interface TrialCommandInput {
  /** The connection string of the temporary database (the swap candidate). */
  readonly databaseUrl: string;
  /** Closes every connection the caller holds to the temporary database. */
  readonly disconnect: () => Promise<void>;
  /** A maintenance connection (to the server's `postgres` database) that can create and drop the copy. */
  readonly openAdmin: () => SqlClient & { $disconnect(): Promise<void> };
  /** The program and its arguments. */
  readonly command: readonly [string, ...string[]];
  readonly password?: string;
  readonly redisUrl?: string;
  readonly apiMain?: string;
  readonly path?: string;
  readonly home?: string;
  readonly spawnImpl?: typeof spawn;
}

export function createTrialCommand(
  input: TrialCommandInput,
): NonNullable<RunnerOptions["trial"]> {
  return async () => {
    await input.disconnect();
    const sourceName = databaseNameOfUrl(input.databaseUrl);
    if (sourceName === null)
      return {
        passed: false,
        checks: [
          { name: "trial: the database URL names no database", passed: false },
        ],
      };
    const admin = input.openAdmin();
    try {
      return await withTrialCopy(admin, sourceName, async (copyName) => {
        const env: Record<string, string> = {
          DATABASE_URL: withDatabaseName(input.databaseUrl, copyName),
        };
        if (input.path !== undefined) env.PATH = input.path;
        if (input.home !== undefined) env.HOME = input.home;
        if (input.password !== undefined)
          env.STAGE_TRIAL_PASSWORD = input.password;
        if (input.redisUrl !== undefined) env.REDIS_URL = input.redisUrl;
        if (input.apiMain !== undefined)
          env.STAGE_TRIAL_API_MAIN = input.apiMain;
        const [program, ...args] = input.command;
        return await new Promise<ReturnType<typeof parseTrialResult>>(
          (resolve) => {
            const child = (input.spawnImpl ?? spawn)(program, args, {
              env,
              stdio: ["ignore", "pipe", "inherit"],
            });
            let stdout = "";
            child.stdout?.on("data", (chunk: Buffer) => {
              stdout += chunk.toString("utf8");
            });
            child.on("error", () => resolve({ passed: false, checks: [] }));
            child.on("close", (code) =>
              resolve(parseTrialResult(stdout, code)),
            );
          },
        );
      });
    } catch (error) {
      // only our own message (the copy could not be made); a database error is never printed (it can carry a value)
      const message =
        error instanceof Error && error.message.startsWith("the trial copy")
          ? error.message
          : "the trial could not be run";
      return {
        passed: false,
        checks: [{ name: `trial: ${message}`, passed: false }],
      };
    } finally {
      await admin.$disconnect();
    }
  };
}
