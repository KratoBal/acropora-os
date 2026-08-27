# syntax=docker/dockerfile:1.7
#
# Acropora OS — API (NestJS) production image.
#
# Build context is the REPOSITORY ROOT (this is a pnpm/Turborepo monorepo):
#   docker build -f apps/api/Dockerfile -t acropora-api .
#
# Strategy
# --------
# 1. `turbo prune` extracts only the workspace packages @acropora/api
#    actually depends on (so apps/web and its dependencies never enter this
#    image, and unrelated changes elsewhere in the monorepo don't bust the
#    dependency-install cache layer).
# 2. A single `pnpm install` brings in both prod and dev dependencies, since
#    the NestJS CLI, TypeScript and the Prisma CLI (all devDependencies) are
#    needed to build and to run `prisma generate`.
# 3. `pnpm --filter @acropora/api deploy --prod` (pnpm's own workspace-aware
#    deploy command, see the "deployed" stage below) then produces a
#    self-contained, portable production directory for @acropora/api alone,
#    followed by copying the already-generated Prisma Client from this
#    builder stage directly into that directory (deploy does not carry
#    forward Prisma's generated artifacts — see the "deployed" stage for
#    why and how this was verified).
#
#    This replaced an earlier `pnpm prune --prod` (stripping devDependencies
#    out of the built tree in place) after that approach was found, in
#    production, to produce a runtime image missing direct dependencies
#    (reflect-metadata, @nestjs/core) with an ERR_MODULE_NOT_FOUND at
#    startup. Reproduced directly outside Docker: `pnpm prune --prod
#    --config.confirmModulesPurge=false`, run at this pruned workspace's
#    root, left node_modules for the root, apps/api and packages/database
#    all effectively empty instead of correctly re-resolving a
#    production-only tree. `pnpm deploy` is pnpm's supported alternative for
#    exactly this — producing a correct, portable production directory for
#    one workspace project — and does not exhibit this failure (verified
#    the same way). See the "deployed" stage below for the config it needs.
# 4. The runtime stage copies the deployed directory as-is, adds
#    docker-entrypoint.sh (which runs `prisma migrate deploy` and refuses
#    to start the API if it fails — see that file and the "runner" stage
#    below), and runs as a non-root user.

ARG NODE_VERSION=22.23.1
ARG PNPM_VERSION=10.34.5
# Keep in sync with the "turbo" devDependency version in the root package.json.
ARG TURBO_VERSION=2.10.5
# Checkpoint 8: the exact commit this image was built from, meant to be
# passed as `--build-arg RELEASE_COMMIT_SHA=$(git rev-parse HEAD)` (in CI:
# `${{ github.sha }}` - see .github/workflows/ci.yml's docker-build-scan
# job). Deliberately has NO default here: an image built without this arg
# ends up with RELEASE_COMMIT_SHA unset in the running container, which
# apps/api/src/common/release-info.util.ts::currentReleaseCommitSha()
# then correctly reports as null, keeping /health/inventory/
# activation-readiness's concurrencyTestEvidence at NOT_CONFIGURED rather
# than silently matching some placeholder value. This is validated for
# well-formedness (not merely "non-empty") below, in the runner stage,
# so a malformed value fails the BUILD rather than silently producing a
# container that can never match any real evidence row without an
# obvious signal why.
ARG RELEASE_COMMIT_SHA=""

FROM node:${NODE_VERSION}-alpine AS base
# openssl: required by Prisma's query engine on Alpine (musl).
# libc6-compat: covers native addons that expect glibc-shaped symbols.
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
# pnpm 10+ prompts for confirmation before removing/recreating node_modules
# in various non-interactive scenarios, and aborts immediately with
# ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY when no TTY is attached, which
# is always the case in a Docker build. CI=true is pnpm's documented signal
# to skip that interactive prompt; set once here so it applies to every
# pnpm invocation in every stage derived from this one.
ENV CI=true

# -----------------------------------------------------------------------------
# 1. Prune: reduce the monorepo to only what @acropora/api needs.
# -----------------------------------------------------------------------------
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @acropora/api --docker

# -----------------------------------------------------------------------------
# 2. Build: install, compile, generate Prisma client.
#
#    This stage is also usable directly as a one-off "migrator" image (it
#    still has the Prisma CLI, the migrations folder and a generated
#    client), useful for running a migration manually, out of band, without
#    starting the API at all:
#
#      docker build -f apps/api/Dockerfile --target builder -t acropora-api:migrate .
#      docker run --rm --env DATABASE_URL=... acropora-api:migrate \
#        pnpm --filter @acropora/database exec prisma migrate deploy
#
#    This is NOT the only place migrations run anymore, and is no longer
#    required for a normal deploy to be safe. The `runner` stage below (the
#    actual image that serves traffic) now carries its own copy of the
#    Prisma CLI, schema.prisma and migrations/, and its
#    docker-entrypoint.sh runs `prisma migrate deploy` itself, gating
#    `node dist/main.js` on it succeeding — see that file. That change
#    exists specifically so migration-before-boot is a property of the
#    container image itself, not something that also depends on a
#    separately configured, external Coolify pre-deployment command
#    continuing to exist and stay correctly wired up (see
#    docs/DEPLOYMENT.md Section 5 and docs/COOLIFY.md for how the two are
#    meant to fit together now — the pre-deployment command is still fine
#    to keep as an extra, earlier gate, but the entrypoint is the one that
#    always runs). Never `migrate dev` or `db push` against production,
#    from either place.
# -----------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

# Dependency-only layer first: only invalidates when a manifest or the
# lockfile actually changes, not on every source edit.
COPY --from=pruner /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=acropora-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Bring in the real source and build. `turbo run build` has no explicit
# --filter here on purpose: the pruned workspace already contains only
# @acropora/api and the internal packages it depends on (database, types,
# config), so an unfiltered build compiles exactly that set, in the correct
# dependency order (turbo.json's "build" task depends on "^build").
COPY --from=pruner /app/out/full/ .

# Generate the Prisma Client here, explicitly, OUTSIDE Turbo's task graph —
# never let it be gated by the `/app/.turbo` cache mount above.
#
# @acropora/database's own "build" script is `prisma generate && tsc`, run
# by Turbo as the "^build" dependency of @acropora/api's build. Turbo's task
# cache only records whether that task *ran* and replays its declared
# `outputs` (dist/**) on a hit — it has no notion of `.prisma/client`, which
# `prisma generate` writes into pnpm's node_modules structure, outside any
# package's own directory entirely. Because `/app/.turbo` is a persistent
# BuildKit cache mount shared across builds, a cache hit for
# @acropora/database#build on a later build means `prisma generate` never
# actually executes against *this* build's freshly-installed node_modules —
# even though Turbo's log reports the task as successful — leaving
# @prisma/client's generated `.prisma/client` directory missing. That
# surfaces downstream as apps/api's own tsc pass failing with dozens of
# "Module '@prisma/client' has no exported member 'PrismaClient'"-style
# errors, since apps/api type-checks against @acropora/database's *source*
# (its package.json "types" condition points at src/index.ts, not a
# generated .d.ts), which itself imports the real generated Prisma types.
#
# Running generation here, unconditionally, before Turbo ever touches the
# cache mount, guarantees the client physically exists in this build's
# node_modules regardless of Turbo's cache state. It's left in place inside
# @acropora/database's own build script too (so `turbo run build` still
# works correctly in isolation, e.g. outside Docker) — running it twice is
# idempotent and cheap.
RUN pnpm --filter @acropora/database exec prisma generate

# Fail fast, right here, if generation didn't actually produce a loadable
# client — instead of discovering it forty tsc errors later. Run from
# @acropora/database's own directory, the same place its compiled code
# resolves `@prisma/client` from, so this exercises the real resolution
# path rather than some other node_modules copy.
WORKDIR /app/packages/database
RUN node --input-type=module -e "import { PrismaClient } from '@prisma/client'; const client = new PrismaClient(); await client.\$disconnect(); console.log('Prisma Client generated and loadable OK (builder stage, pre-turbo-build)');"
WORKDIR /app

RUN --mount=type=cache,id=acropora-api-turbo-cache,target=/app/.turbo \
    pnpm turbo run build

# -----------------------------------------------------------------------------
# 3. Deploy: produce a self-contained, portable production directory for
#    @acropora/api using `pnpm deploy`, pnpm's own workspace-aware command
#    for exactly this purpose.
#
#    Done as its own stage (rather than mutating `builder`) so `builder`
#    stays available, unmodified, as the migrator image described above.
#
#    Requires `inject-workspace-packages=true` in the repo's root .npmrc
#    (present in this pruned workspace via `out/json`/`out/full` above, and
#    baked into pnpm-lock.yaml's own `settings:` block so `--frozen-lockfile`
#    installs keep working) so that internal workspace packages
#    (@acropora/database, @acropora/types) are copied into the deploy
#    output as real files rather than symlinks back into the monorepo —
#    symlinks that wouldn't resolve to anything once copied into the
#    `runner` stage below, since the monorepo they point into doesn't exist
#    there.
# -----------------------------------------------------------------------------
FROM builder AS deployed
RUN pnpm --filter @acropora/api deploy /app/deploy --prod

# `pnpm deploy` reconstructs @acropora/api's production node_modules from
# pnpm's own content-addressable store, which holds each dependency's
# pristine, as-published contents only. Prisma's generated client (the
# schema-specific code, plus the query engine binary, written into a
# `.prisma/client` directory that lives alongside wherever `@prisma/client`
# resolves) is produced by running `prisma generate` — a mutation applied
# to a project's on-disk copy AFTER install, never folded back into that
# shared store. Verified directly (outside this Docker build, same pnpm
# version): manually placing a `.prisma/client` marker file next to the
# builder stage's own resolved `@prisma/client`, then running `pnpm
# --filter @acropora/api deploy` again, shows the marker does not appear
# anywhere in the deploy output — confirming `pnpm deploy` genuinely does
# not carry forward Prisma's generated artifacts. The deploy output
# therefore ships a pristine, ungenerated `@prisma/client`, which is
# exactly what produced `SyntaxError: Named export 'PrismaClient' not
# found` at runtime: @prisma/client's own entrypoint does
# `require('.prisma/client/default')`, and that directory doesn't exist.
#
# Fix, take 2: an earlier version of this stage tried re-running
# `prisma generate` with the working directory set to the deployed
# @acropora/database directory, on the theory that Prisma would
# auto-discover the deployed prisma.config.ts/schema.prisma and therefore
# target the deployed tree's own @prisma/client. That theory was
# confirmed *half* right (the config/schema really were picked up from
# the deployed path) but real CI runs kept producing the exact same
# runtime SyntaxError afterwards regardless — meaning `prisma generate`'s
# actual client-output resolution does not reliably follow the same
# schema-relative path in this setup, and re-invoking the CLI a second
# time was never a fully verifiable fix in this sandbox to begin with
# (no network route to binaries.prisma.sh here, so it could only be
# confirmed up to the point the config loaded, not that generation
# completed correctly).
#
# This replacement does not re-run `prisma generate` (and does not need
# network access) at all. It takes the client the builder stage already
# generated successfully — proven working, since migrations already run
# from this exact builder image — and copies its generated `.prisma/client`
# directory directly into the exact location the DEPLOYED @acropora/database
# will resolve `@prisma/client` from. That target location is computed with
# Node's own module resolution (`createRequire(...).resolve('@prisma/client')`,
# after `fs.realpathSync` on the deployed package's symlink — resolving
# through the symlink first turned out to matter: without it, `createRequire`
# does not reliably walk the same directory chain Node's own ESM resolver
# uses), so it can't drift from wherever the actual code will look, and
# does not depend on any assumption about `prisma generate`'s own internal
# behavior. Verified directly, end to end, outside Docker: constructing a
# PrismaClient from the deployed tree fails with the exact reported
# SyntaxError beforehand, and succeeds immediately after this copy.
RUN node -e "const { createRequire } = require('node:module'); const path = require('node:path'); const fs = require('node:fs'); function dotPrismaClientDir(anchorPackageJson) { const realAnchor = fs.realpathSync(anchorPackageJson); const req = createRequire(realAnchor); const clientEntry = req.resolve('@prisma/client'); const nodeModulesDir = path.dirname(path.dirname(path.dirname(clientEntry))); return path.join(nodeModulesDir, '.prisma', 'client'); } const builderDotPrisma = dotPrismaClientDir('/app/packages/database/package.json'); const deployedDotPrisma = dotPrismaClientDir('/app/deploy/node_modules/@acropora/database/package.json'); if (!fs.existsSync(builderDotPrisma)) { throw new Error('builder .prisma/client not found at ' + builderDotPrisma + ' -- was prisma generate run in the builder stage?'); } fs.rmSync(deployedDotPrisma, { recursive: true, force: true }); fs.cpSync(builderDotPrisma, deployedDotPrisma, { recursive: true }); console.log('Copied generated Prisma Client:', builderDotPrisma, '->', deployedDotPrisma);"

# Fail the build here, not at container startup, if the deployed production
# tree is missing something the app imports, or if the Prisma Client copy
# step above didn't actually produce a loadable client. Run from the
# same working directory the runner stage actually executes
# `node dist/main.js` from.
#
# reflect-metadata / @nestjs/core / @nestjs/platform-express have no
# meaningful import-time side effects, so a real `import()` is a fine,
# simple check. @acropora/database itself is deliberately NOT import()'d:
# its entrypoint eagerly constructs a PrismaClient, so this only resolves
# it and confirms the resolved file exists on disk, without evaluating
# the module body. @prisma/client's PrismaClient, on the other hand, IS
# constructed below — that's the actual regression class this stage
# exists to catch, so it needs a real construction, not just a resolve —
# run from the same directory @acropora/database's own compiled code
# resolves @prisma/client from, i.e. the same resolution context the app
# uses at runtime. Constructing PrismaClient does not itself open a
# database connection (Prisma connects lazily, on the first query), so
# this needs no live database and is safe to run at build time; the
# immediate $disconnect() is a safe no-op on a client that never
# connected.
WORKDIR /app/deploy
RUN node --input-type=module -e "import('reflect-metadata')" \
  && node --input-type=module -e "import('@nestjs/core')" \
  && node --input-type=module -e "import('@nestjs/platform-express')" \
  && node --input-type=module -e "import { existsSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; const resolved = import.meta.resolve('@acropora/database'); const path = fileURLToPath(resolved); if (!existsSync(path)) { throw new Error('@acropora/database resolved to ' + path + ' but that file does not exist'); } console.log('@acropora/database OK ->', path);"

WORKDIR /app/deploy/node_modules/@acropora/database
RUN node --input-type=module -e "import { PrismaClient } from '@prisma/client'; const client = new PrismaClient(); await client.\$disconnect(); console.log('Prisma Client generated and loadable OK');"

# Fail the build, not a production container's crash loop, if
# packages/database/prisma/schema.prisma or its migrations/ directory
# didn't make it into the deployed tree, or if the Prisma CLI ("prisma",
# moved into @acropora/database's production "dependencies" specifically
# so pnpm deploy --prod carries it forward) doesn't resolve to a real,
# loadable entry point. Both schema.prisma and migrations/ actually arrive
# here for free — `turbo prune --docker` copies each depended-on workspace
# package's entire directory (verified directly: out/full/packages/database
# already contains prisma/schema.prisma and all 26 migrations before pnpm
# deploy even runs), and pnpm deploy --prod then copies that whole
# @acropora/database directory as-is into the deploy output, same as any
# other injected workspace dependency — no explicit COPY of either is
# needed. What genuinely does need an explicit fix is the CLI: it's a
# devDependency by default, which pnpm deploy --prod would strip.
#
# The path resolution below intentionally avoids hardcoding anything under
# node_modules/.pnpm/ — those directory names are version-string-derived
# and not stable across dependency bumps. It instead mirrors the
# .prisma/client copy step above: realpath the @acropora/database
# package.json (following the node_modules/@acropora/database symlink to
# its real physical location in the pnpm virtual store) and let
# createRequire's own module resolution find the actual files. This same
# logic is what apps/api/docker-entrypoint-migrate.cjs runs at container
# startup — see that file for the full reasoning, including why a plain
# node_modules/.bin/prisma shell shim was tried and rejected (its
# relative-path math breaks when invoked through that symlink).
WORKDIR /app/deploy
RUN node -e "const { createRequire } = require('node:module'); const fs = require('node:fs'); const path = require('node:path'); const dbPkg = fs.realpathSync('node_modules/@acropora/database/package.json'); const req = createRequire(dbPkg); const cliEntry = req.resolve('prisma/build/index.js'); const schema = req.resolve('./prisma/schema.prisma'); const migrations = path.join(path.dirname(schema), 'migrations'); if (!fs.existsSync(cliEntry)) { throw new Error('prisma CLI entry missing: ' + cliEntry); } if (!fs.existsSync(schema)) { throw new Error('schema.prisma missing: ' + schema); } const migrationDirs = fs.existsSync(migrations) ? fs.readdirSync(migrations).filter((e) => fs.statSync(path.join(migrations, e)).isDirectory()) : []; if (migrationDirs.length === 0) { throw new Error('no migrations found under ' + migrations); } console.log('Prisma CLI, schema.prisma and ' + migrationDirs.length + ' migration(s) present in the deployed tree:'); console.log('  CLI:', cliEntry); console.log('  schema:', schema); console.log('  migrations:', migrations);"

# -----------------------------------------------------------------------------
# 4. Runtime: minimal, non-root, only the deployed @acropora/api production
#    tree (dist/, production node_modules, generated Prisma client, the
#    Prisma CLI, schema.prisma and migrations/ — see docker-entrypoint.sh).
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
# tini: correct PID-1 signal forwarding and zombie reaping. Nest's own
# enableShutdownHooks() already reacts to SIGTERM directly, so this is
# defense-in-depth rather than a fix for a known bug — cheap to include,
# and removes a whole class of "container won't stop cleanly" issues if a
# future dependency ever forks a child process.
#
# UGYANAZ A GYORSITOTAR-CSAPDA, MINT A WEB KEPENEL, csak itt eddig nem latszott.
# Ez a kep azert maradt zold 2026-08-27-en, mert az `openssl` telepitese friss
# libcrypto3/libssl3 csomagot huz be -- de csak akkor, ha ez a RUN tenylegesen
# lefut. Gyorsitotar-talalat eseten ugyanaz a regi konyvtar marad benne, mint a
# webnel, es a verzio nem a kodtol fugg, hanem a talalattol. A verziozatlan
# `apk add` mindig "ami eppen aktualis" jelentesu, tehat minden ilyen sor a
# build idejetol fugg; a kepbe viszont csak EBBEN a szakaszban telepitett
# csomagok kerulnek bele, ezert all az ellenszer itt.
#
# A reszletes indoklas (miert nem verzio-rogzites) az apps/web/Dockerfile-ban
# all, ugyanennel a lepesnel.
ARG OS_PATCH_EPOCH=local
RUN echo "OS patch epoch: ${OS_PATCH_EPOCH}" \
  && apk add --no-cache libc6-compat openssl tini \
  && addgroup -g 1001 -S nodejs \
  && adduser -S -u 1001 -G nodejs nestjs

# Every stock Node.js image (this one included) ships npm and corepack
# pre-installed, each vendoring their own bundled copies of packages like
# tar, sigstore, picomatch and brace-expansion for their own internal use.
# Those vendored copies are invisible to `pnpm why`/pnpm-lock.yaml — they
# aren't part of this project's dependency graph at all — but a container
# vulnerability scanner (Trivy in this repo's CI) still finds and flags
# them, since the files are physically present in the image regardless of
# whether anything ever calls them. This container only ever runs
# `node dist/main.js`; npm, npx, corepack, pnpm and yarn are never invoked
# at runtime, so the correct, minimal fix is to delete them outright
# rather than try to patch vendored copies this project doesn't control.
RUN rm -rf \
    /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /usr/local/bin/pnpm \
    /usr/local/bin/pnpx \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg

WORKDIR /app
ENV NODE_ENV=production

# Re-declare in this stage - Docker ARGs do not automatically carry across
# FROM boundaries, each stage that needs one must re-declare it.
ARG RELEASE_COMMIT_SHA=""
# Bake the build-arg into the image itself as a real environment variable,
# so the running container knows its own commit regardless of whatever
# (if anything) the deploy platform's own runtime env config sets. Fails
# the build outright if a non-empty value doesn't look like a real, full
# git commit SHA (40 lowercase hex chars) - this catches a copy-paste
# mistake or a placeholder string at build time rather than silently
# shipping a container whose activation-readiness can never demonstrate
# anything for a subtly-wrong reason. An EMPTY value is allowed through on
# purpose (see the ARG's own comment above) - "not configured" must stay
# possible and must never look like "misconfigured".
RUN if [ -n "$RELEASE_COMMIT_SHA" ]; then \
      echo "$RELEASE_COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$' || \
      (echo "RELEASE_COMMIT_SHA=\"$RELEASE_COMMIT_SHA\" is not a well-formed 40-char lowercase hex git commit SHA" >&2 && exit 1); \
    fi
ENV RELEASE_COMMIT_SHA=${RELEASE_COMMIT_SHA}

# The deploy output is already @acropora/api's own root (package.json,
# dist/, node_modules/ at the top level) — no apps/api subdirectory to
# WORKDIR into, unlike the old pruned-monorepo-tree copy.
COPY --from=deployed --chown=nestjs:nodejs /app/deploy ./

# docker-entrypoint.sh / docker-entrypoint-migrate.cjs are ordinary repo
# source files (apps/api/), not something pnpm deploy produces, so they're
# copied straight from the build context rather than from the "deployed"
# stage. --chmod=755 because a COPY'd file otherwise keeps its host
# permissions, which aren't guaranteed executable across checkouts/CI.
COPY --chown=nestjs:nodejs --chmod=755 \
  apps/api/docker-entrypoint.sh apps/api/docker-entrypoint-migrate.cjs ./

USER nestjs

EXPOSE 3001

# Uses the existing GET /health endpoint (checks Postgres + Redis). Node's
# built-in fetch avoids needing curl/wget in the runtime image.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# docker-entrypoint.sh runs `prisma migrate deploy` (never `db push`) to
# completion, or exits non-zero without ever execing `node dist/main.js` —
# see that file for the full reasoning. This makes migration-before-boot
# a property of the container itself instead of depending solely on an
# external, separately-configured Coolify pre-deployment command staying
# correctly wired up (see docs/COOLIFY.md and docs/DEPLOYMENT.md Section 5
# for how the two now fit together).
ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
