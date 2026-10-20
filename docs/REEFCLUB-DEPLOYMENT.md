# ReefClub deployment

How the ReefClub API runs next to the internal API (ReefClub plan v6.1, 2.1; slice 6). This page
describes the shape; setting it up in an environment is a separate, approved deployment step.

## One image, two processes

The `apps/api` image starts either process:

| Container    | Environment              | Starts                  | Migrations                                                         |
| ------------ | ------------------------ | ----------------------- | ------------------------------------------------------------------ |
| internal API | `REEFCLUB_PROCESS` unset | `dist/main.js`          | yes, before the start (`docker-entrypoint.sh`)                     |
| ReefClub API | `REEFCLUB_PROCESS=true`  | `dist/main-reefclub.js` | **no**: its role may not run them, and the internal container does |

Any other `REEFCLUB_PROCESS` value stops the container (`docker-entrypoint.sh`, measured in
`src/docker-entrypoint.spec.ts`): a mistyped value on the public container must not start the
internal API there.

The ReefClub process loads only the ReefClub module: it serves `/rc/v1/*` and nothing else (no
internal controller is in the process, `reefclub-app.spec.ts`). Its health check is
`GET /rc/v1/health` on `REEFCLUB_PORT` (default 3002); the image's `HEALTHCHECK` follows
`REEFCLUB_PROCESS`.

## The gateway

The public host (for example `reefclub.acropora.hu`'s API path) routes **only to the ReefClub
container**. The internal API is never behind the public host, so even a gateway rule that
forwards every path cannot reach an internal route: the process behind it has none (acceptance
7.7). The ReefClub web application (slice 9) calls `/rc/v1/*` on that host.

## The web application (slice 9)

`apps/reefclub` is its own Next application and image (`apps/reefclub/Dockerfile`, port 3003, built
in the CI matrix like `api`, `web` and `partner`). The browser only talks to its own host:
the app forwards **exactly `/rc/v1/*`** to the ReefClub API container and serves everything else
itself. The `__Host-` cookies are bound to that one host, and the CSRF double submit reads the
CSRF cookie from the page, so the page and the answers must share the host
(`apps/api/src/reefclub/reefclub-cookies.ts`).

| Setting                         | Where                         | What                                                                                                         |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `REEFCLUB_API_URL`              | **build argument** (baked in) | the ReefClub API container's internal address, for example `http://<container>:3002`; never the internal API |
| `REEFCLUB_WEB_URL` (on the API) | the ReefClub API container    | the public address of this web app; it is the only allowed origin and the base of the e-mail links           |

**The web application is one more proxy in front of the API** (barracuda, #1733 review). Next's
external rewrite runs as a proxy and appends the address of its own incoming connection to
`X-Forwarded-For`, so the chain is gateway, this app, ReefClub API. With
`REEFCLUB_TRUSTED_PROXY_HOPS` left at its default 1, the API would see every customer as the
gateway's (or this container's) address, and the per-address limits (sign-in, registration, the
shop code's 20-an-hour lock) would all hit one shared address: one person's twenty wrong codes
would lock everyone out. **Set the value at deployment from a measurement, not from this page:**
send one request through the test host and read the client address in the ReefClub API's log; the
value is the number of proxies between the client and the API that append to the header (the
gateway and this app, so probably 2, which is not measured here).

Next stores the rewrite at build time, so a changed `REEFCLUB_API_URL` needs a rebuild. Setting
the resource up in an environment (domain, Coolify resource, the API container with the
`reefclub_app` role) is a separate, approved deployment step.

## Environment of the ReefClub container

Only `REEFCLUB_`-prefixed settings, and none of the internal API's secrets: the process stops at
start if one is present (`reefclub-environment.ts`, plan 2.1).

| Name                                                                                                                                     | Required             | What                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `REEFCLUB_PROCESS`                                                                                                                       | yes                  | `true`                                                                                             |
| `REEFCLUB_DATABASE_URL`                                                                                                                  | yes in production    | the database with the **ReefClub role** (below), never the internal `DATABASE_URL`                 |
| `REEFCLUB_WEB_URL`                                                                                                                       | yes in production    | the ReefClub web address; the e-mail links point here, and it is the only allowed origin           |
| `REEFCLUB_PORT`                                                                                                                          | no                   | default 3002                                                                                       |
| `REEFCLUB_MAIL_CLIENT_ID`, `REEFCLUB_MAIL_CLIENT_SECRET`, `REEFCLUB_MAIL_REFRESH_TOKEN`, `REEFCLUB_MAIL_FROM`, `REEFCLUB_MAIL_FROM_NAME` | for e-mail           | the ReefClub's own mailbox (`reefclub-mail.ts`)                                                    |
| `REEFCLUB_GOOGLE_CLIENT_IDS`, `REEFCLUB_APPLE_CLIENT_IDS`                                                                                | for external sign-in | our client ids                                                                                     |
| `REEFCLUB_TRUSTED_PROXY_HOPS`                                                                                                            | no                   | proxies in front that append to `X-Forwarded-For` (default 1); set from a measurement of the chain |

## The database role

`packages/database/sql/reefclub-role.sql` grants the ReefClub role exactly what the process
uses: its own tables, the own-aquarium side of the aquarium tables, and four columns of the
customer. Invoices, worksheets, products, internal users, the customer's phone and e-mail and the
aquarium's internal columns are not readable. Applying it, once per environment, after
`prisma migrate deploy`:

```bash
# the role, once (its password is a secret of the environment)
psql "$DATABASE_URL" -c "CREATE ROLE \"reefclub_app\" LOGIN PASSWORD '...'"
# the grants, after every migration that adds a ReefClub table or column (idempotent)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/reefclub-role.sql
```

`reefclub-szerep.integration.spec.ts` runs every ReefClub flow on a role with exactly this file
applied, and checks that the forbidden tables and columns refuse. A new column the ReefClub uses
without a line in the file is a red test.

## Account deletion

`DELETE /rc/v1/me` locks the account at once; the ReefClub process deletes it 30 days later, in
an hourly sweep (`reefclub-account-deletion.service.ts`). The sweep runs in every ReefClub
process; two at once delete each account once (the delete re-reads its condition).
