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

The current production web login returns a session only in an HTTP-only cookie.
The API guard can already validate bearer tokens, but production login does not
currently issue a native-client token. Therefore:

1. the mobile scaffold stores tokens only in SecureStore;
2. it does not pretend that production mobile login is ready;
3. the next backend increment must add a mobile session/token exchange with
   expiry, revocation, device/session listing and logout;
4. authorization remains the existing server-side RBAC source of truth;
5. no development login mode may be exposed through the public staging domain.

Until that increment is complete, staging access must remain network-gated and
the diagnostic screen should use only public endpoints such as `/health`.

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
pnpm lint
pnpm typecheck
```

Store builds and push delivery require real Apple/Google credentials and real
devices; repository CI cannot prove those parts.
