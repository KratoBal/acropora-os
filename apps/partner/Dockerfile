# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22.23.1
ARG PNPM_VERSION=10.34.5
ARG TURBO_VERSION=2.10.5

FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV CI=true

FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @acropora/partner --docker

FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=acropora-partner-pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
ARG API_URL
ENV API_URL=${API_URL}
RUN test -n "$API_URL"
RUN --mount=type=cache,id=acropora-partner-turbo-cache,target=/app/.turbo pnpm turbo run build

FROM node:${NODE_VERSION}-alpine AS runner
ARG OS_PATCH_EPOCH=local
RUN echo "OS patch epoch: ${OS_PATCH_EPOCH}" && apk add --no-cache --upgrade libcrypto3 libssl3 libc6-compat tini && addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production
ARG RELEASE_COMMIT_SHA=""
RUN if [ -n "$RELEASE_COMMIT_SHA" ]; then echo "$RELEASE_COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$' || (echo "RELEASE_COMMIT_SHA must be a full lowercase SHA" >&2 && exit 1); fi
ENV RELEASE_IMAGE_COMMIT_SHA=${RELEASE_COMMIT_SHA}
COPY --from=builder --chown=nextjs:nodejs /app/apps/partner/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/partner/.next/static ./apps/partner/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/partner/public ./apps/partner/public
USER nextjs
EXPOSE 3002
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3002) + '/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/partner/server.js"]
