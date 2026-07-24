# Acropora OS — Production Deployment Architecture Review

Status: **Review only. No code has been changed.** This document is the required first deliverable before any Dockerization or deployment work begins, per the engagement brief. Implementation starts only after explicit approval of the plan in Section 8, and after the decisions flagged in Section 2A and Section 9 are made.

Reviewed: 2026-07-24. Repository: `acropora-os` (pnpm workspace, Turborepo, Next.js + NestJS + Prisma + PostgreSQL + Redis), target platform Hetzner Cloud / Docker / Coolify via GitHub App.

---

## 1. Current Architecture

**Monorepo shape.** pnpm workspace (`apps/*`, `packages/*`) orchestrated by Turborepo 2.x, TypeScript 6, Node.js `>=22`, pnpm pinned at `10.34.5` via `packageManager`. Four workspace packages (`@acropora/config`, `@acropora/database`, `@acropora/types`, `@acropora/ui`) are consumed as source by the two deployable apps — `@acropora/ui` and `@acropora/types` ship raw `.ts` via `exports`, relying on Next's `transpilePackages` and Nest's TS build to compile them in-place rather than being pre-built libraries. This is fine for `turbo build`, but it means any Docker build must carry the full workspace source tree (or a `turbo prune`'d subset), not just one app's folder.

**apps/web** — Next.js 16.2.10 / React 19.2.7. `next build` / `next start --port 3000`. No `output: "standalone"` configured yet, so the default build assumes a full `node_modules` tree is present at runtime. Talks to the API only via a server-side rewrite (`/api/*` → `API_URL`), so it needs no direct database or Redis access.

**apps/api** — NestJS 11, ESM (`"type": "module"`), built with `nest build` to `dist/main.js`, started with plain `node dist/main.js`. Bootstrap (`main.ts`) is minimal: CORS locked to a single `WEB_URL` origin, a global `ValidationPipe`, listens on `PORT`. No `app.enableShutdownHooks()`, no Helmet, no compression, no rate limiting configured at the framework level yet.

**Data layer** — `@acropora/database` wraps a single Prisma 6.19 client (`packages/database/prisma/schema.prisma`), exposed as a process-wide singleton (`export const prisma = ...`). 17 migrations are checked into git under `prisma/migrations/`, dated 2026-07-19 through 2026-07-24 — this is a genuine, actively-evolving schema, not a placeholder. `prisma.config.ts` currently does this:

```ts
process.env.DATABASE_URL ??=
  "postgresql://acropora:acropora@localhost:5432/acropora?schema=public&connect_timeout=2";
```

i.e. if `DATABASE_URL` is ever unset, Prisma silently falls back to a local dev connection string instead of failing. Harmless in local dev; a real footgun in any environment where this file's fallback could mask a misconfigured deployment (see Section 2).

**Background jobs.** Four scheduler classes exist (`unas-product-sync.scheduler.ts`, `unas-customer-sync.scheduler.ts`, `unas-order-sync.scheduler.ts`, `nav-incoming-invoice.scheduler.ts`). None use `@nestjs/schedule`, BullMQ, or any distributed queue — each is a hand-rolled `setTimeout` loop (`.unref()`'d, so it won't block process exit) with an in-memory "already running" guard, started from `onModuleInit()`. They run **inside the same process that serves HTTP traffic**, and their concurrency guard is per-process, not distributed. This is a deliberate, reasonable choice for a single-instance deployment, but it is a hard constraint on horizontal scaling (Section 3, 7).

**Health.** `GET /health` (public) checks Postgres via `SELECT 1` and Redis via `PING` in parallel, returns HTTP 503 if either is down. This is already a solid foundation for container health checks — no `@nestjs/terminus` dependency needed, and there's an existing HTTP smoke test (`test:smoke`) that exercises it end-to-end.

**Local infrastructure.** Root `docker-compose.yml` provides Postgres 16-alpine and Redis 7-alpine for local development only — hardcoded weak credentials (`acropora`/`acropora`), both ports published directly to the host. There is currently no production compose file, no Dockerfile for either app, and no `.dockerignore`.

**CI.** A single GitHub Actions workflow (`.github/workflows/ci.yml`) spins up Postgres+Redis service containers, installs with a frozen lockfile, runs `prisma generate` → `prisma migrate deploy` → `prisma:seed` → lint/typecheck → unit tests → DB integration tests → HTTP smoke test → `turbo build`. This is a good correctness gate, but it never builds a container image, publishes an artifact, or scans anything — it validates the *code*, not the *deployable*.

**Authentication.** This is architecturally important enough to call out here as well as under blockers: the team has already built a provider-independent `Session`/`AuthenticatedUser` abstraction (a good decision, see `docs/AUTHENTICATION.md`), but the only implementation behind it today is an explicitly development-only mock: email-only login (no password), four hardcoded users, sessions held in an in-memory `Map` inside a singleton Nest service, and `AuthService.loginWithDevelopmentUser` throws `ForbiddenException` whenever `NODE_ENV=production`. The team's own docs and `ROADMAP.md` (#0002) already flag this as incomplete. See Section 2A.

---

## 2. Existing Deployment Blockers

**Hard blockers (must be resolved or explicitly accepted before go-live):**

- **No production authentication exists at all**, and login is code-level disabled in production. See Section 2A — this is the single largest blocker and it is a product decision, not an infrastructure one.
- **In-memory session store.** Even once a production auth provider exists, a per-process `Map` won't survive a redeploy/restart and won't work across more than one API replica.
- **Custom in-process schedulers assume exactly one running API instance.** Running 2+ replicas for HA/load, without further work, will duplicate every scheduled UNAS/NAV sync — risking duplicate stock writes, wasted rate-limit budget, or outright bans from those external APIs.
- **No Dockerfile, `.dockerignore`, or production container image exists.**
- **`docker-compose.yml` is dev-only**: weak fixed credentials, ports bound to the host — must never be reused as-is for production.
- **Silent `DATABASE_URL` fallback** in `prisma.config.ts` (Section 1) should fail loudly instead of defaulting to `localhost` in any non-local environment.

**Process/tooling gaps (addressable purely at the infra/CI layer, no app code involved):**

- No CI step builds or scans a Docker image; no image tagging/versioning or registry push strategy.
- No documented, categorized environment variable contract for production operators.
- No backup/restore runbook or tested restore drill for Postgres.

**Known, already-documented external-dependency limitation (not a deployment blocker, noted for completeness):** the MNB exchange-rate client is implemented but currently blocked in production by MNB's own bot protection (`docs/CURRENT_STATUS.md`); manual rate entry is the documented workaround. Unrelated to this infrastructure work.

### 2A. STOP — Production Authentication Gap

Per the engagement rules, this needs to be raised explicitly rather than worked around: **business/auth logic is out of scope, but there is currently no way for a real user to log in once `NODE_ENV=production` is set** (`AuthService.loginWithDevelopmentUser` actively refuses in production, and no other login path exists). This is not something Dockerization or Coolify configuration can fix — it is a pre-existing, already-known gap (`docs/AUTHENTICATION.md`, `ROADMAP.md` #0002), and it will not be touched without your explicit direction. Three options, none of which I will act on without approval:

1. **Deploy infra now, gate access at the network layer.** Stand up the full production stack (web, api, Postgres, Redis, TLS, backups) on Hetzner/Coolify, but keep it reachable only via VPN, IP allowlist, or a reverse-proxy Basic-Auth wall (configured in Coolify/Traefik, not in application code) until a real auth provider ships. This lets infrastructure work proceed fully in parallel with zero app-code changes.
2. **Build a minimal production auth provider first** (password hashing, secure httpOnly-cookie or Redis-backed sessions, matching the existing `Session`/`AuthenticatedUser` contract so guards/permissions are untouched). This is a scoped, well-bounded change, but it is business/auth logic and needs its own explicit go-ahead and likely its own review — not bundled into "deployment infrastructure" work.
3. **Treat #0002 (production auth) as a prerequisite** and hold the production go-live (though not the infra build-out) until that roadmap item is done.

None of these require a decision right now to start Phase 1–4 of the plan in Section 8; they only gate the actual production go-live in Phase 5. I've flagged it early so it doesn't become a surprise at the end.

---

## 3. Security Concerns

- **Secrets currently live only in a plaintext root `.env`** (gitignored, correctly excluded from git) that already contains real credentials (NAV technical user login/password/sign key, UNAS API key). Before go-live these must move into Coolify's environment/secret storage and never be baked into an image layer or committed.
- **Weak, hardcoded Postgres/Redis credentials** in the dev compose file — production must use randomly generated, environment-specific credentials, not reused across environments.
- **No TLS termination is defined in this repo** — the plan assumes Coolify's built-in reverse proxy (Traefik) handles HTTPS/HSTS; this should be made explicit in the deployment docs rather than assumed.
- **CORS** is a single static origin from `WEB_URL` — correct as configured, but production domain values must be reviewed at deploy time and a wildcard must never be substituted.
- **Bearer tokens in `localStorage`** on the web side (documented by the team itself in `docs/AUTHENTICATION.md` as forbidden in production) — an XSS-exfiltration risk that will need to be resolved as part of whichever production-auth option is chosen in 2A, not as infra work.
- **No security headers middleware** (Helmet-equivalent), no rate limiting, and no brute-force protection on auth endpoints — low urgency today (auth is dev-only and unreachable in production), but must land alongside real production auth.
- **No dependency or container vulnerability scanning** anywhere in CI today.
- **No non-root container user is defined yet** — there is no Dockerfile to define one in.

## 4. Performance Concerns

- **Next.js build has no `output: "standalone"`** — without it, the runtime image must carry the full `node_modules` tree rather than Next's pruned, self-contained output. This is a one-line `next.config.ts` change; flagged for approval in Section 9 since it touches a source file, even though it's purely a build/deploy concern.
- **No explicit Prisma connection pool sizing** — on a modest Hetzner VM, an unbounded/default pool across even a single API replica can outgrow Postgres's `max_connections`. Recommend sizing via `connection_limit` on `DATABASE_URL`, documented relative to CPU cores and the chosen Postgres plan.
- **Schedulers share the request-serving event loop.** At current data volumes this is fine, but a large UNAS/NAV sync run will compete with HTTP request handling in the same process. Not a blocker; worth monitoring, and worth documenting as a candidate for extraction into a separate worker process/container sharing the same image with a different `CMD`, later.
- **No caching/compression strategy is documented** for static assets or API responses. Recommendation is to let Coolify's Traefik proxy handle gzip/br compression and set long-lived immutable cache headers on `_next/static/*`, rather than duplicating this inside the Nest app.
- Turborepo remote caching is not configured — low priority for a single-developer project, optional future improvement for CI speed.

## 5. Dockerization Strategy

Two independent images — `apps/web` and `apps/api` — built from the same monorepo, using Turborepo's documented `turbo prune --docker` pattern rather than a hand-rolled approach, because it is purpose-built for exactly this pnpm+Turborepo shape and keeps Docker layer caching aligned with dependency-vs-source-change boundaries:

1. **base** — `node:22-alpine`, Corepack activated and pinned to the exact `pnpm@10.34.5` from `package.json`.
2. **pruner** — runs `turbo prune --scope=@acropora/web` (or `@acropora/api`) `--docker`, producing a minimal `out/json` (package.json-only, for install-layer caching) and `out/full` (actual pruned source).
3. **installer** — copies only `out/json` first and runs `pnpm install --frozen-lockfile`; this layer only invalidates when dependencies change, not on every source edit.
4. **builder** — copies `out/full`, runs `prisma generate` (api only) and `turbo run build --filter=<app>`.
5. **runner** — minimal final stage, non-root user, only the built output plus production dependencies (Next.js standalone output for web; `dist/` + production `node_modules` for api), `HEALTHCHECK` hitting `GET /health` (api) or `GET /` (web), proper signal handling for graceful shutdown.

Two specific source changes are required for this to work correctly and are called out for approval rather than silently made:

- **`next.config.ts`: add `output: "standalone"`** — required for a minimal, self-contained web runtime image.
- **`schema.prisma`: add a musl-compatible `binaryTargets` entry** (e.g. `linux-musl-openssl-3.0.x`) alongside the default — required because Prisma's default-compiled engine targets glibc, and Alpine uses musl; without this the api image will fail at runtime, not at build time.
- **`main.ts`: call `app.enableShutdownHooks()`** and handle `SIGTERM` — required so Coolify's rolling restarts drain in-flight requests and close Prisma/Redis connections cleanly instead of hard-killing the process.
- **`prisma.config.ts`: remove the silent localhost fallback**, replacing it with a fail-fast check outside of `NODE_ENV !== "production"` guards that already exist elsewhere in the codebase.

These four are minimal, deployment-only, and don't touch business logic, APIs, or auth — but per the brief's rules they're still called out explicitly rather than made unilaterally. See Section 9.

`.dockerignore` will need to exclude, at minimum: `node_modules`, `.git`, `.turbo`, `dist`, `test-dist`, `.next` (except retained build output), `coverage`, `tmp-*-check-dist`, local `.env`, `docs`, `adr`, `backlog`, `prototypes`, and the 84 MB `acropora-pre-m1.sql` dump sitting at the repo root — none of this belongs in a build context or image layer.

## 6. Production Deployment Strategy (Hetzner + Coolify)

- **Two Coolify applications** from the same GitHub repo (via the GitHub App integration), one per Dockerfile/build context (`web`, `api`).
- **Managed Postgres and Redis as Coolify-native resources** rather than embedding them in an app-level compose file — this gets one-click backup scheduling and independent upgrade lifecycle management "for free" from Coolify, versus hand-rolling it. (Recommendation, not a hard requirement — your call.)
- **Migrations run as a pre-deployment step**, not inside the running container's startup path: `prisma migrate deploy` executed as a one-off Coolify deployment hook *before* the new `api` container starts receiving traffic. Never `migrate dev`, never `db push` against production. `prisma:seed` must **not** run against production data — it's dev-only reference-data seeding and should be explicitly excluded from any production deploy hook, unlike in CI where it seeds a disposable database.
- **Single replica for `api`** is the recommended starting point, given the in-process scheduler constraint (Section 2, 3). `web` is fully stateless and can scale horizontally without any changes.
- **Zero-downtime deploys** via Coolify's default rolling restart gated on the `HEALTHCHECK`/`/health` endpoint passing before the old container is stopped.
- **Rollback**: Coolify retains the previous image, so a bad app-code deploy rolls back cleanly. Database migrations are forward-only in Prisma; a bad *schema* change is not automatically reversible — the plan will document an expand/contract migration convention and a "backup immediately before any migration marked risky" step, rather than relying on rollback alone.
- **Backups**: nightly automated Postgres dumps with a retention policy (e.g. 7 daily + 4 weekly) to Hetzner Object Storage or equivalent, plus a periodically-tested restore drill — a backup strategy is unproven until it's been restored once. Redis in this system is currently pure cache/health-check usage, so its backup priority is much lower unless it later becomes the session store (Section 2A option 2), in which case AOF persistence (already enabled in dev compose) should carry into production.
- **Networking**: internal Docker network between `web`, `api`, Postgres, Redis; only `web` (and `api` if it needs to be directly reachable by external integrations/webhooks) exposed via Coolify's proxy with TLS. Postgres and Redis must never be published to a public port, unlike the current dev compose file.
- **Disaster recovery**: documented runbook covering full-stack redeploy from the GitHub repo + latest Postgres backup, target RTO/RPO to be agreed with you rather than assumed.

## 7. Risks

| Risk | Severity | Notes |
|---|---|---|
| No production auth path exists; login is disabled when `NODE_ENV=production` | Critical | Blocks real usage regardless of infra quality; decision needed (Section 2A) |
| Multi-replica scaling silently duplicates scheduled UNAS/NAV syncs | High | Must document single-replica constraint; mitigate later with a distributed lock or dedicated worker |
| In-memory sessions don't survive restarts or multiple replicas | High | Tied to whichever auth option is chosen |
| Real integration secrets (NAV, UNAS) currently sit in a local `.env` | Medium | Must migrate to Coolify secrets before go-live; already gitignored so no repo exposure today |
| Silent `DATABASE_URL` fallback to localhost | Medium | Should fail fast instead; small, safe fix |
| No image/dependency vulnerability scanning yet | Medium | Add Trivy/`pnpm audit` to CI as part of this work |
| Backup/restore strategy unproven | Medium | Must run at least one real restore drill before relying on it |
| MNB exchange-rate API blocked by bot protection in production | Low | Known, documented, unrelated to this work; manual rate entry is the existing workaround |

## 8. Recommended Implementation Plan

Sequenced so that infrastructure work (Phases 1–4, 6–8) can proceed independent of the auth decision in Section 2A, which only gates Phase 5 (the actual production go-live).

**Phase 0 — Approvals** (this document): sign off on the plan; decide on the Section 2A auth approach; approve the four minimal source touches listed in Section 5 and repeated in Section 9.

**Phase 1 — Dockerization**: `turbo prune`-based multi-stage Dockerfiles for `web` and `api`, `.dockerignore`, local `docker build`/`docker run` verification, an optional `docker-compose.prod.yml` for local parity testing before Coolify.

**Phase 2 — Environment & secrets documentation**: full audit of every environment variable, categorized as Required / Optional / Development-only / Production-only / Secret, secret-generation guidance (e.g. `openssl rand -base64 32` for `SESSION_SECRET`/`JWT_SECRET`), and how each maps to Coolify's environment variable groups.

**Phase 3 — Database lifecycle**: confirm `prisma migrate deploy` as the only production path, wire it as a Coolify pre-deployment hook, explicitly exclude `prisma:seed` from production, write the backup/restore runbook and run one real restore drill.

**Phase 4 — Observability & lifecycle**: structured JSON logging, startup validation that fails fast on missing required env vars, `enableShutdownHooks()` + `SIGTERM` handling, container `HEALTHCHECK`s, a documented failure-recovery runbook.

**Phase 5 — Coolify configuration & first deploy** *(gated on the Section 2A decision)*: connect the GitHub App, define the `web`/`api` applications plus Postgres/Redis resources, wire env vars/secrets, configure health checks/domains/TLS, deploy, smoke test.

**Phase 6 — CI hardening**: add a Docker build-validation step to CI (every PR proves both images build), add dependency/image vulnerability scanning, keep the existing lint/typecheck/test/migrate-deploy/build gates.

**Phase 7 — Documentation**: `DEPLOYMENT.md`, `ENVIRONMENT.md`, and a `RUNBOOK.md` (backup/restore, rollback, disaster recovery), plus a README pointer to all of the above.

**Phase 8 — Final validation**: repo builds, both Docker images build, containers start and pass health checks, `prisma migrate deploy` succeeds against a scratch database, documentation matches what was actually built, and the whole deploy is reproducible from a clean checkout.

---

## 9. Items Requiring Your Explicit Approval Before Implementation

1. **Section 2A** — which of the three production-auth approaches to take (or "infra only for now, decide later" is also a valid answer).
2. **`next.config.ts`**: add `output: "standalone"`.
3. **`schema.prisma`**: add a musl-compatible `binaryTargets` entry.
4. **`main.ts`**: add `app.enableShutdownHooks()` + `SIGTERM` handling.
5. **`prisma.config.ts`**: replace the silent localhost fallback with a fail-fast check.
6. **Single-replica constraint for `api`** — confirm this is acceptable for now, given the in-process schedulers.
7. General go-ahead to start Phase 1 (Dockerization), independent of the above.

Nothing beyond this document has been written to the repository.
