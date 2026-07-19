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
pnpm install
docker compose up -d
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001
- API állapot: http://localhost:3001/health

## Hasznos parancsok

| Parancs            | Leírás                          |
| ------------------ | ------------------------------- |
| `pnpm dev`         | Web és API fejlesztői indítása  |
| `pnpm build`       | A teljes workspace buildelése   |
| `pnpm typecheck`   | TypeScript-ellenőrzés           |
| `pnpm lint`        | Statikus ellenőrzések           |
| `pnpm infra:up`    | PostgreSQL és Redis indítása    |
| `pnpm infra:down`  | Helyi infrastruktúra leállítása |
| `pnpm db:validate` | Prisma-séma ellenőrzése         |

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

Az ütemezést a [ROADMAP.md](ROADMAP.md), a közreműködés szabályait a [CONTRIBUTING.md](CONTRIBUTING.md) tartalmazza.
