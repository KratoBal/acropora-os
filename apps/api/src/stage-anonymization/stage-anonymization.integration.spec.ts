import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { PrismaClient } from "@acropora/database";
import {
  ANONYMIZATION_REGISTER,
  runStageAnonymization,
} from "@acropora/database/stage-anonymization";
import {
  integrationDatabaseGate,
  integrationDatabaseUrl,
} from "../common/integration-database.js";

/**
 * THE STAGE ANONYMIZATION RUN ON A REAL POSTGRES (chain slice S6; card 07b56a1f). It is the only place the Postgres adapter's SQL
 * runs against a real server: the unit tests of the adapter cover the SQL text, not what Postgres does with it.
 *
 * THE DATABASE IS A SCRATCH ONE, created and dropped by this spec: `stage_anon_tmp_ci_<random>` on the CI Postgres service, with
 * every real migration applied (`prisma migrate deploy`), so the schema the run reads is the real one (all models, the generated
 * columns, the enums). The rows are SYNTHETIC (invented names, `.invalid` addresses). Nothing here touches production or the
 * stage database: the CI connection string is gated by `integrationDatabaseGate`, and the runner's own name guard refuses any
 * database that is not a `stage_anon_tmp_...` one (the last test aims the run at the CI database itself and expects the refusal).
 */

const run = promisify(execFile);
const gate = integrationDatabaseGate(process.env);
const SCRATCH = `stage_anon_tmp_ci_${randomBytes(4).toString("hex")}`;
const REAL = {
  email: "kovacs.bela.valodi@example.invalid",
  name: "Kovacs Bela Valodi",
  phone: "+36301234567",
  password: "valodi-jelszo-lenyomat-nem-igazi",
};

const withDatabase = (url: string, database: string): string => {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
};

describe(
  "Stage anonymization run on a scratch Postgres database",
  { skip: gate.mode === "skip" },
  () => {
    let admin: PrismaClient;
    let scratch: PrismaClient;
    let scratchUrl: string;
    let schema: string;
    let result: Awaited<ReturnType<typeof runStageAnonymization>>;
    const keys = {
      pseudonymizationKey: randomBytes(32).toString("hex"),
      scanKey: randomBytes(32).toString("hex"),
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      const baseUrl = integrationDatabaseUrl(process.env);
      schema = readFileSync(
        join(
          process.cwd(),
          "..",
          "..",
          "packages",
          "database",
          "prisma",
          "schema.prisma",
        ),
        "utf8",
      );
      admin = new PrismaClient();
      // the name is generated above from hex digits only, so it is safe as an identifier
      await admin.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH}"`);
      scratchUrl = withDatabase(baseUrl, SCRATCH);
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
      scratch = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
      await scratch.user.create({
        data: {
          email: REAL.email,
          displayName: REAL.name,
          role: "ADMIN",
          passwordHash: REAL.password,
        },
      });
      await scratch.customer.create({
        data: {
          customerNumber: "VEVO-T1",
          type: "PERSON",
          displayName: REAL.name,
          email: REAL.email.replace("kovacs", "vevo"),
          phone: REAL.phone,
        },
      });
      await scratch.customer.create({
        data: {
          customerNumber: "VEVO-T2",
          type: "COMPANY",
          displayName: "Teszt Kft",
          companyName: "Teszt Kft",
          taxNumber: "12345678-2-42",
        },
      });
    });

    after(async () => {
      await scratch?.$disconnect();
      if (admin) {
        await admin.$executeRawUnsafe(
          `DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`,
        );
        await admin.$disconnect();
      }
    });

    it("runs over every table of the real schema, and every section of the gate is measured and passes", async () => {
      result = await runStageAnonymization({
        client: scratch,
        schema,
        register: ANONYMIZATION_REGISTER,
        stagePasswordHash: "stage-only-hash-nem-igazi",
        trial: async () => ({ passed: true }),
        ...keys,
      });
      // the sections name tables, columns and counts only, so the report is safe to print on a failure
      const failed = result.report.sections.filter((s) => !s.passed);
      assert.deepEqual(
        failed,
        [],
        `failed gate sections: ${JSON.stringify(failed)}`,
      );
      assert.equal(result.swapAllowed, true);
      assert.ok(result.rowsTransformed >= 3, "the seeded rows were rewritten");
    });

    it("leaves none of the invented personal values in the scratch database, and keeps the row counts", async () => {
      const users = await scratch.user.findMany();
      const customers = await scratch.customer.findMany();
      assert.equal(users.length, 1);
      assert.equal(customers.length, 2);
      const text = JSON.stringify([users, customers]);
      for (const value of [REAL.email, REAL.name, REAL.phone, REAL.password])
        assert.ok(!text.includes(value), "a real value survived the run");
      assert.equal(users[0]?.passwordHash, "stage-only-hash-nem-igazi");
    });

    it("refuses a database that is not a temporary one, before it reads a row", async () => {
      const usersBefore = await admin.user.count();
      await assert.rejects(
        runStageAnonymization({
          client: admin,
          schema,
          register: ANONYMIZATION_REGISTER,
          stagePasswordHash: "stage-only-hash-nem-igazi",
          trial: async () => ({ passed: true }),
          ...keys,
        }),
        /temporary database/,
      );
      assert.equal(await admin.user.count(), usersBefore);
    });
  },
);
