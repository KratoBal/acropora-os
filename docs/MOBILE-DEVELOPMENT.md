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
- SQLite/WAL offline queue foundation;
- network and push-notification native dependencies;
- an API health diagnostic screen;
- EAS development/preview/production profiles.

The first business increment built on this foundation is the contractual field
workflow. Aquarium maintenance and customer-facing ICP views remain later
increments.

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

| Client | Local API URL |
|---|---|
| iOS simulator | `http://localhost:3001` |
| Android emulator | `http://10.0.2.2:3001` |
| Physical phone | `http://<mac-lan-ip>:3001` |
| Preview build | `https://<staging-api-domain>` |

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

| EAS environment | `EXPO_PUBLIC_APP_ENV` | `EXPO_PUBLIC_API_URL` |
|---|---|---|
| development | `development` | local/LAN API used by the developer |
| preview | `preview` | HTTPS staging API |
| production | `production` | HTTPS production API |

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

SQLite is initialized with WAL support and a durable `sync_queue` table. Domain
work will add task-specific tables and an idempotent sync protocol. The rules
for that protocol are:

- server IDs plus client-generated operation IDs;
- explicit pending/syncing/failed/conflict states;
- retry only idempotent operations automatically;
- never accept or sign a document entirely offline;
- signatures and document versions are server-confirmed actions;
- preserve local evidence until the server acknowledges it;
- show unresolved conflicts to the colleague instead of silently overwriting.

## Push notification boundary

`expo-notifications` is installed, but registration is intentionally not
started automatically. Before enabling it:

1. initialize the real EAS project ID;
2. configure APNs and FCM credentials in EAS;
3. add a server endpoint that binds a push token to an authenticated user and
   device;
4. store token rotation and revocation;
5. test on real devices;
6. implement notification preferences and permission-denied behavior.

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
