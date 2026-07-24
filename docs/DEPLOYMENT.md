# Production Deployment

This document describes the complete process for deploying Acropora OS to
production: Hetzner Cloud, running Docker containers managed by Coolify,
deployed from the `KratoBal/acropora-os` GitHub repository via Coolify's
GitHub App integration.

For the concrete, field-by-field Coolify configuration (build context,
Dockerfile paths, ports, environment variable groups, health checks,
persistent volumes), see [`docs/COOLIFY.md`](./COOLIFY.md). This document
covers the process end to end; that one is the reference you keep open while
clicking through Coolify's UI.

For the architectural reasoning behind every decision here — why two
separate images, why a single API replica, why production authentication is
explicitly out of scope for this work — see
[`docs/PRODUCTION-DEPLOYMENT-ARCHITECTURE-REVIEW.md`](./PRODUCTION-DEPLOYMENT-ARCHITECTURE-REVIEW.md).

---

## 1. What gets deployed

Two independently deployable images, built from the same monorepo:

| Service | Dockerfile | Build context | Port | Health check |
|---|---|---|---|---|
| `web` (Next.js) | `apps/web/Dockerfile` | repo root | 3000 | `GET /` |
| `api` (NestJS) | `apps/api/Dockerfile` | repo root | 3001 | `GET /health` |

Plus two stateful dependencies, provisioned as Coolify-managed resources
(recommended) or an equivalent externally-managed Postgres/Redis:

- **PostgreSQL 16** — primary datastore.
- **Redis 7** — currently used for health checks only; reserved for future
  session storage or caching.

**Known, deliberate constraint: run `api` as a single replica.** The UNAS
and NAV background sync schedulers (`apps/api/src/**/*.scheduler.ts`) are
hand-rolled in-process `setTimeout` loops with a per-process "already
running" guard — not a distributed lock. Running two or more `api`
replicas while any sync is enabled will duplicate every scheduled run
against UNAS/NAV, which is a real risk (duplicate stock writes, wasted
rate-limit budget, potential upstream bans), not just wasted work. `web` is
fully stateless and can be scaled freely.

---

## 2. Prerequisites

- A Hetzner Cloud server with Coolify installed (Coolify's own installer
  handles the Docker Engine setup).
- Coolify's GitHub App installed and granted access to the
  `KratoBal/acropora-os` repository.
- A domain (or subdomain) pointed at the Hetzner server for `web`, and
  optionally one for `api` if it needs to be reachable directly (e.g. for
  webhook endpoints) rather than only through `web`'s server-side rewrite.
- **A decision on how production access is gated.** As established in
  `PRODUCTION-DEPLOYMENT-ARCHITECTURE-REVIEW.md` Section 2A: there is no
  production authentication provider yet — `AuthService.loginWithDevelopmentUser`
  explicitly refuses when `NODE_ENV=production`. The chosen approach for
  now is network-level gating (VPN, IP allowlist, or reverse-proxy
  Basic-Auth configured in Coolify/Traefik) rather than blocking
  infrastructure work on building real auth first. Have this decided and
  configured before exposing either service publicly.

---

## 3. First production boot — do these before flipping traffic on

This is the part that's easy to get wrong once and never again, so it's
called out as its own section rather than buried in a step list.

1. **Provision Postgres and Redis first**, independent of the app
   containers, with generated (not default/shared) credentials. Never
   reuse the weak `acropora`/`acropora` credentials from the local
   `docker-compose.yml` — those are for local development only.

2. **Run migrations before the api container ever starts.** See Section 5
   below. This also creates the `UnasConnectionSetting` singleton row (via
   the migration that introduces that table), defaulting to
   `credentialMode = ENV_FALLBACK` — this matters for the next step.

3. **Set `UNAS_CREDENTIAL_ACTIVE_KEY_VERSION` and a matching
   `UNAS_CREDENTIAL_MASTER_KEY_V<n>` before the api container's first
   production boot, even if you don't plan to use UNAS's database-encrypted
   credential storage.** `UnasConnectionStartupValidator` runs only when
   `NODE_ENV=production`, and it unconditionally validates the active
   master key regardless of which credential mode is actually in use. Skip
   this and the api container will crash-loop on every single boot — not a
   soft failure, a hard one. Generate the key with:

   ```bash
   openssl rand -base64 32
   ```

   Put the output in `UNAS_CREDENTIAL_MASTER_KEY_V1` and set
   `UNAS_CREDENTIAL_ACTIVE_KEY_VERSION=1`.

4. **Set `UNAS_API_KEY`** if you're using the default `ENV_FALLBACK`
   credential mode (which every fresh database gets automatically — see
   step 2). Without it, `UnasConnectionStartupValidator` still fails at
   boot (`UNAS_CONNECTION_NOT_CONFIGURED`), same crash-loop outcome as
   step 3.

5. **Generate all remaining secrets** (see
   [`.env.production.example`](../.env.production.example) for the full,
   categorized list) and load them into Coolify's environment variable
   store — never as a committed file, never inlined into a Dockerfile.

6. **Deploy `api` once and confirm `GET /health` returns 200** before
   pointing `web` (or any public traffic) at it. `/health` checks both
   Postgres and Redis connectivity and returns 503 if either is down — a
   green health check is a real, meaningful signal here, not a stub.

7. **Only then deploy `web`**, pointed at the now-healthy `api` via
   `API_URL`.

---

## 4. Ongoing deploys

Coolify's GitHub App integration triggers a build + deploy on push (or on
your chosen branch/webhook policy). Each deploy:

1. Builds the relevant image(s) from the current commit using the
   Dockerfiles in Section 1.
2. For `api`: runs the pre-deployment migration step (Section 5) against
   the production database **before** the new container starts receiving
   traffic.
3. Starts the new container, waits for `HEALTHCHECK` to pass.
4. Once healthy, Coolify's rolling restart swaps traffic to the new
   container and stops the old one — `app.enableShutdownHooks()`
   (`apps/api/src/main.ts`) means the old `api` container gets a real
   chance to drain in-flight requests and close its Prisma/Redis
   connections on `SIGTERM`, rather than being hard-killed.
5. If the health check never passes, Coolify does not cut traffic over —
   the previous container keeps serving.

No manual steps are required for a routine deploy beyond the migration
step, which is deliberately not automatic (see Section 5's reasoning).

---

## 5. Database & Prisma production workflow

This is the one area where "just run the dev command" would be actively
wrong, so it gets its own detailed section.

### What to use, and what never to use

| Command | Use in production? |
|---|---|
| `prisma migrate deploy` | **Yes — the only production path.** Applies pending migrations from `packages/database/prisma/migrations/`, in order, without generating new ones. |
| `prisma migrate dev` | **Never.** Interactive, generates new migrations, can prompt for destructive resets. Development only. |
| `prisma db push` | **Never.** Bypasses the migration history entirely; fine for local prototyping, dangerous and untracked in production. |
| `prisma:seed` (`packages/database/prisma/seed.ts`) | **Never against production data.** The script already self-guards (`throw`s immediately if `NODE_ENV=production`), which is a real safety net — but don't rely on that as the only line of defense; don't wire it into any production deploy hook in the first place. It seeds fixed development reference data (four hardcoded dev users, etc.), not something a real production database should ever receive. |

### How migrations actually run

The `api` Dockerfile's runtime image (`runner` stage) has its
devDependencies — including the Prisma CLI — deliberately pruned out (see
Section 6 of the review doc and the in-file comments). That means
migrations do **not** run inside the same container that serves traffic.
Instead, the Dockerfile's `builder` stage (before that pruning step) is
directly buildable and runnable as a one-off migration image:

```bash
docker build -f apps/api/Dockerfile --target builder -t acropora-api:migrate .
docker run --rm --env-file .env.production \
  acropora-api:migrate \
  pnpm --filter @acropora/database exec prisma migrate deploy
```

In Coolify, this is what the api application's **pre-deployment command**
should run — see `docs/COOLIFY.md` for exactly where that's configured.
Running it as a distinct pre-deployment step (rather than, say, on
container startup) means a migration failure blocks the deploy outright,
instead of the new container coming up against a half-migrated schema.

### Connection pooling

`DATABASE_URL` doesn't set an explicit pool size today. On a modest
Hetzner VM, with a single `api` replica, append
`&connection_limit=10&pool_timeout=10` (or a value sized to your Postgres
plan's `max_connections` and available CPU) rather than relying on
Prisma's default. This is a connection-string change, not a code change —
set it directly in the `DATABASE_URL` environment variable value.

### Rollback and schema changes

Prisma migrations are forward-only — there is no automatic `migrate
undo`. Two consequences worth planning for explicitly:

- **A bad application-code deploy** rolls back cleanly via Coolify (it
  keeps the previous image and can redeploy it), and doesn't need a
  database rollback if no migration shipped with it.
- **A bad schema migration** does not roll back automatically. The two
  practical options are: (a) write and ship a new, forward migration that
  reverses the change, or (b) restore from a pre-migration backup — which
  is why Section 6's "backup immediately before any migration you're
  unsure about" matters more than it might for a purely stateless
  deploy. For anything beyond an additive column/table change, prefer an
  expand/contract pattern (add the new shape, backfill, migrate reads,
  only then drop the old shape in a later migration) so a mid-rollout
  failure never leaves the schema in a state neither the old nor the new
  application code can use.

---

## 6. Backups & disaster recovery

- **Postgres:** nightly automated dump, retained on a rotation (e.g. 7
  daily + 4 weekly), stored off the Hetzner instance itself (Hetzner
  Object Storage or equivalent S3-compatible target) — a backup that
  lives on the same disk as the database it's backing up doesn't protect
  against instance loss. Coolify has built-in scheduled backups for
  managed Postgres resources; using that is simpler than hand-rolling a
  `pg_dump` cron job, though either works.
- **Restore drills are not optional.** A backup strategy is unproven until
  it's been restored at least once, deliberately, outside of an incident.
  Schedule one before go-live and periodically afterward.
- **Redis:** currently pure cache/health-check usage — nothing durable
  lives there today, so its backup priority is low. If it later becomes a
  session store (see the architecture review's Section 2A, option 2),
  revisit this: enable AOF persistence in production (already the default
  in the local `docker-compose.yml`) and back up its volume too.
- **Full disaster recovery** (total instance loss): redeploy from the
  GitHub repository via Coolify onto a fresh Hetzner instance, restore the
  latest Postgres backup, re-inject secrets from wherever they're stored
  outside Coolify (a password manager or equivalent — Coolify's own
  secret store should not be your only copy). Target RTO/RPO for this
  scenario haven't been formally agreed yet; worth doing once real users
  depend on the system.

---

## 7. Troubleshooting quick reference

| Symptom | Likely cause |
|---|---|
| `api` crash-loops immediately after a fresh deploy, before serving any traffic | Missing `UNAS_CREDENTIAL_ACTIVE_KEY_VERSION`/`UNAS_CREDENTIAL_MASTER_KEY_V<n>` or `UNAS_API_KEY` — see Section 3, step 3–4. |
| `api` fails at startup with a `DATABASE_URL` error instead of silently connecting to `localhost` | Expected and intentional (see `packages/database/prisma.config.ts`) — it means `DATABASE_URL` genuinely isn't set in the environment Coolify is passing through. |
| Migration step fails during deploy | Check it ran against the `builder`/`migrate` image target (Section 5), not the pruned runtime image, which has no Prisma CLI. |
| Duplicate UNAS/NAV sync activity, rate-limit errors from those APIs | Check `api` replica count — see Section 1's single-replica constraint. |
| `GET /health` returns 503 | Either Postgres or Redis is unreachable from the `api` container — check the response body, it reports which one and the connection latency/error. |
