# syntax=docker/dockerfile:1.7
#
# Acropora OS — Web (Next.js) production image.
#
# Build context is the REPOSITORY ROOT (this is a pnpm/Turborepo monorepo):
#   docker build -f apps/web/Dockerfile --build-arg API_URL=http://acropora-api:3001 -t acropora-web .
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
# pnpm 10+ prompts for confirmation before removing/recreating node_modules,
# and aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY when no TTY is
# attached, which is always the case in a Docker build. CI=true is pnpm's
# documented signal to skip that interactive prompt for every pnpm
# invocation in every stage derived from this one — see
# apps/api/Dockerfile for the fuller rationale (that's where this was
# actually hit, in `pnpm prune --prod`; set here too for consistency and
# because this stage runs the same pnpm install/turbo build steps).
ENV CI=true

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

# Next evaluates next.config.ts during the image build. API_URL therefore must
# be supplied as a Docker build argument; a runtime-only environment variable
# arrives too late and would otherwise produce a broken rewrite in the bundle.
ARG API_URL
ENV API_URL=${API_URL}
RUN test -n "$API_URL"

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

# Every stock Node.js image (this one included) ships npm and corepack
# pre-installed, each vendoring their own bundled copies of packages like
# tar, sigstore, picomatch and brace-expansion for their own internal use
# — invisible to pnpm-lock.yaml, but still flagged by a container
# vulnerability scanner (Trivy in this repo's CI) since the files are
# physically present regardless of whether anything calls them. This
# container only ever runs `node apps/web/server.js`; npm, npx, corepack,
# pnpm and yarn are never invoked at runtime, so the correct, minimal fix
# is to delete them rather than try to patch vendored copies this project
# doesn't control. See apps/api/Dockerfile for the fuller rationale.
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
