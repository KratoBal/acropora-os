# Hetzner/Coolify mobile staging

## Goal

Provide an HTTPS API for development and preview builds without allowing
mobile work to mutate or destabilize Acropora OS production.

The existing production project, containers, database, Redis and `main`
deployment remain unchanged. Staging is a separate Coolify project using
separate resources, secrets, volumes and domain names.

## Target topology

| Resource                  | Staging requirement                                      |
| ------------------------- | -------------------------------------------------------- |
| Coolify project           | `acropora-staging`                                       |
| API application           | `acropora-api-staging`                                   |
| Source                    | `KratoBal/acropora-os`, dedicated feature/staging branch |
| Build context             | repository root `/`                                      |
| Dockerfile                | `apps/api/Dockerfile`                                    |
| Port/health               | `3001`, `GET /health`                                    |
| Replica count             | exactly 1                                                |
| PostgreSQL                | dedicated PostgreSQL 16 resource and volume              |
| Redis                     | dedicated Redis 7 resource and volume                    |
| Public endpoint           | HTTPS subdomain such as `api-staging.acropora.hu`        |
| Access before mobile auth | Tailscale/VPN or strict IP allowlist                     |

Do not attach the production Postgres or Redis resource to the staging API.
Do not expose either datastore on a public host port.

## Capacity check before provisioning

Run these read-only checks on the Hetzner host or use the equivalent Coolify
screens:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker stats --no-stream
df -h
free -h
docker system df
```

Provision on the existing server only if normal production headroom remains
after adding one API container, PostgreSQL and Redis. If memory or disk is
already constrained, create a small separate Hetzner staging VM instead of
competing with production.

## Coolify application settings

Create a new project and resources; do not duplicate by reconnecting the
production database.

For `acropora-api-staging`:

| Setting         | Value                           |
| --------------- | ------------------------------- |
| Build pack      | Dockerfile                      |
| Build context   | `/`                             |
| Dockerfile path | `apps/api/Dockerfile`           |
| Container port  | `3001`                          |
| Health path     | `/health`                       |
| Auto deploy     | feature/staging branch only     |
| Domain          | chosen HTTPS staging API domain |
| Replicas        | `1`                             |

The API image runs `prisma migrate deploy` in its entrypoint. Never configure
`prisma migrate dev`, `prisma db push` or seed execution for staging
deployment.

## Environment

Use [`.env.staging.example`](../.env.staging.example) as the inventory, then
enter real values in Coolify. Do not upload or commit a filled environment
file.

Critical rules:

- use a generated staging database password;
- use a separate UNAS key if UNAS access is required;
- keep all UNAS and NAV schedulers disabled initially;
- never reuse production NAV/UNAS secrets for developer convenience;
- generate a distinct `UNAS_CREDENTIAL_MASTER_KEY_V1`;
- mark every credential as a Coolify secret;
- keep `NODE_ENV=production` so development authentication and production
  safeguards cannot be bypassed;
- configure nightly Postgres backups plus an on-demand backup before every
  migration-bearing preview.

The current production startup validator requires valid UNAS credential
configuration even while scheduled sync is disabled. Staging therefore needs
a deliberately provisioned staging credential, or a separately reviewed code
change to make that validator feature-aware. Never work around this with a
production secret copied into a developer file.

## Data policy

Start with an empty migrated schema and purpose-built staging users/data. If
realistic data becomes necessary, use an explicitly anonymized export:

- remove personal names, emails, phone numbers and addresses;
- replace document attachments and signatures;
- remove API credentials and integration cursor state;
- disable outbound notifications and invoice operations;
- document who produced the snapshot and when it expires.

No production database clone may be mounted directly into staging.

## Deployment order

1. Confirm server capacity and a recent production backup.
2. Create the staging Coolify project.
3. Create staging Postgres 16 and Redis 7 resources.
4. Configure internal-only resource networking.
5. Add the API application from the chosen branch.
6. Add environment values from `.env.staging.example`.
7. Deploy the API and wait for its migration entrypoint.
8. Verify `/health` returns `200`.
9. Create the DNS record and enable Traefik TLS.
10. Apply Tailscale/VPN or IP access control.
11. Set the EAS preview `EXPO_PUBLIC_API_URL` to the HTTPS endpoint.
12. Verify from a real phone while production remains untouched.

## Read-only acceptance checks

```bash
curl --fail --silent --show-error https://<staging-api-domain>/health
docker ps --filter name=acropora-api-staging
docker logs --tail 100 <staging-api-container>
```

In Coolify also confirm:

- the API is built from the expected branch and commit;
- the health check is green;
- Postgres and Redis show dedicated staging volumes;
- no database port is public;
- automatic backups have succeeded at least once;
- production applications still reference `main` and their original resources.

## Preconditions for the actual server change

Repository preparation can be completed without touching production. Applying
this plan to Hetzner additionally requires:

- Coolify access;
- DNS access for the selected staging subdomain;
- a decision whether staging stays on the current VM or gets its own VM;
- a staging-specific UNAS credential or an approved validator change;
- the Expo organization/project that will own the mobile builds.
