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
# 3. `pnpm prune --prod` then strips devDependencies back out of that SAME
#    node_modules tree in place. This is deliberate: reinstalling a second,
#    separate prod-only node_modules in a fresh stage and trying to copy the
#    generated Prisma client into it afterwards is a well-known source of
#    breakage with pnpm's symlinked/content-addressable store layout, since
#    the generated client lives deep inside pnpm's virtual store rather than
#    at a flat, easily-copyable path. Pruning in place avoids that entirely.
# 4. The runtime stage copies the already built-and-pruned workspace as-is
#    and runs as a non-root user.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.34.5
# Keep in sync with the "turbo" devDependency version in the root package.json.
ARG TURBO_VERSION=2.10.5

FROM node:${NODE_VERSION}-alpine AS base
# openssl: required by Prisma's query engine on Alpine (musl).
# libc6-compat: covers native addons that expect glibc-shaped symbols.
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

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
#    from the pruned `runner` image below, since it no longer has the CLI.
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
RUN pnpm turbo run build

# -----------------------------------------------------------------------------
# 3. Prune devDependencies out of the built tree, in place.
#
#    Done as its own stage (rather than mutating `builder`) so `builder`
#    stays available, unmodified, as the migrator image described above.
#    Pruning in place — instead of installing a second, separate prod-only
#    node_modules in a fresh stage and copying the generated Prisma client
#    into it afterwards — avoids a well-known source of breakage with pnpm's
#    symlinked/content-addressable store layout, since the generated client
#    lives deep inside pnpm's virtual store rather than at a flat, easily
#    copyable path.
# -----------------------------------------------------------------------------
FROM builder AS pruned
RUN pnpm prune --prod

# -----------------------------------------------------------------------------
# 4. Runtime: minimal, non-root, only the pruned + built workspace subset.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache libc6-compat openssl \
  && addgroup -g 1001 -S nodejs \
  && adduser -S -u 1001 -G nodejs nestjs

WORKDIR /app
ENV NODE_ENV=production

COPY --from=pruned --chown=nestjs:nodejs /app .

USER nestjs
WORKDIR /app/apps/api

EXPOSE 3001

# Uses the existing GET /health endpoint (checks Postgres + Redis). Node's
# built-in fetch avoids needing curl/wget in the runtime image.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
