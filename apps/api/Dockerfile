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
#    followed by regenerating the Prisma Client directly into that
#    directory (deploy does not carry forward Prisma's generated
#    artifacts — see the "deployed" stage for why and how this was
#    verified).
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
# 4. The runtime stage copies the deployed directory as-is and runs as a
#    non-root user.

ARG NODE_VERSION=22.23.1
ARG PNPM_VERSION=10.34.5
# Keep in sync with the "turbo" devDependency version in the root package.json.
ARG TURBO_VERSION=2.10.5

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
#    This stage is intentionally also usable directly as a one-off
#    "migrator" image, since it still has the Prisma CLI, the migrations
#    folder and a generated client:
#
#      docker build -f apps/api/Dockerfile --target builder -t acropora-api:migrate .
#      docker run --rm --env DATABASE_URL=... acropora-api:migrate \
#        pnpm --filter @acropora/database exec prisma migrate deploy
#
#    This is what the Coolify pre-deployment command should point at (see
#    docs/PRODUCTION-DEPLOYMENT-ARCHITECTURE-REVIEW.md, Section 6) — never
#    `migrate dev` or `db push` against production, and never run migrations
#    from the `runner` image below, since its deployed production
#    dependency tree deliberately has no Prisma CLI.
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
# Fix: regenerate directly into the deployed tree, using the Prisma CLI
# from this builder-derived stage (never present in the final runner
# image — `prisma` is a devDependency of @acropora/database, and --prod
# deploy correctly excludes it) against the schema and config belonging
# to the DEPLOYED copy of @acropora/database, not the builder's own copy.
# Setting the working directory to the deployed package's own directory
# (rather than passing --schema as a flag from a different cwd, which
# would leave it ambiguous whether the builder's own prisma.config.ts or
# the flag wins) was verified directly to correctly auto-discover the
# deployed prisma.config.ts ("Loaded Prisma config from prisma.config.ts",
# confirmed pointing at the deployed path) — so @prisma/client's
# generation target resolves starting from the deployed tree, exactly
# where the deployed @acropora/database's own compiled code will look for
# it at runtime.
RUN cd /app/deploy/node_modules/@acropora/database \
  && /app/packages/database/node_modules/.bin/prisma generate

# Fail the build here, not at container startup, if the deployed production
# tree is missing something the app imports, or if the regenerate step
# above didn't actually produce a loadable Prisma Client. Run from the
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

# -----------------------------------------------------------------------------
# 4. Runtime: minimal, non-root, only the deployed @acropora/api production
#    tree (dist/, production node_modules, generated Prisma client).
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
# tini: correct PID-1 signal forwarding and zombie reaping. Nest's own
# enableShutdownHooks() already reacts to SIGTERM directly, so this is
# defense-in-depth rather than a fix for a known bug — cheap to include,
# and removes a whole class of "container won't stop cleanly" issues if a
# future dependency ever forks a child process.
RUN apk add --no-cache libc6-compat openssl tini \
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

# The deploy output is already @acropora/api's own root (package.json,
# dist/, node_modules/ at the top level) — no apps/api subdirectory to
# WORKDIR into, unlike the old pruned-monorepo-tree copy.
COPY --from=deployed --chown=nestjs:nodejs /app/deploy ./

USER nestjs

EXPOSE 3001

# Uses the existing GET /health endpoint (checks Postgres + Redis). Node's
# built-in fetch avoids needing curl/wget in the runtime image.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
