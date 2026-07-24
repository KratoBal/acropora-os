# syntax=docker/dockerfile:1.7
#
# Acropora OS — Web (Next.js) production image.
#
# Build context is the REPOSITORY ROOT (this is a pnpm/Turborepo monorepo):
#   docker build -f apps/web/Dockerfile -t acropora-web .
#
# Strategy
# --------
# 1. `turbo prune` extracts only the workspace packages @acropora/web
#    actually depends on (apps/api and its dependencies never enter this
#    image).
# 2. A single `pnpm install` + `turbo run build` compiles the app. Next's
#    `output: "standalone"` (see apps/web/next.config.ts) then produces a
#    self-contained runtime bundle in .next/standalone via dependency
#    tracing — this correctly resolves pnpm's symlinked node_modules down
#    to the real files actually needed at runtime, which is the standard,
#    well-supported way to get a minimal Next.js image regardless of package
#    manager, unlike hand-copying node_modules for a non-Next app.
# 3. The runtime stage copies only .next/standalone, .next/static and
#    public/ — no devDependencies, no build tools, no unrelated workspace
#    source.

ARG NODE_VERSION=22.23.1
ARG PNPM_VERSION=10.34.5
# Keep in sync with the "turbo" devDependency version in the root package.json.
ARG TURBO_VERSION=2.10.5

FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# -----------------------------------------------------------------------------
# 1. Prune: reduce the monorepo to only what @acropora/web needs.
# -----------------------------------------------------------------------------
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @acropora/web --docker

# -----------------------------------------------------------------------------
# 2. Build.
# -----------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

COPY --from=pruner /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=acropora-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .

# Next.js reads a handful of env vars at build time (e.g. to inline into
# client bundles via NEXT_PUBLIC_*). None exist yet in this app, but the
# build-arg plumbing is left here, ready, rather than added later as a
# surprise — see docs/PRODUCTION-DEPLOYMENT-ARCHITECTURE-REVIEW.md.
RUN --mount=type=cache,id=acropora-web-turbo-cache,target=/app/.turbo \
    pnpm turbo run build

# -----------------------------------------------------------------------------
# 3. Runtime: minimal, non-root, standalone Next.js output only.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
# tini: correct PID-1 signal forwarding and zombie reaping (see
# apps/api/Dockerfile for the fuller rationale — applies here too).
RUN apk add --no-cache libc6-compat tini \
  && addgroup -g 1001 -S nodejs \
  && adduser -S -u 1001 -G nodejs nextjs

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
