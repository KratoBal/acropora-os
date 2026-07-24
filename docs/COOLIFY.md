# Coolify Configuration Reference

Field-by-field Coolify setup for Acropora OS's two applications (`web`,
`api`) plus the Postgres/Redis resources they depend on. For the reasoning
and the end-to-end process this plugs into, see
[`docs/DEPLOYMENT.md`](./DEPLOYMENT.md).

This assumes Coolify's GitHub App integration, connected to
`KratoBal/acropora-os`, and Coolify's own Docker Engine on a Hetzner Cloud
server.

---

## Applications

Create **two separate Coolify applications** from the same GitHub
repository — do not try to deploy both from one application definition,
since they have different Dockerfiles, ports, and health checks.

### `acropora-api`

| Setting | Value |
|---|---|
| Source | `KratoBal/acropora-os`, branch `main` (or your chosen deploy branch) |
| Build pack | Dockerfile |
| **Build context** | Repository root (`/`) — required, not `apps/api/`. The Dockerfile does `turbo prune` against the whole monorepo and needs the full workspace as its build context. |
| **Dockerfile path** | `apps/api/Dockerfile` |
| Dockerfile build target | *(default — last stage, `runner`)*. Do not set this to `builder`; that's the separate migration image, see "Pre-deployment command" below. |
| **Port** | Container port `3001`. Map to whatever public/internal port your setup needs; if `api` isn't meant to be publicly reachable, don't attach a domain — only `web`'s rewrite and any direct integration/webhook callers need it. |
| **Health check** | HTTP `GET /health` on port `3001`. A Dockerfile `HEALTHCHECK` already exists; also configure Coolify's own health check to the same path so Coolify's rolling-deploy gate uses it too. Expect `200` when Postgres and Redis are both reachable, `503` otherwise — treat 503 as unhealthy, not as "starting up" (the response body distinguishes real outages from startup timing if you need to debug). |

### `acropora-web`

| Setting | Value |
|---|---|
| Source | Same repository, same branch |
| Build pack | Dockerfile |
| **Build context** | Repository root (`/`) |
| **Dockerfile path** | `apps/web/Dockerfile` |
| Dockerfile build target | *(default — last stage, `runner`)* |
| **Port** | Container port `3000` |
| **Health check** | HTTP `GET /` on port `3000`. This is liveness only (does the Next.js server respond at all), not a real dependency check — `api`'s `/health` is where actual Postgres/Redis status lives. A future improvement worth scheduling: a dedicated `/api/health` route in the web app that also checks `API_URL` reachability (a small code addition, not something to add unreviewed as part of this infra work). |

---

## Environment variables

Set these as Coolify environment variables on each application (not as a
committed file). Full documentation of every variable, with
Required/Optional/Secret/Reserved categorization, is in
[`.env.production.example`](../.env.production.example) — this section
only covers where each group of variables goes.

- **`acropora-api`** gets essentially everything in
  `.env.production.example`: `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`,
  `PORT`, `WEB_URL`, all `UNAS_*`, all `NAV_*`, `VIES_API_URL`,
  `MNB_API_URL`.
- **`acropora-web`** only needs `NODE_ENV=production` and `API_URL`
  (pointed at `acropora-api`'s internal Docker network address, e.g.
  `http://acropora-api:3001` — not the public domain, and not through
  TLS internally).
- Mark every credential (`UNAS_API_KEY`, `UNAS_CREDENTIAL_MASTER_KEY_V*`,
  all `NAV_TECHNICAL_USER_*`, `NAV_SOFTWARE_DEV_TAX_NUMBER`) as a
  Coolify **secret**, not a plain environment variable, so it's masked in
  the UI and build logs.
- If `web` ever gains `NEXT_PUBLIC_*` variables, they must be passed as
  Docker **build arguments**, not runtime environment variables — Next.js
  inlines them into the client bundle at build time. `apps/web/Dockerfile`
  has a comment marking where that plumbing would go; none exist yet, so
  there's nothing to configure today.

---

## Health checks

Both Dockerfiles already define a `HEALTHCHECK` instruction
(`docker inspect` will show container-level health independent of
Coolify). Configure Coolify's application-level health check to match, so
Coolify's own rolling-deploy gate — not just Docker's — waits for a real
green signal before cutting traffic over:

- `acropora-api`: `GET http://localhost:3001/health`, expect `200`.
- `acropora-web`: `GET http://localhost:3000/`, expect `200`.

---

## Deployment order

1. **Postgres and Redis resources** must exist and be healthy before the
   first `api` deploy. Provision these as Coolify-managed resources (see
   "Persistent volumes" below) or point at externally-managed instances.
2. **Run `prisma migrate deploy`** via the pre-deployment command (next
   section) — before the new `api` container starts receiving traffic,
   every time, not just on first boot.
3. **Deploy `acropora-api`**, confirm `GET /health` is green.
4. **Deploy `acropora-web`** only after `api` is healthy and reachable at
   the `API_URL` you configured.
5. For routine subsequent deploys, both applications can redeploy
   independently — `web` has no dependency ordering requirement on `api`
   beyond "api should already exist," since `web`'s rewrite just proxies
   requests at request time.

### Pre-deployment command (api only)

Configure `acropora-api`'s **pre-deployment command** (Coolify's hook that
runs before the new container takes traffic) to run migrations against the
*build*-stage image, not the pruned runtime image — the runtime image has
its devDependencies, including the Prisma CLI, deliberately stripped out.
See `docs/DEPLOYMENT.md` Section 5 for the full reasoning; the command
itself:

```bash
docker build -f apps/api/Dockerfile --target builder -t acropora-api:migrate .
docker run --rm --env-file .env.production \
  acropora-api:migrate \
  pnpm --filter @acropora/database exec prisma migrate deploy
```

If Coolify's pre-deployment command runs inside the already-built image
for that deploy rather than needing its own separate `docker build`,
adjust accordingly — the essential requirement is: run
`prisma migrate deploy` using an image that still has the Prisma CLI
(the `builder` target), against the same `DATABASE_URL` the new `api`
container will use, and block the deploy if it fails.

---

## Persistent volumes

| Volume | Attached to | Notes |
|---|---|---|
| Postgres data directory | Postgres resource | Use Coolify's managed Postgres resource type for this rather than a hand-rolled volume where practical — it comes with built-in scheduled backups and simpler upgrade handling. |
| Redis data directory (`appendonly yes`) | Redis resource | Low priority today (cache/health-check only — see `docs/DEPLOYMENT.md` Section 6); becomes important if Redis is later used for session storage. |

**Neither `web` nor `api` needs a persistent volume.** Both are stateless
by design — `web` serves only its build output, `api` holds no local
state outside the database and (currently) in-memory session storage,
which is itself a documented limitation, not something a volume would
fix (see the architecture review, Section 2A/2B).

Postgres and Redis must **not** be exposed on public ports — the local
`docker-compose.yml` does this (`5432`/`6379` published to the host) for
development convenience only; do not replicate that in Coolify's network
configuration for either resource.

---

## Rollback strategy

- **Application-code-only deploy:** Coolify retains the previous image;
  redeploying it rolls back cleanly, no database involvement needed.
- **Deploy that included a schema migration:** Prisma migrations are
  forward-only — there is no automatic `migrate undo`. Rolling the
  container image back does **not** roll the schema back. Either:
  1. Ship a new, forward migration that reverses the problematic change, or
  2. Restore the database from the pre-migration backup (see
     `docs/DEPLOYMENT.md` Section 6) — appropriate for genuinely
     destructive migrations, not routine ones.
- **Before any migration you're not fully confident in**, take an
  on-demand backup immediately beforehand, in addition to the regular
  nightly schedule — cheap insurance against the one case where rollback
  isn't just "redeploy the old image."
- **`web` rollback** is always just a redeploy of the previous image — it
  holds no state, so there's no equivalent complication.
