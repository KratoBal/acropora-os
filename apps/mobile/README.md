# Acropora OS Mobile

Expo SDK 57 and React Native application for Acropora OS field work. The app
is intentionally part of the existing pnpm/Turborepo monorepo so API types and
business rules can later be shared without publishing private packages.

## First local start

From the repository root:

```bash
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

In a second terminal:

```bash
pnpm dev:mobile
```

The primary development target is an Expo development build, not Expo Go.
Push notifications and later native integrations must be tested in the same
kind of client that will be shipped.

For a temporary Expo Go start:

```bash
pnpm dev:mobile:go
```

## API address

`EXPO_PUBLIC_API_URL` is compiled into the JavaScript bundle and is therefore
public. Never place a password, API key or signing secret in any
`EXPO_PUBLIC_*` variable.

- iOS simulator: `http://localhost:3001`
- Android emulator: `http://10.0.2.2:3001`
- physical device: the development Mac's LAN address, for example
  `http://192.168.1.50:3001`
- staging build: the HTTPS staging API domain

The phone and Mac must be on the same network for a LAN address to work. A
physical device interprets `localhost` as the phone itself.

## Verification

```bash
pnpm mobile:lint
pnpm mobile:typecheck
pnpm mobile:doctor
```

See [`../../docs/MOBILE-DEVELOPMENT.md`](../../docs/MOBILE-DEVELOPMENT.md) for
EAS development builds, environment management, the offline model and current
authentication boundary.
