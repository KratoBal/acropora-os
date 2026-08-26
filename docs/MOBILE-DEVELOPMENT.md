# Mobile development environment

## Scope

`apps/mobile` is the React Native client colocated with Acropora OS field work.
The server workspace remains pnpm-based; the Expo app has an app-local npm
lockfile supported directly by EAS. This keeps its native dependency graph out
of the API/web Docker builds. The foundation deliberately contains
infrastructure, not field-service domain screens yet:

- Expo SDK 57 and Expo Router;
- development, preview and production application variants;
- TanStack Query for server state;
- SecureStore-backed bearer token storage;
- an SQLite/WAL offline queue table definition, not yet wired to anything
  (see [Offline boundary](#offline-boundary));
- network and push-notification native dependencies;
- an API health diagnostic screen;
- EAS development/preview/production profiles.

The first business increment built on this foundation is the Webshop Manager
workspace. It reuses the existing Acropora OS permissions and backend APIs for
orders, purchasing, products/inventory, NAV incoming invoices and suppliers.
The contractual field workflow now starts with the partner asset registry and
authenticated QR deep links (`docs/SERVICE-ASSET-MANAGEMENT.md`). Work orders,
aquarium maintenance and customer-facing ICP views remain later increments.

Az eszközmodul `expo-camera`, `expo-print` és `expo-sharing` natív modulokat
használ a QR-beolvasáshoz, valamint a 30×30 mm-es címke nyomtatásához és
gyártói nyomtatóapp felé továbbításához. E függőségek hozzáadása után új EAS
development/preview/production build szükséges; OTA frissítés önmagában nem
elég.

## Supported toolchain

- Node.js 22 or newer (the repository CI uses Node 22);
- pnpm 10.34.5 through Corepack;
- the npm version shipped with the selected Node version for `apps/mobile`;
- Docker and Docker Compose for local Postgres 16 and Redis 7;
- macOS and Xcode for local iOS simulator/native builds;
- Android Studio for Android emulator/native builds;
- a real iOS and Android device for release-relevant testing;
- an Expo account and Apple/Google developer accounts when signing starts.

Keep Node 22 as the team baseline even if a newer local Node works. Matching CI
removes avoidable native-tooling differences.

## Local bootstrap

```bash
corepack enable
corepack prepare pnpm@10.34.5 --activate
cp .env.example .env
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm install --frozen-lockfile
npm --prefix apps/mobile ci
pnpm infra:up
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
```

Start Metro in a second terminal:

```bash
pnpm dev:mobile
```

`pnpm dev` intentionally remains web + API only. This preserves the existing
backend workflow for contributors who are not working on the mobile client.
`pnpm dev:mobile` is a root-level convenience command that delegates to the
app-local npm scripts.

## Physical-device API connection

Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env.local`:

| Client           | Local API URL                  |
| ---------------- | ------------------------------ |
| iOS simulator    | `http://localhost:3001`        |
| Android emulator | `http://10.0.2.2:3001`         |
| Physical phone   | `http://<mac-lan-ip>:3001`     |
| Preview build    | `https://<staging-api-domain>` |

The local firewall must allow Node/NestJS traffic from the LAN. Do not disable
the firewall globally. Allow only the development process/network that is
needed.

All `EXPO_PUBLIC_*` values are embedded in the client bundle and must be
treated as public. API keys, database URLs, signing secrets and third-party
credentials never belong in the mobile environment.

## Development builds and EAS

Expo Go is useful only for quick UI experiments. The project uses an Expo
development client as its normal target because push notifications and future
native modules must be tested against a representative binary.

After the Expo organization/project is chosen:

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest build --platform ios --profile development
npx eas-cli@latest build --platform android --profile development
```

`eas init` adds the real EAS `projectId` to the Expo config. Commit that
identifier; it is not a secret. Do not invent it before the project exists.

Create the following non-secret variables in all three EAS environments:

| EAS environment | `EXPO_PUBLIC_APP_ENV` | `EXPO_PUBLIC_API_URL`               |
| --------------- | --------------------- | ----------------------------------- |
| development     | `development`         | local/LAN API used by the developer |
| preview         | `preview`             | HTTPS staging API                   |
| production      | `production`          | HTTPS production API                |

### Where those values actually live

The table above says what to create. This one says what is set today, and --
more importantly -- **where the value lives**. None of these URLs exist in the
repository: they are stored on the EAS side, per environment. Someone looking
for the preview API address in the source tree will not find it, and may
conclude it was never configured.

| EAS environment | Build profile | `EXPO_PUBLIC_API_URL`             | Where the value lives    |
| --------------- | ------------- | --------------------------------- | ------------------------ |
| development     | `development` | not set                           | -                        |
| preview         | `preview`     | `https://api-staging.acropora.hu` | EAS environment variable |
| production      | `production`  | `https://api.acropora.hu`         | EAS environment variable |

Read the current values back with:

```bash
cd apps/mobile
npx eas-cli@22 env:list preview      # or: development, production
```

Two things this table is not. It is not a source of truth -- the EAS side is,
and this page can go stale the moment someone changes a variable there. And an
empty cell means _measured as unset_, not _safe to ignore_: an EAS build in the
`development` environment has no API address at all, so the app stops at its own
configuration check on the device rather than silently calling the wrong host.

**Measured 2026-08-26, and worth keeping visible:** the `preview` environment
pointed at the **production** API (`https://api.acropora.hu`) until that day.
A preview build handed to a tester would have written to live data. The address
was changed to staging before any preview build went out; the finding is recorded
here because the failure was invisible from the repository -- exactly the reason
this section exists.

The build profiles set `APP_VARIANT` themselves. This produces separately
installable bundle identifiers:

- `hu.acropora.os.dev`;
- `hu.acropora.os.preview`;
- `hu.acropora.os`.

Final public application naming can be changed before store submission without
changing the architecture.

## Authentication boundary

Checkpoint 2 (mobile login UI) is complete: password login works end to end
against the already-merged backend endpoint `POST
/auth/mobile/login/password` (see `apps/api/src/auth/auth.controller.ts` and
`docs/AUTHENTICATION.md`). ServiceJob, the daily field task list and any other
domain feature are explicitly out of scope of this checkpoint and come later.

## Webshop Manager boundary

The first authenticated business slice is available after checkpoint 2:

- the home screen is filtered from the existing `UserRole` permission matrix;
- `SERVICE` does not enter the Webshop Manager workspace;
- `OWNER`, `ADMIN`, `MANAGER`, `SALES`, `WAREHOUSE` and `VIEWER` see only the
  webshop modules allowed by the matching server-side permissions;
- the orders module reads real data from
  `GET /integrations/unas/orders` and
  `GET /integrations/unas/orders/:id`;
- the dashboard shows the latest orders and the exact server-provided total;
- the order list is paginated and supports pull-to-refresh;
- the detail view shows customer, payment, shipping, totals, invoice mirror,
  current/historically removed lines and sync failures.

The mobile role mapping is only a presentation gate. The API remains the source
of truth and enforces `orders.view` (or the permission relevant to a later
module) on every request. The Expo app keeps a manual, tested mirror because its
isolated npm dependency boundary deliberately does not import the pnpm-managed
`@acropora/types` package.

Purchasing, products/inventory, NAV incoming invoices and suppliers already
appear as permission-filtered roadmap entries on the home screen. They remain
disabled until their own vertical slices add API clients, list/detail screens
and mutation safety rules. The current orders slice is read-only; order refresh
and general UNAS synchronization remain web-only management actions for now.

### Login flow

1. The login screen (`src/app/login.tsx`) collects e-mail + password and
   calls `loginWithPassword` (`src/lib/auth/api.ts`), which posts to
   `POST /auth/mobile/login/password` with `skipAuth: true` — this request
   deliberately never attaches a previously stored (possibly stale or
   invalid) `Authorization` header.
2. On success the server returns `{ token, expiresAt, user }`. The app
   validates the minimally required fields, saves `{ token, expiresAt }` to
   SecureStore (`src/lib/auth/token-store.ts`), and only then moves to the
   authenticated state. If the SecureStore write itself fails, the app
   invalidates the just-created server session (`POST /auth/logout` with
   that explicit token) and shows an error — it never leaves the app in a
   half-authenticated state.
3. Every authenticated request after that reads the token from SecureStore
   and sends it as `Authorization: Bearer <token>` (`src/lib/api/client.ts`).
   The mobile client never sets or reads a session or CSRF cookie — that
   double-submit-cookie mechanism only applies to the existing web
   cookie-based login (`POST /auth/login/password`), which this work does
   not change.

### Session restore on app start

On every app start (`AuthProvider`, `src/lib/auth/AuthProvider.tsx`):

1. read the stored `{ token, expiresAt }` from SecureStore;
2. no stored session -> show the login screen;
3. `expiresAt` already in the past -> discard the token locally without
   calling the server, then show the login screen (the token is opaque,
   never a JWT — the app performs no client-side decoding, only compares
   the server-issued `expiresAt` string);
4. otherwise call `GET /auth/me`:
   - success -> restore the user, show the authenticated home screen;
   - `401` -> the token is genuinely invalid server-side, discard it and
     show the login screen;
   - any other failure (no connectivity, timeout, 5xx) -> treat as
     transient: the token is **not** discarded, and the restoring screen
     shows a retryable "couldn't reach the server" state instead of
     bouncing to login.

While restore is in progress, the app shows only a dedicated "Munkamenet
ellenőrzése…" screen — the route stack (login/home) is not mounted at all
during this phase, so a valid session never causes a visible flash of the
login screen.

### Logout

`signOut` (`src/lib/auth/sign-out.ts`) always calls `POST /auth/logout`
first, then unconditionally clears the local SecureStore session — even if
the server call fails (network error, or the token was already invalid
server-side, e.g. 401). Accepted trade-off: if the logout request never
reaches the server, the device stops authenticating locally immediately,
but the server-side session row may keep existing until its own 8h TTL
elapses (or a future explicit admin revocation). Logout also clears the
entire React Query cache (`queryClient.clear()`) so no data scoped to the
signed-out user is visible after a different user logs in on the same
device.

### Token storage and security rules

- The Bearer token lives **only** in `expo-secure-store` (iOS Keychain /
  Android Keystore) — never in `AsyncStorage`, SQLite, or the React Query
  persist cache.
- The raw token is never logged, and never rendered in any error message
  or UI element. Login failures always show a fixed, generic Hungarian
  message ("Hibás e-mail cím vagy jelszó.") that does not reveal whether
  the e-mail or the password was wrong; a distinct message is shown for a
  network failure so the two are visually and behaviorally
  distinguishable.
- The token is opaque; the app does not implement its own JWT decoding or
  any client-side trust in the token's contents. The server (`/auth/me`)
  remains the final source of truth for whether a session is valid.
- Auth state machine (`src/lib/auth/auth-reducer.ts`,
  `restore-session.ts`, `sign-in.ts`, `sign-out.ts`) is plain,
  dependency-free TypeScript with no Expo/React Native imports, so it
  compiles and runs under plain `tsc` + `node --test`
  (`npm --prefix apps/mobile run test`) without a native runtime or a new
  test framework. `token-store.ts` (the actual `expo-secure-store` calls)
  and the React glue in `AuthProvider.tsx` are the native/React-dependent
  layer and are **not** covered by this automated suite — they need a real
  device/simulator or an Expo/RN-aware test runner (e.g. Detox or an
  RN-flavored Jest preset), neither of which exists in this repository
  today. Manual acceptance testing (below) is what currently covers that
  layer.

### Non-secret client configuration

`EXPO_PUBLIC_API_URL` (and every other `EXPO_PUBLIC_*` variable) is baked
into the client bundle and is public by construction — it must never hold a
production/staging secret, API key, signing credential or anything else
that needs to stay confidential. It only ever points at an API base URL.
For local development against a physical iPhone, set it to the Mac's LAN
IP address (see the physical-device table above), and make sure the Mac's
firewall allows inbound connections to the API's port from the LAN — do not
disable the firewall entirely, only allow the specific
Node/NestJS development process. Production and staging API URLs (or any
other secret) belong in the EAS environment configuration
(`eas.json`/EAS dashboard secrets), never in a value read through
`EXPO_PUBLIC_*` beyond a plain base URL.

## Offline boundary

`src/lib/offline/database.ts` defines an initializer that opens SQLite with WAL
and creates a durable `sync_queue` table — but **nothing calls it**, so the
database does not exist at runtime today. Every request goes straight to the
server, and `@react-native-community/netinfo` is a dependency that no source
file imports, so the client cannot currently tell whether it is offline at all.
Treat the table shape as a starting point, not as a working layer.

Domain work will add task-specific tables and an idempotent sync protocol. The
rules for that protocol are:

- server IDs plus client-generated operation IDs;
- explicit pending/syncing/failed/conflict states;
- retry only idempotent operations automatically;
- never accept or sign a document entirely offline;
- signatures and document versions are server-confirmed actions;
- preserve local evidence until the server acknowledges it;
- show unresolved conflicts to the colleague instead of silently overwriting.

## Push notification boundary

`expo-notifications` is installed as a dependency and as a config plugin, but
no source file imports it: there is no token request, no handler, nothing.
Registration is intentionally not started automatically.

### Standing requirement

**Every mobile work item from now on includes the push permission request in
the first-launch flow**, the same way the biometric gate does. This is a
condition on new work, not a task of its own.

### Notifications the product needs

Two, both tied to the worksheet:

1. **On assignment**, to the responsible colleague: "you have a new worksheet".
2. **On closing**, to the owner.

Neither can be built yet: the `Worksheet` model has `createdById` but **no
responsible/assignee field**, so "assign it to someone" is a missing feature
rather than a missing screen. The order is: field and migration, an endpoint to
assign, the web UI to create a worksheet and assign it (no component under
`apps/web` reads worksheets today), and only then is there anything to notify
about.

### Delivery route: our own server, direct to APNs

This is decided, and it is not the only possible route, so it is written down:
the server holds the APNs key and talks to Apple directly. It does **not** go
through Expo's push service, and the credentials are **not** uploaded to EAS.

The client-side consequence is easy to get wrong and fails silently: the app
must request the **native device token**, not an Expo push token. The two calls
have similar names, the tokens are not interchangeable, and sending an Expo
token to Apple does not raise an error — it simply never arrives.

`acropora-api` reads five environment variables, all Coolify **secrets**:

| Variable                  | Value                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `APNS_KEY_ID`             | from the key filename, `AuthKey_XXXXXXXXXX.p8`                                       |
| `APNS_TEAM_ID`            | `9B88PTQUQY` (matches `submit.production.ios.appleTeamId` in `apps/mobile/eas.json`) |
| `APNS_BUNDLE_ID`          | `hu.acropora.os` (the production variant in `apps/mobile/app.config.js`)             |
| `APNS_PRIVATE_KEY_BASE64` | the `.p8` contents, base64 encoded because it is multi-line                          |
| `APNS_ENVIRONMENT`        | `production`                                                                         |

Two consequences of those values that cost time if discovered late:

- **TestFlight builds use the production APNs endpoint**, not the sandbox. The
  sandbox only serves apps installed from a development build. With
  `APNS_ENVIRONMENT=production`, push cannot be tested on a development build
  at all — the first working test needs a TestFlight build.
- **A push token belongs to one bundle ID.** `hu.acropora.os.dev` and
  `hu.acropora.os.preview` produce a different set of tokens. Whatever stores
  device tokens should record the bundle alongside the platform; otherwise a
  token from a development build is indistinguishable from a production one and
  the send disappears quietly.

### Before enabling it

1. initialize the real EAS project ID;
2. add a server endpoint that binds a device token to an authenticated user,
   device and bundle;
3. store token rotation and revocation;
4. test on real devices, through TestFlight;
5. implement notification preferences and permission-denied behavior.

### Open question: when to ask

iOS asks for notification permission **once**. After a refusal it never asks
again, and only Settings can reverse it, so the timing of the request is itself
a product decision — which is why a dismissible screen of our own usually comes
first.

The unresolved part is the order relative to the biometric gate, which sits on
the same startup path. Two system dialogs in the first minute means the second
one gets dismissed more often, and the gate is the urgent one. Asking at the
first _meaningful_ moment rather than at first launch is one answer; it has not
been decided.

## Checks

```bash
pnpm mobile:lint
pnpm mobile:typecheck
pnpm mobile:doctor
pnpm mobile:test
pnpm lint
pnpm typecheck
```

Store builds and push delivery require real Apple/Google credentials and real
devices; repository CI cannot prove those parts.
