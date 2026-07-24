# Acropora OS

Az Acropora OS egy magyar nyelvű, moduláris vállalatirányítási rendszer. A repository pnpm workspace-re és Turborepóra épül; a kezelőfelület Next.js, az API NestJS alapú.

## Előfeltételek

- Node.js 22 vagy újabb
- pnpm 10
- Docker és Docker Compose (a helyi PostgreSQL és Redis futtatásához)

Ha a pnpm nincs telepítve, a Node.js mellé szállított Corepackkel aktiválható:

```bash
corepack enable
corepack prepare pnpm@10.34.5 --activate
```

## Első indítás

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
```

Windows PowerShellben a másolás parancsa: `Copy-Item .env.example .env`. A gyökér `.env` a helyi fejlesztési konfiguráció egyetlen forrása; a példaértékeket indulás előtt ellenőrizni kell. A `prisma:migrate` fejlesztői adatbázison `prisma migrate dev` workflow-t futtat.

- Web: http://localhost:3000
- API: http://localhost:3001
- API állapot: http://localhost:3001/health

## Hasznos parancsok

| Parancs                                  | Leírás                                  |
| ---------------------------------------- | --------------------------------------- |
| `pnpm dev`                               | Web és API fejlesztői indítása          |
| `pnpm lint`                              | Workspace statikus ellenőrzések         |
| `pnpm typecheck`                         | Workspace TypeScript-ellenőrzés         |
| `pnpm test`                              | Unit- és alap workspace tesztek         |
| `pnpm build`                             | Production build a teljes workspace-re  |
| `pnpm infra:up`                          | PostgreSQL és Redis indítása            |
| `pnpm infra:down`                        | Helyi infrastruktúra leállítása         |
| `pnpm db:validate`                       | Prisma-séma ellenőrzése                 |
| `pnpm prisma:migrate`                    | Fejlesztői migrációk alkalmazása        |
| `pnpm prisma:seed`                       | Idempotens development seed             |
| `pnpm prisma:studio`                     | Prisma Studio indítása                  |
| `pnpm format:check`                      | Formázás ellenőrzése                    |
| `pnpm --filter @acropora/api test:smoke` | HTTP health smoke élő infrastruktúrával |

## Repository felépítése

```text
apps/web             Next.js kezelőfelület
apps/api             NestJS API
packages/ui          Megosztott React komponensek
packages/database    Adatbázis-séma és adatbázis-csomag
packages/config      Megosztott TypeScript-konfigurációk
packages/types       Megosztott üzleti típusok
docs                 Rendszerdokumentáció
adr                  Architektúradöntési rekordok
backlog              Tervezett feladatok
prototypes           Eldobható koncepciók és kísérletek
```

Részletes dokumentáció:

- [Helyi fejlesztés](docs/LOCAL-DEVELOPMENT.md)
- [Aktuális projektállapot](docs/CURRENT_STATUS.md)
- [Architektúra](docs/ARCHITECTURE.md)
- [Autentikáció](docs/AUTHENTICATION.md) és [jogosultságkezelés](docs/AUTHORIZATION.md)
- [Brand Import Assistant](docs/BRAND-IMPORT-ASSISTANT.md)
- [Production deployment architecture review](docs/PRODUCTION-DEPLOYMENT-ARCHITECTURE-REVIEW.md)
- [Production deployment folyamat](docs/DEPLOYMENT.md) és [Coolify konfiguráció](docs/COOLIFY.md)
- [Production környezeti változók](.env.production.example)
- [ADR jegyzék](adr/README.md)
- [Roadmap](ROADMAP.md) és [közreműködés](CONTRIBUTING.md)
- [Biztonsági hibák jelentése](SECURITY.md)
