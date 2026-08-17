# ADR-015 – Gépi feladat-felvitel hatókör-korlátozott service tokennel

## Állapot

Elfogadva – 2026-08-16

## Kontextus

A `/feladataim` személyes feladatlista (lásd `docs/TASKS.md`) attól lesz hasznos,
ha a flotta ügynökei is fel tudnak rá venni kérdést, nem csak ember. Az üzleti
követelmény pontosan egy műveletet enged a gépi hívónak: **feladat létrehozása**.
Semmilyen olvasás más entitáson, semmilyen módosítás, semmilyen törlés.

A rendszerben eddig egyetlen bejövő hitelesítési út volt: az `AuthGuard`, amely
Bearer session tokent vagy httpOnly session cookie-t old fel `User`-re a `Session`
táblán keresztül. Service token, API kulcs vagy webhook-hitelesítés nem létezett.

A kézenfekvő megoldás egy szerviz-`User` lett volna, új szerepkörrel, amely a
`ROLE_PERMISSIONS` mátrixban csak a feladat-létrehozást kapja meg. Ez azonban a
szűkítést **konvencióra** bízná: egy session token minden végponton érvényes, és
kizárólag a permission-mátrix korlátozza. Egy jövőbeli végpont, amelyről lemarad a
`@RequirePermissions`, azonnal elérhetővé válna a flotta tokenjének. Emellett a
`Session` lejár, tehát egy gépi fiók vagy megújítást igényelne, vagy egy sosem
lejáró álsessiont, ami magát az auth modellt rontaná el.

## Döntés

- Külön `ServiceToken` modell, a `User` és a `Session` táblától függetlenül. Nincs
  hozzá szerepkör, nincs permission, és nem jelenik meg a felhasználókezelésben.
- Külön `ServiceTokenGuard`, amely **a kódbázisban pontosan egy helyen szerepel**:
  a `TaskIngestController` osztályán, amelynek pontosan egy útvonala van
  (`POST /tasks/ingest`).
- A korlát ezzel konstrukciós, nem konfigurációs: a service token nem azért nem tud
  mást csinálni, mert nincs rá joga, hanem mert **nincs másik végpont, amely
  egyáltalán elfogadná a credentialt**. A guard második helyre való felvétele
  visszamenőleg kiszélesítené minden létező token hatókörét, ezért tilos; új
  igényhez új mechanizmus kell.
- Az `@Public()` dekorátor itt nem publikus végpontot jelent, csak azt, hogy a
  globális `AuthGuard` álljon félre. A hitelesítést a `ServiceTokenGuard` végzi.
- CSRF-ellenőrzés nem kell és nincs: a végpont nem cookie-alapú, tehát nem
  hordoz ambient credentialt. A guard szándékosan nem néz session cookie-t.
- A nyers token sosem kerül adatbázisba, kizárólag a SHA-256 lenyomata
  (`hashSessionToken`, ugyanaz az elv, mint a `Session.tokenHash` mezőnél). A
  nyers érték egyszer, a kiadó CLI kimenetén jelenik meg; elvesztése esetén új
  tokent kell kiadni, visszafejteni nem lehet.
- Nincs token-kezelő admin felület. Két-három token mellett egy ilyen képernyő
  több támadási felület lenne, mint kényelem. A kiadás és visszavonás operátori
  CLI-vel történik: fejlesztői gépen
  `pnpm --filter @acropora/api service-token`, production konténerben
  `node dist/tasks/service-token.cli.js` — a runner image-ből szándékosan
  hiányzik minden csomagkezelő, ezért ott a lefordított CLI közvetlen hívása az
  egyetlen út. Mindkét alak a `docs/TASKS.md` "Token kiadása és visszavonása"
  szakaszában áll, indoklással.

### Névtér és idempotencia

- Minden tokenhez tartozik egy egyedi `slug`. A token által felvitt feladat
  `sourceRef` mezője **a szerver által összefűzve** `"<slug>:<hivatkozás>"` alakban
  tárolódik. A hívó a névteret nem tudja megválasztani.
- Ebből következően két gépi hívó nem tud ütközni a `Task` tábla
  `[source, sourceRef]` egyedi indexén, és nem tud egymás nevében tételt felvinni.
- A `reference` mező **kötelező**. Ez teszi biztonságossá az újraküldést: egy
  újraindult ügynök ugyanazzal a hivatkozással a meglévő feladatot kapja vissza
  (`created: false`), nem hoz létre duplikátumot. Egyidejű dupla hívásnál a
  vesztes ág a `P2002` egyediségsértést a nyertes sorára oldja fel.

### Visszaélés-korlátozás

- Tokenenkénti napi felviteli plafon (`dailyLimit`, alapértelmezés 200), a tárolt
  sorokból számolva, nem külön számlálóoszlopból, hogy ne tudjon elcsúszni.
  Túllépésnél `429`.
- Hosszkorlátok a címre, a leírásra és a hivatkozásra.
- Nem vezettünk be új futásidejű függőséget (pl. `@nestjs/throttler`) egyetlen
  végpont miatt.

### Napló

Minden felvitel ír egy `AuditLog` sort `userId = NULL` értékkel (nincs cselekvő
felhasználó), `action = "task.ingested"`, és a metadata kizárólag a token
slugját és a `sourceRef` értéket tartalmazza. A cím és a leírás **nem** kerül
naplóba: azok a hívó tartalmát hordozzák.

## Vállalt kompromisszum

A felelős e-mail cím alapján oldódik fel. Ismeretlen vagy inaktív cím esetén a
válasz `422`, létező cím esetén `201`. Ez a különbség elárulja egy e-mail cím
létezését annak, aki érvényes service tokennel rendelkezik. Belső, a tulajdonos
kezében lévő tokennel ezt elfogadhatónak ítéltük; nyíltan rögzítjük, nem
hallgatjuk el. Ha a token-kör bővül, ez a pont újratárgyalandó.

## Következmények

- A gépi felület bővítése ezentúl tudatos döntés: nem lehet véletlenül, egy új
  végpont felvételével kiszélesíteni.
- A `ServiceToken.slug` a `sourceRef` névterének tartós része, ezért kiadás után
  gyakorlatilag nem átnevezhető a meglévő hivatkozások elvesztése nélkül.
- Token visszavonása azonnal hatályos, de a már felvitt feladatokat nem érinti.
- Ha később más rendszer is felvinne feladatot, az saját tokent és saját slugot
  kap, nem a meglévőt használja újra.
