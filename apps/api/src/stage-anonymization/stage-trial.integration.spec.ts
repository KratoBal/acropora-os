import "reflect-metadata";

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import {
  assessTrialIntegrations,
  buildTrialEnvironment,
  createTrialDatabase,
  hashStagePassword,
  measureGeneratedClientEnvFiles,
  PrismaClient,
  runTrialFlows,
  withDatabaseName,
  withTrialCopy,
} from "@acropora/database/stage-anonymization";
import {
  integrationDatabaseGate,
  integrationDatabaseUrl,
} from "../common/integration-database.js";

/**
 * THE WORKING TRIAL ON A REAL APPLICATION AND A REAL POSTGRES (task stage-anonim-proba). The unit tests of the trial run against a
 * fake API that answers what the code was READ to answer; this is the one place the flows meet the real one: the real validation
 * (whitelist, forbidden extra fields), the real stub invoice, the real POS sale, work sheet and ticket, the real login with a stage
 * password hash, on a database with every real migration.
 *
 * WHAT RUNS: a scratch `stage_anon_tmp_ci_<random>` database on the CI Postgres, every real migration, one OWNER whose password is
 * the stage-only hash (`hashStagePassword`, the application's own scheme); a throwaway COPY of it (`withTrialCopy`, a real
 * `CREATE DATABASE ... TEMPLATE`), the environment the trial gives its instance (`buildTrialEnvironment`, put in place of this
 * process's environment), the real Nest application started IN THIS PROCESS on the copy (the trial command starts the built API as a
 * child process; the spawn is covered by the unit tests with real child processes), the integration measurement (12 checks, with the
 * real settings and device token queries), and the four flows. Then the copy is dropped, and the scratch database is checked to hold
 * NONE of the trial's rows: the swap candidate is never written to.
 *
 * THE APPLICATION IS LOADED AFTER THE ENVIRONMENT IS SET: the package's main entry makes its database client from DATABASE_URL when it
 * is first imported, so this spec imports it (through the application) only once the environment points at the copy. The
 * `stage-anonymization` entry used above does not load it.
 */

const run = promisify(execFile);
const gate = integrationDatabaseGate(process.env);
const SCRATCH = `stage_anon_tmp_ci_${randomBytes(4).toString("hex")}`;
const STAGE_PASSWORD = "stage-trial-jelszo-nem-igazi-1"; // scan-secrets: allow (an invented test string, not a credential)
const OWNER_EMAIL = "u7trialowner42@teszt.acropora.invalid";

describe(
  "Stage trial on the real application and a scratch Postgres database",
  { skip: gate.mode === "skip" },
  () => {
    let admin: PrismaClient;
    let baseUrl: string;
    let scratchUrl: string;
    const counts = async (url: string) => {
      const client = new PrismaClient({ datasources: { db: { url } } });
      try {
        return {
          customers: await client.customer.count(),
          invoices: await client.invoice.count(),
          jobs: await client.serviceJob.count(),
          worksheets: await client.worksheet.count(),
          orders: await client.salesOrder.count(),
        };
      } finally {
        await client.$disconnect();
      }
    };
    const databaseExists = async (name: string): Promise<boolean> => {
      const rows = await admin.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM pg_database WHERE datname = '${name}'`,
      );
      return (rows[0]?.n ?? 0) === 1;
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      baseUrl = integrationDatabaseUrl(process.env);
      admin = new PrismaClient();
      // the name is generated above from hex digits only, so it is safe as an identifier
      await admin.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH}"`);
      scratchUrl = withDatabaseName(baseUrl, SCRATCH);
      await run(
        "pnpm",
        [
          "--filter",
          "@acropora/database",
          "exec",
          "prisma",
          "migrate",
          "deploy",
        ],
        { env: { ...process.env, DATABASE_URL: scratchUrl } },
      );
      const scratch = new PrismaClient({
        datasources: { db: { url: scratchUrl } },
      });
      try {
        await scratch.user.create({
          data: {
            email: OWNER_EMAIL,
            displayName: "Teszt Tulajdonos",
            role: "OWNER",
            passwordHash: await hashStagePassword(STAGE_PASSWORD),
          },
        });
      } finally {
        // a database somebody is connected to cannot be copied
        await scratch.$disconnect();
      }
    });

    after(async () => {
      if (admin) {
        await admin.$executeRawUnsafe(
          `DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`,
        );
        await admin.$disconnect();
      }
    });

    it("runs the measurement and the four flows against the real application on a throwaway copy, and leaves the swap candidate untouched", async () => {
      const untouched = await counts(scratchUrl);
      let copyNameSeen = "";
      const saved = { ...process.env };
      let checks: { name: string; passed: boolean }[] = [];
      await withTrialCopy(admin, SCRATCH, async (copyName) => {
        copyNameSeen = copyName;
        assert.equal(
          await databaseExists(copyName),
          true,
          "the copy exists during the trial",
        );
        const copyUrl = withDatabaseName(baseUrl, copyName);
        const env = buildTrialEnvironment({
          databaseUrl: copyUrl,
          port: 3999,
          redisUrl: saved.REDIS_URL,
          path: saved.PATH,
        });
        // the environment of the instance: THIS process gets exactly what the trial would give its child
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, env);
        const reader = new PrismaClient({
          datasources: { db: { url: copyUrl } },
        });
        let app: Awaited<ReturnType<typeof boot>> | undefined;
        try {
          const trialDb = createTrialDatabase(reader);
          const measured = assessTrialIntegrations({
            env,
            settings: await trialDb.connectionSettings(),
            deviceTokens: await trialDb.deviceTokenCount(),
            loadedEnvFiles: measureGeneratedClientEnvFiles(import.meta.url),
          });
          assert.equal(await trialDb.loginEmail(), OWNER_EMAIL);
          app = await boot();
          const flows = await runTrialFlows({
            baseUrl: `http://127.0.0.1:${app.port}`,
            email: OWNER_EMAIL,
            password: STAGE_PASSWORD,
          });
          checks = [...measured, ...flows];
        } finally {
          if (app) await app.close();
          await reader.$disconnect();
          for (const key of Object.keys(process.env)) delete process.env[key];
          Object.assign(process.env, saved);
        }
      });

      // every check names itself, so a failure reads as WHAT broke (the names carry no value)
      assert.deepEqual(
        checks.filter((c) => !c.passed),
        [],
        `failed trial checks: ${JSON.stringify(checks.filter((c) => !c.passed))}`,
      );
      assert.equal(
        checks.filter((c) => c.name.startsWith("integration closed")).length,
        11,
      );
      assert.equal(checks.length, 12 + 9);
      assert.equal(
        await databaseExists(copyNameSeen),
        false,
        "the copy is dropped",
      );
      assert.deepEqual(
        await counts(scratchUrl),
        untouched,
        "the swap candidate holds none of the trial's rows",
      );
    });

    it("refuses to copy a database that is not a temporary one, and to name one as the copy", async () => {
      await assert.rejects(
        withTrialCopy(admin, "acropora_ci", async () => undefined),
        /temporary database/,
      );
      assert.equal(await databaseExists("acropora_ci"), true);
    });
  },
);

/** Starts the real application in this process, configured as `main.ts` configures it, on a free port. */
async function boot(): Promise<{ port: number; close(): Promise<void> }> {
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module.js");
  const { configureApp } = await import("../app.configuration.js");
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  return {
    port: address.port,
    close: async () => {
      await app.close();
      const { prisma } = await import("@acropora/database");
      await prisma.$disconnect();
    },
  };
}
