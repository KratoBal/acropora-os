# Feladatok (/feladataim)

Személyes feladat- és kérdéslista. Azt a célt szolgálja, hogy a munkatársra
váró kérdések ne szóródjanak szét chatben és külső dokumentumokban, hanem egy
helyen legyenek láthatók, azzal együtt, hogy mit blokkolnak.

Ez nem projektmenedzsment eszköz. Egy tételnek egy felelőse van, két állapota,
és nincs alárendelt feladat, függőség, becslés vagy erőforrás-tervezés.

## Adatmodell

`Task` (`packages/database/prisma/schema.prisma`):

| Mező                     | Jelentés                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `title`                  | Rövid, egy mondatos összefoglaló.                                                                           |
| `description`            | Az indoklás: miért kérdezzük, mit blokkol. Ez a tétel fő tartalma.                                          |
| `status`                 | `OPEN` vagy `DONE`.                                                                                         |
| `linkUrl`                | Külső hivatkozás, jellemzően a beszélgetés szálának címe. Csak `http`/`https`.                              |
| `source`                 | `MANUAL` (a felületről) vagy `AGENT` (gépi felvitel).                                                       |
| `sourceRef`              | A forrásrendszer saját azonosítója. A `[source, sourceRef]` egyediség adja a gépi felvitel idempotenciáját. |
| `assigneeId`             | A felelős. A lista mindig erre szűr.                                                                        |
| `createdById`            | Aki felvette. Gépi felvitelnél `NULL`, mert nincs cselekvő felhasználó.                                     |
| `closedById`, `closedAt` | Ki és mikor zárta le.                                                                                       |

A `sourceRef` kézi felvitelnél `NULL`, és PostgreSQL-ben minden `NULL`
különbözik minden más `NULL`-tól, ezért az egyedi index a kézzel felvitt
tételek számát nem korlátozza.

## Jogosultság és láthatóság

A feladatokhoz **nem tartozik új permission**. Minden végpont a meglévő
`tasks.view` jogot követeli meg, amit a `ROLE_PERMISSIONS` mátrix már minden
szerepkörnek megad.

A tényleges szűkítés nem jogosultsági, hanem **sor szintű**, és a szerveren
történik:

- a lista kizárólag a bejelentkezett felhasználó `assigneeId`-jével egyező
  tételeket adja vissza, tehát más tábláját megnézni nem lehet;
- lezárni és újranyitni azt a tételt lehet, amelynek a felhasználó a felelőse
  **vagy** amelyet ő maga vett fel (ez utóbbi a kiút, ha valaki tévedésből
  adott feladatot másnak);
- olyan azonosítóra, amelyen a felhasználó nem cselekedhet, a válasz `404`, nem
  `403`. A `403` elárulná, hogy a tétel létezik és máshoz tartozik.

## API

Minden végpont `tasks.view` jogot igényel.

| Végpont                                  | Leírás                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /tasks/mine?status=OPEN\|DONE\|ALL` | A bejelentkezett felhasználó tételei. Alapértelmezés: `OPEN`.                    |
| `GET /tasks/assignees`                   | Az aktív felhasználók azonosítója és megjelenítendő neve, a felelős-választóhoz. |
| `POST /tasks`                            | Új tétel. `assigneeId` nélkül a felvevő magának adja.                            |
| `PATCH /tasks/:id/close`                 | Lezárás. Már lezárt tételen nem hiba, hanem hatástalan.                          |
| `PATCH /tasks/:id/reopen`                | Újranyitás.                                                                      |

A lista **nincs lapozva**: egy személyes munkalista nem archívum. A szerver
`TASK_LIST_LIMIT` (200) tételnél elvágja a választ, és ilyenkor a `truncated`
mező `true`, amit a felület ki is ír. Ha ez a gyakorlatban előfordul, az nem
megjelenítési kérdés, hanem azt jelenti, hogy lapozás kell.

### Hivatkozás-ellenőrzés

A `linkUrl` a felületen `href`-ként jelenik meg, ezért a séma biztonsági
határ. A `parseTaskLink` (`apps/api/src/tasks/task-link.util.ts`) csak
abszolút `http`/`https` címet fogad el; `javascript:` és `data:` elutasításra
kerül. A hibás cím nem javítódik ki csendben, hanem `400`-at kap, mert egy
észrevétlenül átírt hivatkozás rosszabb, mint egy visszautasított.

## Felület

`/feladataim` (`apps/web/src/app/(shell)/feladataim`). A csempén az indoklás
teljes méretben, sortöréseivel együtt jelenik meg, nem levágva és nem halvány
lábjegyzetként: a lista értéke pontosan ez, nem a cím. Ha van hivatkozás, a cím
maga is arra mutat.

A `/feladataim` korábban a `[section]` gyűjtő-útvonal placeholderét kapta. Az a
bejegyzés törölve lett; a Next.js a statikus szegmenst választja a dinamikus
helyett, így a placeholder holt kód lett volna.

## Gépi felvitel

A flotta ügynökei a `POST /tasks/ingest` végponton vesznek fel feladatot. Ez az
alkalmazás **teljes** gépi felülete: egy controller, egy metódus, egy útvonal. A
hitelesítést a `ServiceTokenGuard` végzi, amely a kódbázisban sehol máshol nem
szerepel, tehát a token nem azért nem tud mást csinálni, mert nincs rá joga,
hanem mert nincs másik végpont, amely elfogadná a credentialt. A döntés
indoklása és a vállalt kompromisszumok: [ADR-015](../adr/0015-service-token-machine-ingest.md).

A végponton `@Public()` szerepel, de az nem publikus végpontot jelent, csak azt,
hogy a globális `AuthGuard` álljon félre. Session cookie-t a guard nem néz, ezért
CSRF-ellenőrzés sem kell: a kérés nem hordoz ambient credentialt.

### Kérés

```http
POST /tasks/ingest
Authorization: Bearer svc_...
Content-Type: application/json

{
  "title": "Nyers termékexport",
  "description": "Enélkül polip nem tud importra kész fájlt adni.",
  "linkUrl": "https://discord.com/channels/...",
  "assigneeEmail": "balazs@example.hu",
  "reference": "required-inputs#1.2"
}
```

Válasz: `{ "id": "...", "status": "OPEN", "created": true }`.

- A `reference` **kötelező**. A szerver a token slugjával fűzi össze, tehát a
  tárolt érték `"<slug>:<reference>"`, és a hívó a névteret nem választhatja meg.
  Ezért két ügynök azonos hivatkozása nem ütközik, és egyik sem tud a másik
  nevében írni.
- Az újraküldés biztonságos: ugyanaz a `reference` a meglévő feladatot adja
  vissza `created: false` értékkel, nem hoz létre másodikat. Egyidejű dupla hívás
  esetén a vesztes ág is a nyertes sorára oldódik fel.
- Ismeretlen vagy inaktív `assigneeEmail` esetén a válasz `422`. Ez a `201`-től
  való eltérés elárulja egy e-mail cím létezését az érvényes token birtokosának;
  ezt tudatosan vállaltuk, lásd az ADR-t.
- Tokenenkénti napi plafon van (`dailyLimit`, alapértelmezés 200). Túllépésnél
  `429`.
- Minden felvitel `AuditLog` sort ír `userId = NULL` értékkel; a metadata csak a
  token slugját és a `sourceRef` értéket tartalmazza, a címet és a leírást nem.

### Token kiadása és visszavonása

Nincs hozzá admin felület, operátori CLI van. A nyers token **egyszer**, a
létrehozáskor jelenik meg; az adatbázisban csak a SHA-256 lenyomata van, tehát
elvesztés esetén nem visszaállítható, hanem újat kell kiadni.

```bash
pnpm --filter @acropora/api service-token -- create --slug polip --name "Flotta - polip"
pnpm --filter @acropora/api service-token -- list
pnpm --filter @acropora/api service-token -- revoke --slug polip
```

A `--slug` kiadás után gyakorlatilag nem nevezhető át, mert a már felvitt
feladatok `sourceRef` értékének tartós része.
