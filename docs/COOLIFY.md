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

| Setting                 | Value                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source                  | `KratoBal/acropora-os`, branch `main` (or your chosen deploy branch)                                                                                                                                                                                                                                                                                                                                    |
| Build pack              | Dockerfile                                                                                                                                                                                                                                                                                                                                                                                              |
| **Build context**       | Repository root (`/`) — required, not `apps/api/`. The Dockerfile does `turbo prune` against the whole monorepo and needs the full workspace as its build context.                                                                                                                                                                                                                                      |
| **Dockerfile path**     | `apps/api/Dockerfile`                                                                                                                                                                                                                                                                                                                                                                                   |
| Dockerfile build target | _(default — last stage, `runner`)_. Do not set this to `builder`; that's the separate migration image, see "Pre-deployment command" below.                                                                                                                                                                                                                                                              |
| **Port**                | Container port `3001`. Map to whatever public/internal port your setup needs; if `api` isn't meant to be publicly reachable, don't attach a domain — only `web`'s rewrite and any direct integration/webhook callers need it.                                                                                                                                                                           |
| **Health check**        | HTTP `GET /health` on port `3001`. A Dockerfile `HEALTHCHECK` already exists; also configure Coolify's own health check to the same path so Coolify's rolling-deploy gate uses it too. Expect `200` when Postgres and Redis are both reachable, `503` otherwise — treat 503 as unhealthy, not as "starting up" (the response body distinguishes real outages from startup timing if you need to debug). |

### `acropora-web`

| Setting                 | Value                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source                  | Same repository, same branch                                                                                                                                                                                                                                                                                                                                                                                 |
| Build pack              | Dockerfile                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Build context**       | Repository root (`/`)                                                                                                                                                                                                                                                                                                                                                                                        |
| **Dockerfile path**     | `apps/web/Dockerfile`                                                                                                                                                                                                                                                                                                                                                                                        |
| Dockerfile build target | _(default — last stage, `runner`)_                                                                                                                                                                                                                                                                                                                                                                           |
| **Port**                | Container port `3000`                                                                                                                                                                                                                                                                                                                                                                                        |
| **Health check**        | HTTP `GET /` on port `3000`. This is liveness only (does the Next.js server respond at all), not a real dependency check — `api`'s `/health` is where actual Postgres/Redis status lives. A future improvement worth scheduling: a dedicated `/api/health` route in the web app that also checks `API_URL` reachability (a small code addition, not something to add unreviewed as part of this infra work). |

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
  `NAV_CREDENTIAL_MASTER_KEY_V*`, all `NAV_TECHNICAL_USER_*`,
  `NAV_SOFTWARE_DEV_TAX_NUMBER`) as a Coolify **secret**, not a plain
  environment variable, so it's masked in the UI and build logs.
- If `web` ever gains `NEXT_PUBLIC_*` variables, they must be passed as
  Docker **build arguments**, not runtime environment variables — Next.js
  inlines them into the client bundle at build time. `apps/web/Dockerfile`
  has a comment marking where that plumbing would go; none exist yet, so
  there's nothing to configure today.

### `RELEASE_COMMIT_SHA` — how the running image reports its own commit

`GET /health` returns a `commit` field so a deploy can be identified without
guessing. It is empty unless this one variable is set:

| Variable             | Value              | Kind                      |
| -------------------- | ------------------ | ------------------------- |
| `RELEASE_COMMIT_SHA` | `${SOURCE_COMMIT}` | runtime, **not** a secret |

`SOURCE_COMMIT` is substituted by Coolify at deploy time with the full
40-character commit the deploy was built from. **No Docker build argument is
needed.** `apps/api/Dockerfile` also accepts `RELEASE_COMMIT_SHA` as a build
arg and bakes it in as a default `ENV`, but a runtime variable overrides that,
so the runtime route is the simpler one and the only one configured here.

Measured on the staging stack on 2026-08-29, because none of this is obvious
from the outside:

- **Both `${SOURCE_COMMIT}` and `$SOURCE_COMMIT` work** — the substitution is
  shell-shaped, not template-shaped.
- **An unknown name resolves to EMPTY, not to the literal text.** A typo here
  therefore leaves no visible trace in the container's environment: nothing
  says `${SOMETHING}`, there is simply no value. Do not expect a mistake to
  announce itself.
- The empty case is nevertheless the **safe** direction:
  `currentReleaseCommitSha()` treats an empty value exactly like an unset one
  and returns `null`, so `/health` reports "not configured" rather than
  validating a release against a wrong hash.

**Never type a commit here by hand.** A stale 40-character hash is worse than
no value at all: `null` means "cannot be verified", while a wrong hash means
"verified" — against the wrong release. Only a value the platform substitutes
per deploy is acceptable.

**Scope:** this is configured on **staging**. Production deploys are a separate
stack, and as of **2026-08-31 it is not configured there either**: production
`/health` answers `"commit": null`, which is exactly what an unset variable looks
like. Nothing in this repository can close that -- the Dockerfile accepts the
build arg, CI passes it and verifies it is baked in (checkpoint 8), and the code
reads the runtime variable. The one missing step is the variable on the
production application.

**And the test for it is NOT that the field stops being null.** A non-null value
only proves that _something_ was set. The measure is that the returned hash
**equals the commit the running image was built from** -- otherwise a release can
be "verified" against the wrong code. From inside the repository that equality
cannot be checked for production at all; it needs the deploy's own commit, which
lives in Coolify.

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
2. **`prisma migrate deploy` now runs automatically**, as part of the
   `api` container's own startup (its entrypoint), before the new
   container starts receiving traffic, every time, not just on first
   boot — no Coolify configuration required for this to happen. The
   optional pre-deployment command below is an extra, earlier gate if you
   want one, not a prerequisite.
3. **Deploy `acropora-api`**, confirm `GET /health` is green.
4. **Deploy `acropora-web`** only after `api` is healthy and reachable at
   the `API_URL` you configured.
5. For routine subsequent deploys, both applications can redeploy
   independently — `web` has no dependency ordering requirement on `api`
   beyond "api should already exist," since `web`'s rewrite just proxies
   requests at request time.

### Pre-deployment command (api only, optional)

`acropora-api`'s container now runs `prisma migrate deploy` itself, via
its own entrypoint, before starting the API — see `docs/DEPLOYMENT.md`
Section 5. **No Coolify configuration is required for that.** This
section is only for teams who additionally want migrations to run _before_
the new image even starts building/booting, as an earlier gate.

If you want that extra gate, configure `acropora-api`'s **pre-deployment
command** (Coolify's hook that runs before the new container takes
traffic) to run migrations against the _build_-stage image:

```bash
docker build -f apps/api/Dockerfile --target builder -t acropora-api:migrate .
docker run --rm --env-file .env.production \
  acropora-api:migrate \
  pnpm --filter @acropora/database exec prisma migrate deploy
```

If Coolify's pre-deployment command runs inside the already-built image
for that deploy rather than needing its own separate `docker build`,
adjust accordingly. Either way, do not treat this command as your only
protection against a missing migration — the entrypoint is what actually
guarantees it, since this command being missing, misconfigured, or not
actually blocking a failed deploy is the suspected root cause of the
2026-07-27 `P2022` incident this change fixes.

### Verifying the runtime image directly

Two read-only, non-mutating checks worth running against any freshly
built `acropora-api` image before trusting it, in addition to whatever
Coolify's own health check reports:

`--entrypoint node` is required on both, see the note below the block.

```bash
# No database needed - confirms schema.prisma, migrations/, and the
# Prisma CLI all resolve correctly inside this exact image.
docker run --rm --entrypoint node acropora-api \
  docker-entrypoint-migrate.cjs --check

# Needs a reachable DATABASE_URL (staging is fine) - read-only, never
# mutates the database.
docker run --rm --entrypoint node --env DATABASE_URL=<staging_url> acropora-api \
  docker-entrypoint-migrate.cjs --status
```

> **Why `--entrypoint node`.** The runner image's entrypoint is
> `docker-entrypoint.sh`, which **discards whatever command the container is
> given**: it applies migrations and then runs `exec node dist/main.js`, never
> referencing `"$@"`. Without the override these commands do not fail — they
> migrate and start the API, while the check you asked for never runs. The
> pre-deployment command further up needs no override because it uses the
> `acropora-api:migrate` **builder** image, which declares no entrypoint. Do not
> carry that form over to the runner image.
>
> Worth stating plainly, because the previous wording actively misled: these two
> are introduced as "read-only, non-mutating", and the second says "never mutates
> the database". Without `--entrypoint node` that is inverted — the entrypoint
> runs `prisma migrate deploy` against whatever `DATABASE_URL` was handed in. The
> commands did not merely fail to check anything; they did the opposite of what
> their own label promised.

---

## Persistent volumes

| Volume                                  | Attached to       | Notes                                                                                                                                                                           |
| --------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres data directory                 | Postgres resource | Use Coolify's managed Postgres resource type for this rather than a hand-rolled volume where practical — it comes with built-in scheduled backups and simpler upgrade handling. |
| Redis data directory (`appendonly yes`) | Redis resource    | Low priority today (cache/health-check only — see `docs/DEPLOYMENT.md` Section 6); becomes important if Redis is later used for session storage.                                |

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
