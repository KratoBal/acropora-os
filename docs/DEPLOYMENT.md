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

| Service         | Dockerfile            | Build context | Port | Health check  |
| --------------- | --------------------- | ------------- | ---- | ------------- |
| `web` (Next.js) | `apps/web/Dockerfile` | repo root     | 3000 | `GET /`       |
| `api` (NestJS)  | `apps/api/Dockerfile` | repo root     | 3001 | `GET /health` |

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
2. For `api`: the new container's own entrypoint runs `prisma migrate
deploy` against the production database as the first thing it does,
   before the API process starts — see Section 5. (If you've also kept a
   Coolify pre-deployment command configured, that runs even earlier, as
   an additional gate — but the entrypoint is what actually protects you
   even if that command is missing or misconfigured.)
3. Starts the new container, waits for `HEALTHCHECK` to pass — which now
   also implicitly waits for the entrypoint's migration step to finish.
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

| Command                                            | Use in production?                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate deploy`                            | **Yes — the only production path.** Applies pending migrations from `packages/database/prisma/migrations/`, in order, without generating new ones.                                                                                                                                                                                                                                                              |
| `prisma migrate dev`                               | **Never.** Interactive, generates new migrations, can prompt for destructive resets. Development only.                                                                                                                                                                                                                                                                                                          |
| `prisma db push`                                   | **Never.** Bypasses the migration history entirely; fine for local prototyping, dangerous and untracked in production.                                                                                                                                                                                                                                                                                          |
| `prisma:seed` (`packages/database/prisma/seed.ts`) | **Never against production data.** The script already self-guards (`throw`s immediately if `NODE_ENV=production`), which is a real safety net — but don't rely on that as the only line of defense; don't wire it into any production deploy hook in the first place. It seeds fixed development reference data (four hardcoded dev users, etc.), not something a real production database should ever receive. |

### How migrations actually run

As of the fix for the 2026-07-27 `P2022: SalesOrder.unasInvoiceStatus does
not exist` incident, migrations run **inside the same container that
serves traffic**, as the first thing that container does, before it ever
starts the API process:

- `apps/api/Dockerfile`'s `runner` stage carries the Prisma CLI (moved into
  `packages/database/package.json`'s `dependencies` specifically for this,
  so `pnpm deploy --prod` keeps it), `schema.prisma`, and the full
  `migrations/` directory — `schema.prisma`/`migrations/` arrive there for
  free (they're just part of `@acropora/database`'s own directory, copied
  wholesale like any other injected workspace dependency); the CLI needed
  the explicit dependency move.
- The image's `ENTRYPOINT` is `apps/api/docker-entrypoint.sh`, which runs
  `apps/api/docker-entrypoint-migrate.cjs` — this resolves the CLI and
  schema paths via Node's own module resolution (never a hardcoded
  `node_modules/.pnpm/...` path, since those are version-string-derived
  and not stable across dependency bumps), then runs `prisma migrate
deploy` (never `db push`). If that exits non-zero, the entrypoint exits
  non-zero too — `node dist/main.js` is never `exec`'d, the container never
  comes up, and Docker's `HEALTHCHECK` never turns green, so Coolify never
  cuts traffic over to it.

The previous design — a _separate_, one-off `builder`-target "migrator"
image, triggered by a Coolify **pre-deployment command** the operator
configures by hand outside version control — is still available (see the
`builder` stage's own comments in the Dockerfile) and still useful as an
earlier, out-of-band gate if you want one, but it is no longer the only
thing standing between a schema change and a broken production `api`
container. That gap — the pre-deployment command silently not being
configured, or not actually blocking a bad deploy — is the most likely
root cause of the 2026-07-27 incident itself, which is exactly what this
change is defense-in-depth against. If you do keep using the
pre-deployment command, it still runs as documented in `docs/COOLIFY.md`:

```bash
docker build -f apps/api/Dockerfile --target builder -t acropora-api:migrate .
docker run --rm --env-file .env.production \
  acropora-api:migrate \
  pnpm --filter @acropora/database exec prisma migrate deploy
```

### Verifying the image before trusting it in production

Three independent checks, none of which mutate anything or require the
other two to pass first:

```bash
# 1. Build-time: fails the Docker build itself if schema.prisma, migrations/,
#    or the Prisma CLI didn't make it into the deployed tree. Runs
#    automatically as part of `docker build` — see the "deployed" stage.

# 2. Runtime, no database needed: confirms the CLI/schema/migrations
#    resolve correctly *inside the actual built image*, without touching
#    DATABASE_URL at all.
docker run --rm acropora-api node docker-entrypoint-migrate.cjs --check

# 3. Runtime, against a real (e.g. staging) database, read-only: runs
#    `prisma migrate status` — never mutates anything, safe to run
#    repeatedly.
docker run --rm --env DATABASE_URL=<staging_url> acropora-api \
  node docker-entrypoint-migrate.cjs --status
```

Check 2 and 3 are deliberately separate commands: 2 proves the image is
built correctly regardless of database reachability; 3 proves the CLI can
actually talk to a real database once pointed at one. Neither one runs
`migrate deploy` — the entrypoint itself is the only thing that does that,
and only against the real production `DATABASE_URL`, on real container
startup.

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

| Symptom                                                                                          | Likely cause                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api` crash-loops immediately after a fresh deploy, before serving any traffic                   | Missing `UNAS_CREDENTIAL_ACTIVE_KEY_VERSION`/`UNAS_CREDENTIAL_MASTER_KEY_V<n>` or `UNAS_API_KEY` — see Section 3, step 3–4.                                                                                                                                                                               |
| `api` fails at startup with a `DATABASE_URL` error instead of silently connecting to `localhost` | Expected and intentional (see `packages/database/prisma.config.ts`) — it means `DATABASE_URL` genuinely isn't set in the environment Coolify is passing through.                                                                                                                                          |
| Migration step fails during deploy                                                               | The `api` container itself will refuse to start (its entrypoint exits non-zero before `node dist/main.js` runs) — check that container's logs first, not a separate migrator image. See Section 5. If you're still also running the optional `builder`/`migrate` pre-deployment step, check that ran too. |
| `api` never becomes healthy, logs show `prisma migrate deploy` output but nothing from Nest      | Expected while migrations are still applying — `HEALTHCHECK`'s `--start-period` needs to cover however long your migration step takes, not just Nest's own boot time.                                                                                                                                     |
| Duplicate UNAS/NAV sync activity, rate-limit errors from those APIs                              | Check `api` replica count — see Section 1's single-replica constraint.                                                                                                                                                                                                                                    |
| `GET /health` returns 503                                                                        | Either Postgres or Redis is unreachable from the `api` container — check the response body, it reports which one and the connection latency/error.                                                                                                                                                        |
