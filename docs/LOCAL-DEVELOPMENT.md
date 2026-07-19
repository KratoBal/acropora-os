# Helyi fejlesztői környezet

## Előfeltételek

- Node.js 22+
- pnpm 10+
- Docker Desktop vagy Docker Engine Compose pluginnal

## Első indítás

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
```

A szolgáltatások alapértelmezett címei:

| Szolgáltatás | Cím                            |
| ------------ | ------------------------------ |
| Web          | `http://localhost:3000`        |
| API          | `http://localhost:3001`        |
| Health       | `http://localhost:3001/health` |
| PostgreSQL   | `localhost:5432`               |
| Redis        | `localhost:6379`               |

## Docker Compose

Az infrastruktúra indítása és állapotának ellenőrzése:

```bash
docker compose up -d
docker compose ps
docker compose logs postgres redis
```

Leállítás az adatok megtartásával:

```bash
docker compose down
```

A volume-ok törlése minden helyi adatot végleg eltávolít:

```bash
docker compose down -v
```

## Prisma workflow

### Kliensgenerálás

```bash
pnpm prisma:generate
```

### Fejlesztői migráció

Sémaváltoztatás után hozz létre elnevezett migrációt:

```bash
pnpm prisma:migrate -- --name add_example_model
```

A `migrate dev` kizárólag fejlesztői adatbázison használható. Production migrációt külön deployment folyamat fog futtatni.

### Gyors schema push

Eldobható helyi kísérlethez, migrációs fájl nélkül:

```bash
pnpm prisma:push
```

Megosztott vagy hosszú életű változtatáshoz mindig migráció készüljön; a `db push` nem helyettesíti a migrációs történetet.

### Seed

```bash
pnpm prisma:seed
```

A seed idempotens: a felhasználókat e-mail, a kategóriákat és gyártókat slug alapján frissíti vagy létrehozza. `NODE_ENV=production` esetén megtagadja a futást.

### Prisma Studio

```bash
pnpm prisma:studio
```

## Platformjegyzetek

### macOS

- Docker Desktop indítása után várd meg, amíg az engine állapota zöld.
- Apple Siliconon a hivatalos PostgreSQL és Redis alpine image-ek natívan futnak.
- Ha az 5432-es port foglalt, ellenőrizd a Homebrew PostgreSQL szolgáltatásokat: `brew services list`.

### Windows

- Docker Desktop WSL2 backend használata ajánlott.
- A parancsokat PowerShellben vagy WSL-ben ugyanabban a repositoryban futtasd; ne keverd a két környezet `node_modules` könyvtárát.
- A `.env` másolása PowerShellben: `Copy-Item .env.example .env`.

### Linux

- A felhasználónak hozzáférés kell a Docker daemonhoz. Szükség esetén használd a disztribúció dokumentációja szerinti `docker` csoportot.
- A modern `docker compose` plugin szükséges; a régi `docker-compose` bináris nem támogatott célfelület.

## Gyakori hibák

### `P1001: Can't reach database server`

Ellenőrizd a konténert és a `.env` URL-t:

```bash
docker compose ps
docker compose logs postgres
```

### `port is already allocated`

Egy helyi PostgreSQL vagy Redis már használja a portot. Állítsd le azt, vagy módosítsd a Compose host portját és a megfelelő URL-t együtt.

### Prisma Client nincs szinkronban

```bash
pnpm prisma:generate
pnpm typecheck
```

### A health endpoint `503`

A válasz `database` és `redis` mezője megmutatja, melyik függőség nem elérhető. Ellenőrizd a Compose health állapotot, majd a `DATABASE_URL` és `REDIS_URL` változókat.

### Korábbi schema volume ütközése

Fejlesztői adatok megtartása esetén használj migrációt. Csak eldobható helyi adatoknál töröld a volume-okat a `docker compose down -v` paranccsal.
