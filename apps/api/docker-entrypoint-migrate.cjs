#!/usr/bin/env node
"use strict";

/**
 * Resolves the Prisma CLI and schema.prisma inside the deployed production
 * tree (this file's own directory, i.e. wherever the "runner" stage's
 * WORKDIR is), then runs `prisma migrate deploy` against them.
 *
 * Path resolution deliberately does NOT hardcode any node_modules/.pnpm/...
 * path: pnpm's virtual-store directory names are version-string-derived and
 * not guaranteed stable across dependency bumps. Instead this mirrors the
 * pattern already used in apps/api/Dockerfile for copying the generated
 * `.prisma/client` directory: `fs.realpathSync` the anchor package.json
 * (following the `node_modules/@acropora/database` symlink to its real,
 * physical location in the pnpm store) and then use `createRequire` from
 * there so Node's own module resolution algorithm - not shell-script
 * relative-path arithmetic - finds the actual files. (A pnpm .bin/prisma
 * shell shim was tried first and rejected: its relative-path math is baked
 * in relative to the shim file's *real* physical location, so invoking it
 * through the node_modules/@acropora/database symlink resolves to a wrong,
 * nonexistent path - reproduced directly, see the modification plan.)
 *
 * Modes (first CLI arg):
 *   --check   Resolve-only. No DATABASE_URL needed, touches no database.
 *             Confirms the CLI entry point, schema.prisma, and the
 *             migrations directory all exist inside this image.
 *   --status  Runs `prisma migrate status` (read-only). Needs a reachable
 *             DATABASE_URL. Safe to run against a real (e.g. staging)
 *             database - never mutates it.
 *   (none)    Runs `prisma migrate deploy` (the real gate used by
 *             docker-entrypoint.sh before the API starts). Needs a
 *             reachable DATABASE_URL. Applies pending migrations, then the
 *             ReefClub role's rights (below).
 *
 * THE REEFCLUB ROLE'S RIGHTS FOLLOW THE MIGRATIONS (card 4f0ad1be). The
 * ReefClub process connects with its own role, `reefclub_app`, which may use
 * only what `packages/database/sql/reefclub-role.sql` grants. That file was
 * applied by hand after a migration, so a new ReefClub table reached the
 * stage without its grant, and the ReefClub answered 500 until someone ran
 * a GRANT (2026-11-11, ReefClubCustomerCandidate). Now, after every
 * successful `migrate deploy`, the same file runs here (`prisma db execute`),
 * with the API's own connection, on every start:
 *
 *   - only where the role exists: creating it (its password is a secret of
 *     the environment) stays a one-time step, and a database without the
 *     ReefClub is left alone, with a line saying so;
 *   - the file is idempotent (it revokes, then grants its list) and runs as
 *     ONE transaction: a failure anywhere leaves the rights it found
 *     (measured 2026-11-11 on PostgreSQL 17: a run that fails on its last
 *     statement keeps an earlier grant the file's first REVOKE would remove);
 *   - a failure does NOT stop the internal API (fail open, unlike the
 *     migrations): the grants are the ReefClub process's, a separate
 *     container, and the rights already in place stay. It is an `ERROR` line
 *     naming the manual command. The file needs a superuser (its definer
 *     part, see the file): a connection that is not one fails here, loudly,
 *     and nothing changes;
 *   - it never holds the start for long (barracuda, #2437): the file waits at
 *     most 5 s for a table lock (`lock_timeout`, its policy statements lock
 *     the aquarium tables), and the run is cut after 60 s. Either is the same
 *     ERROR line; the next start tries again.
 *
 * NOT ALTER DEFAULT PRIVILEGES: that would give the role every new table,
 * and the point of the role is that it cannot read invoices, worksheets or
 * a customer's phone and e-mail. The file stays the one list of its rights.
 */

const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const mode =
  process.argv[2] === "--check" || process.argv[2] === "--status"
    ? process.argv[2]
    : undefined;

function resolvePrismaPaths() {
  const dbPackageJson = path.join(
    __dirname,
    "node_modules",
    "@acropora",
    "database",
    "package.json",
  );
  if (!fs.existsSync(dbPackageJson)) {
    throw new Error(
      `@acropora/database package.json not found at ${dbPackageJson} - ` +
        "is this running from the deployed production image's root?",
    );
  }
  const realAnchor = fs.realpathSync(dbPackageJson);
  const req = createRequire(realAnchor);

  const cliEntry = req.resolve("prisma/build/index.js");
  const schemaPath = req.resolve("./prisma/schema.prisma");
  const migrationsDir = path.join(path.dirname(schemaPath), "migrations");

  if (!fs.existsSync(cliEntry)) {
    throw new Error(
      `Prisma CLI entry resolved to ${cliEntry} but that file does not exist. ` +
        'Was "prisma" moved out of packages/database/package.json\'s dependencies?',
    );
  }
  if (!fs.existsSync(schemaPath)) {
    throw new Error(
      `schema.prisma resolved to ${schemaPath} but does not exist.`,
    );
  }
  if (
    !fs.existsSync(migrationsDir) ||
    fs.readdirSync(migrationsDir).length === 0
  ) {
    throw new Error(
      `migrations directory missing or empty at ${migrationsDir}`,
    );
  }

  const reefclubRoleSql = path.join(
    path.dirname(path.dirname(schemaPath)),
    "sql",
    "reefclub-role.sql",
  );
  // Not thrown here: a missing file must not keep the internal API from
  // starting (see the header). --check stops on it, the image build too.

  return { req, cliEntry, schemaPath, migrationsDir, reefclubRoleSql };
}

const REEFCLUB_ROLE = "reefclub_app";

/**
 * The second line against a wait (barracuda, #2437): the file sets a 5 s
 * `lock_timeout` itself; this cuts the run if anything else hangs, so the
 * internal API's start is never held for long by the ReefClub's grants.
 */
const REEFCLUB_ROLE_TIMEOUT_MS = 60_000;

/** Whether the ReefClub role exists in the database DATABASE_URL names. */
async function reefclubRolePresent(req) {
  const { PrismaClient } = req("@prisma/client");
  const client = new PrismaClient();
  try {
    const rows =
      await client.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${REEFCLUB_ROLE}) AS "present"`;
    return rows[0]?.present === true;
  } finally {
    await client.$disconnect();
  }
}

/**
 * The ReefClub role's rights after the migrations (see the header). The two
 * steps come in (`execute` answers `{ status, timedOut }`), so the decision is tested without a database
 * (docker-entrypoint-migrate.spec.ts). Never throws: the outcome is returned
 * and said on the log.
 */
async function applyReefclubRole({ rolePresent, execute, log, error }) {
  const manual = `psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f packages/database/sql/reefclub-role.sql`;
  let present;
  try {
    present = await rolePresent();
  } catch (cause) {
    error(
      `ERROR reefclub-role: could not ask whether the ${REEFCLUB_ROLE} role exists (${cause instanceof Error ? cause.message : String(cause)}); its rights were NOT refreshed. By hand, as a superuser: ${manual}`,
    );
    return "error";
  }
  if (!present) {
    log(
      `reefclub-role: no ${REEFCLUB_ROLE} role in this database; reefclub-role.sql skipped (the ReefClub is not set up here).`,
    );
    return "skipped";
  }
  const { status, timedOut } = execute();
  if (timedOut || status !== 0) {
    const what = timedOut
      ? `did not finish in ${REEFCLUB_ROLE_TIMEOUT_MS / 1000} s and was stopped`
      : `failed (exit ${status}; a lock not granted in 5 s is this too)`;
    error(
      `ERROR reefclub-role: reefclub-role.sql ${what}; it runs as one transaction, so the ${REEFCLUB_ROLE} role keeps the rights it had, and the next start tries again. The ReefClub process may lack a right a new table needs. By hand, as a superuser: ${manual}`,
    );
    return "error";
  }
  log(`reefclub-role: reefclub-role.sql applied to ${REEFCLUB_ROLE}.`);
  return "applied";
}

async function main() {
  const { req, cliEntry, schemaPath, migrationsDir, reefclubRoleSql } =
    resolvePrismaPaths();
  const migrationCount = fs
    .readdirSync(migrationsDir)
    .filter((entry) =>
      fs.statSync(path.join(migrationsDir, entry)).isDirectory(),
    ).length;

  console.log("Resolved Prisma CLI:", cliEntry);
  console.log("Resolved schema.prisma:", schemaPath);
  console.log(
    `Resolved migrations directory (${migrationCount} migrations):`,
    migrationsDir,
  );
  console.log("Resolved reefclub-role.sql:", reefclubRoleSql);
  const reefclubRoleSqlPresent = fs.existsSync(reefclubRoleSql);

  if (mode === "--check") {
    if (!reefclubRoleSqlPresent) {
      console.error(
        `reefclub-role.sql resolved to ${reefclubRoleSql} but does not exist.`,
      );
      process.exit(1);
    }
    console.log(
      "OK: CLI, schema, migrations and reefclub-role.sql all resolve inside this image. No database was contacted.",
    );
    process.exit(0);
  }

  const prismaArgs =
    mode === "--status"
      ? ["migrate", "status", `--schema=${schemaPath}`]
      : ["migrate", "deploy", `--schema=${schemaPath}`];

  console.log(`Running: prisma ${prismaArgs.join(" ")}`);
  const result = spawnSync(process.execPath, [cliEntry, ...prismaArgs], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error("Failed to launch the Prisma CLI:", result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `prisma ${prismaArgs[0]} ${prismaArgs[1]} exited with code ${result.status}`,
    );
    process.exit(result.status ?? 1);
  }
  console.log(
    mode === "--status"
      ? "Migration status check completed."
      : "Migrations applied successfully.",
  );
  if (mode === "--status") return;

  await applyReefclubRole({
    rolePresent: () => reefclubRolePresent(req),
    execute: () => {
      if (!reefclubRoleSqlPresent) {
        console.error(`reefclub-role.sql missing at ${reefclubRoleSql}.`);
        return { status: 2, timedOut: false };
      }
      const run = spawnSync(
        process.execPath,
        [
          cliEntry,
          "db",
          "execute",
          "--file",
          reefclubRoleSql,
          "--schema",
          schemaPath,
        ],
        {
          stdio: "inherit",
          env: process.env,
          timeout: REEFCLUB_ROLE_TIMEOUT_MS,
        },
      );
      const timedOut = run.error?.code === "ETIMEDOUT";
      return { status: run.error ? 1 : (run.status ?? 1), timedOut };
    },
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}

module.exports = { applyReefclubRole };

if (require.main === module) {
  main().catch((cause) => {
    console.error(cause);
    process.exit(1);
  });
}
