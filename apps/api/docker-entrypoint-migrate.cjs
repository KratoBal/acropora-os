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
 *             reachable DATABASE_URL. Applies pending migrations.
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
    throw new Error(`schema.prisma resolved to ${schemaPath} but does not exist.`);
  }
  if (!fs.existsSync(migrationsDir) || fs.readdirSync(migrationsDir).length === 0) {
    throw new Error(`migrations directory missing or empty at ${migrationsDir}`);
  }

  return { cliEntry, schemaPath, migrationsDir };
}

function main() {
  const { cliEntry, schemaPath, migrationsDir } = resolvePrismaPaths();
  const migrationCount = fs
    .readdirSync(migrationsDir)
    .filter((entry) => fs.statSync(path.join(migrationsDir, entry)).isDirectory()).length;

  console.log("Resolved Prisma CLI:", cliEntry);
  console.log("Resolved schema.prisma:", schemaPath);
  console.log(`Resolved migrations directory (${migrationCount} migrations):`, migrationsDir);

  if (mode === "--check") {
    console.log(
      "OK: CLI, schema and migrations all resolve inside this image. No database was contacted.",
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
    console.error(`prisma ${prismaArgs[0]} ${prismaArgs[1]} exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
  console.log(
    mode === "--status" ? "Migration status check completed." : "Migrations applied successfully.",
  );
}

main();
