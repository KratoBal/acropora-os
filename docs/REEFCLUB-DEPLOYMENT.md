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

| Setting                                                                                | Where                                                                           | What                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REEFCLUB_API_URL`                                                                     | **build argument** (baked in)                                                   | the ReefClub API container's internal address, for example `http://<container>:3002`; never the internal API                                                                                                                                                                                                                                                                              |
| `REEFCLUB_WEB_URL` (on the API)                                                        | the ReefClub API container                                                      | the public address of this web app; it is the only allowed origin and the base of the e-mail links                                                                                                                                                                                                                                                                                        |
| `REEFCLUB_GOOGLE_CLIENT_ID`, `REEFCLUB_APPLE_CLIENT_ID`, `REEFCLUB_APPLE_REDIRECT_URI` | the web container, **runtime** (read per request at `/config.json`, no rebuild) | the public client ids of the Google and Apple sign-in buttons (not secrets); an unset one hides that button. The Apple Return URL defaults to the site's own origin and must be registered for the Services ID; the Google web client must list the site as an authorized JavaScript origin. The same ids belong on the API as `REEFCLUB_GOOGLE_CLIENT_IDS` / `REEFCLUB_APPLE_CLIENT_IDS` |

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

| Name                                                                                                                                        | Required               | What                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REEFCLUB_PROCESS`                                                                                                                          | yes                    | `true`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `REEFCLUB_DATABASE_URL`                                                                                                                     | yes in production      | the database with the **ReefClub role** (below), never the internal `DATABASE_URL`                                                                                                                                                                                                                                                                                                                                                                   |
| `REEFCLUB_WEB_URL`                                                                                                                          | yes in production      | the ReefClub web address; the e-mail links point here, and it is the only allowed origin                                                                                                                                                                                                                                                                                                                                                             |
| `REEFCLUB_PORT`                                                                                                                             | no                     | default 3002                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `REEFCLUB_MAIL_CLIENT_ID`, `REEFCLUB_MAIL_CLIENT_SECRET`, `REEFCLUB_MAIL_REFRESH_TOKEN`, `REEFCLUB_MAIL_FROM`, `REEFCLUB_MAIL_FROM_NAME`    | for e-mail             | the ReefClub's own mailbox (`reefclub-mail.ts`)                                                                                                                                                                                                                                                                                                                                                                                                      |
| `REEFCLUB_SMTP_HOST`, `REEFCLUB_SMTP_PORT`, `REEFCLUB_SMTP_USER`, `REEFCLUB_SMTP_PASSWORD`, `REEFCLUB_MAIL_FROM`, `REEFCLUB_MAIL_FROM_NAME` | for e-mail (preferred) | the SMTP relay (Brevo, an acropora.hu sender, Balázs's decision): as soon as any `REEFCLUB_SMTP_*` name is set, this is the sender and the first five are all required (a half-set configuration stops the start, naming the missing names); port 587 requires STARTTLS, 465 is TLS from the start (`reefclub-smtp-mail.ts`)                                                                                                                         |
| `REEFCLUB_GOOGLE_CLIENT_IDS`, `REEFCLUB_APPLE_CLIENT_IDS`                                                                                   | for external sign-in   | our client ids                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `REEFCLUB_DIAG_CLIENT_ADDRESS_UNTIL`                                                                                                        | no                     | measurement only, OFF by default: an ISO time with a zone; while it is in the future AND at most two hours after the process started, `GET /rc/v1/health` shows the computed caller address and the `X-Forwarded-For` chain (addresses only). A missing, malformed, past or too distant value is closed (the start names a malformed or too distant one); a forgotten value expires by the clock, not by restarts. Every health answer is `no-store` |
| `REEFCLUB_TRUSTED_PROXY_HOPS`                                                                                                               | no                     | proxies in front that append to `X-Forwarded-For` (default 1); set from a measurement of the chain                                                                                                                                                                                                                                                                                                                                                   |

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

**The file is applied only together with the code redemption function** (migration
`20261021000000_reefclub_redeem_link_code`, `reefclub_redeem_link_code`): the role has no right on
the code table and inserts no links itself, so without the function the ReefClub could not redeem
a shop code at all. The file grants `EXECUTE` on the function, and with `ON_ERROR_STOP=1` that
`GRANT` stops the run if the migration is missing, so the order cannot silently be wrong: first
`prisma migrate deploy`, then this file.

The function runs with its owner's rights (SECURITY DEFINER), and its owner is whoever ran the
migrations. The file's last step hands it to the tables' owner if that was a superuser; changing an
owner needs a superuser or the current owner, so **if the migrations ran as a superuser, run this
file as a superuser too** (otherwise it stops at that step with Postgres's message). Check:
`SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE proname = 'reefclub_redeem_link_code';`

The writes are bound to rows as well: the file enables row-level security on six tables
(`Aquarium`, `AquariumMeasurement`, `AquariumMeasurementTarget`, `AquariumShareEvent`,
`ReefClubCustomerLink`, `ReefClubLinkCode`). The role writes only ReefClub aquariums and their
rows, ends links but never reopens them, and redeems codes only through the function above (it
cannot read a code). Every other role keeps exactly what its grants give it (a
permissive policy for all roles on each of the six), and the table owner (the internal API's
connection, the migrations) is not bound by row-level security at all. Applying the file
therefore needs the owner: `psql` with the internal `DATABASE_URL`, as above.

`reefclub-szerep.integration.spec.ts` runs every ReefClub flow on a role with exactly this file
applied, and checks that the forbidden tables and columns refuse, and that a shop aquarium, its
measurements and ranges, a link and a code cannot be written in the refused ways (each beside a
control of the same shape that succeeds). A new column the ReefClub uses without a line in the
file is a red test.

## The product dose list for the recommendation

The ReefClub role may not read the product tables, so it reads a PROJECTION of the product dose list
(`ReefClubDoseRow`, with `ReefClubDoseProjectionRun` as its run record). The role has `SELECT` only on
both (and on the run record only `id`, `status`, `finishedAt`, `rowCount`, not the error text). The
INTERNAL (OS) process rebuilds the projection COMPLETELY, in one transaction, with a SUCCEEDED run record
written in the same transaction (`dose-projection.service.ts`): after every change to the dose list, 30
seconds after a start, and every hour (the purchasability and the JEV change outside the list too). A
failed build changes nothing and leaves a FAILED record with its text. The projection's age is the last
SUCCESSFUL build (not a row's `updatedAt`); past 26 hours no dose is given from it.

`GET /products/dose-effects/projection` (the product view right) answers with the last success, the last
failure with its text, whether the failure is newer than the success, and whether the projection is stale:
the control panel reads this. A failing rebuilder shows there at once; the 26 hour limit is only the safety
net behind it.

## Account deletion

`DELETE /rc/v1/me` locks the account at once; the ReefClub process deletes it 30 days later, in
an hourly sweep (`reefclub-account-deletion.service.ts`). The sweep runs in every ReefClub
process; two at once delete each account once (the delete re-reads its condition).
