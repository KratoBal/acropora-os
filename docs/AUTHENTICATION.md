# Authentication

## Jelenlegi állapot

A Commit #0003 óta providerfüggetlen session-absztrakció létezik. Ez a
commit vezeti be az első valódi, jelszó-alapú production bejelentkezést:
`POST /auth/login/password`, ami a `User.passwordHash` mezőt és a már
korábban is létező `verifyPassword` (scrypt) utilt használja.

A session-store a Prisma `Session` modellt használja (lásd alább) — nem
memóriabeli többé. Egy session tokenből csak a SHA-256 lenyomata
(`Session.tokenHash`) kerül adatbázisba, a nyers token soha. Többfaktoros
azonosítás nincs.

## Development auth

### Web

A `/login` oldal `NODE_ENV !== "production"` esetén négy előre definiált
fejlesztési felhasználó közül enged választani. A `DevelopmentAuthAdapter`
rövid életű mock sessiont hoz létre, és azt a böngésző local storage-ában
tárolja, `Authorization: Bearer <dev_ token>` fejléccel elküldve minden
kérésen. Az `AuthProvider` az adapter mögött tartja az állapotot, az
`AuthGate` pedig bejelentkezés nélkül nem rendereli az App Shellt.

Fejlesztési felhasználók:

| E-mail                     | Role        |
| -------------------------- | ----------- |
| `owner@acropora.local`     | `OWNER`     |
| `admin@acropora.local`     | `ADMIN`     |
| `warehouse@acropora.local` | `WAREHOUSE` |
| `service@acropora.local`   | `SERVICE`   |

### API

`POST /auth/login` törzse:

```json
{ "email": "owner@acropora.local" }
```

A válasz mock sessiont és `dev_` előtagú bearer tokent ad. Ez az endpoint
`NODE_ENV=production` környezetben explicit `403`-at ad — sem az endpoint,
sem a `dev_` token nem elfogadott productionben.

A fejlesztési felhasználólista az e-mailt, nevet és role-t meghatározó
identity-sablon. Bejelentkezéskor az API e-mail alapján determinisztikusan
létrehozza vagy frissíti a hozzá tartozó adatbázisbeli `User` rekordot, és a
sessionbe már annak belső `User.id` értéke kerül.

## Production auth

### Web

A `/login` oldal `NODE_ENV === "production"` esetén a fejlesztési
felhasználóválasztó helyett e-mail + jelszó mezőt, hibaüzenetet és
betöltési állapotot jelenít meg. A `ProductionAuthAdapter` sessiont soha
nem tárol kliens oldalon (nincs helyi storage, nincs kliens által olvasható
token) — a `Session.token` mező ezen az úton mindig `undefined`, mert a
munkamenet kizárólag egy httpOnly sütiben él a szerveren.

### API

`POST /auth/login/password` törzse:

```json
{ "email": "owner@acropora.hu", "password": "..." }
```

A jelszó ellenőrzése a `User.passwordHash` mező (scrypt, `verifyPassword`)
ellen történik `AuthUserResolver.resolveByEmailAndPassword`-ban. Ismeretlen
e-mail, inaktív felhasználó, hiányzó jelszó és hibás jelszó egyaránt azonos,
generikus `401`-et ad — a válaszból nem derül ki, melyik eset állt fenn
(felhasználó-enumerálás elleni védelem). A jelszó-ellenőrzés minden esetben
lefuttat egy valódi scrypt-számítást (akár létezik a felhasználó, akár nem),
hogy a válaszidő ne legyen időzítéses oldalcsatorna.

Sikeres bejelentkezéskor a válasz csak `{ "user": AuthenticatedUser }`-t ad
vissza — a session tokent soha nem tartalmazza a body. A szerver két sütit
állít be:

- **`acropora_session`** — httpOnly, `secure` (productionben), `SameSite=Lax`,
  a session token értékével. Soha nem olvasható kliens JS-ből.
- **`acropora_csrf`** — NEM httpOnly, `secure` (productionben), `SameSite=Lax`,
  egy véletlen CSRF token értékével. A kliensnek ezt vissza kell küldenie az
  `X-CSRF-Token` fejlécben minden állapotváltoztató (nem GET/HEAD/OPTIONS)
  kérésen — ez a szokásos "double-submit cookie" védelem: egy másik
  origin-ről induló kérés nem tudja kiolvasni ezt a sütit, így nem tud
  helyes fejlécet hamisítani, még ha a böngésző a sütit automatikusan el is
  küldi a kéréssel.

A megosztott kliensoldali `apiRequest` (`apps/web/src/lib/api/client.ts`)
ezt automatikusan kezeli: `Authorization` fejlécet csak akkor csatol, ha
tényleges tokene van (development mód); az `acropora_csrf` sütit pedig
minden nem-GET kérésen visszatükrözi az `X-CSRF-Token` fejlécbe, ha az a
süti egyáltalán létezik (production mód). A két mód nem keveredik: a
development login sosem állít be CSRF sütit, a production login sosem ad
vissza olvasható tokent.

Az `AuthGuard` mindkét utat elfogadja: előbb a `Authorization: Bearer`
fejlécet nézi (development, változatlan), ennek hiányában esik vissza az
`acropora_session` sütire (production) — utóbbi esetén állapotváltoztató
kérésen kötelező az egyező CSRF fejléc, különben `403`.

- `GET /health`: publikus
- `POST /auth/login`: publikus, kizárólag development
- `POST /auth/login/password`: publikus, kizárólag ez a valódi,
  jelszó-ellenőrzött bejelentkezés (web)
- `POST /auth/mobile/login/password`: publikus, ugyanaz a
  jelszó-ellenőrzés mint a webes production loginé, lásd lent
- `GET /auth/me`: védett (mindkét auth-mód elfogadott)
- `POST /auth/logout`: védett; cookie-alapú sessionnél törli mindkét sütit is

Az API session-store (mindkét login-útvonalon) a Prisma `Session` táblában
él (`SessionRepository`, `apps/api/src/auth/session.repository.ts`):
szerver-újraindítás és több `api` replika esetén is ugyanúgy feloldható egy
korábban kiadott token, mert a state az adatbázisban van, nem egyetlen
process memóriájában. Csak a token SHA-256 lenyomata kerül tárolásra
(`Session.tokenHash`); a nyers token soha nem éri el az adatbázist. Lejárt
session feloldásakor az `AuthGuard`/`AuthService` `401`-et ad, és a lejárt
sort törli.

### Munkamenet-lejárat és csúszás

Balázs kérése és jóváhagyása (2026-09-24, mobil szál): a tünet, hogy a
mobilalkalmazás napközben kiléptetett, mert a lejárat rövidebb volt, mint
egy tipikus munkanap, és semmi nem hosszabbította.

Két, egymástól független dolog:

- **A hossz belépéskor dől el, kliensenként külön** (`AuthService.loginWithPassword`,
  a `client` paraméter): web és a development login `SESSION_TTL_MS` (8 óra),
  mobil `MOBILE_SESSION_TTL_MS` (30 nap). A mobil token saját, `mobile_`
  előtagot kap (`MOBILE_TOKEN_PREFIX`) — ez NEM biztonsági határ (azt a
  `Session.tokenHash` egyezése adja), hanem azonosítja, melyik hossz
  csúszik egy már kiadott tokenre (`ttlMsForToken`).
- **A lejárat MINDEN hitelesített kérésen csúszik** (`SessionRepository.findActive`):
  ha az utolsó hosszabbítás óta eltelt legalább `SLIDING_EXTEND_DEBOUNCE_MS`
  (5 perc), a lejárat `most + hossz`-ra tolódik, és a sor frissül. Az "utolsó
  hosszabbítás" idejét NEM külön oszlop tárolja — a meglévő `expiresAt`-ból
  és a hívó által átadott `ttlMs`-ből vezethető le (`expiresAt - ttlMs`,
  lásd `shouldExtend`), mert egy frissen (ki)adott vagy hosszabbított
  session pontosan `most + ttlMs` lejáratot kap. Az 5 perces debounce azért
  kell, hogy ne írjunk adatbázist minden egyes kérésnél.

A cookie-alapú (web) útvonalon a `acropora_session` és `acropora_csrf`
süti `maxAge`-e is újra beállítódik (`AuthGuard`), de KIZÁRÓLAG akkor, ha
ebben a körben ténylegesen történt hosszabbítás — különben minden kérés
felesleges `Set-Cookie` fejlécet kapna. A CSRF süti ÉRTÉKE ilyenkor
VÁLTOZATLAN marad (csak a `maxAge` nő): újragenerálás a kliens következő
állapotváltoztató kérését CSRF-hibával buktatná, mert az addig kapott
értéket küldené vissza.

**A mobil kliens is látja a csúszást, két lépésben** (Balázs kiegészítése,
2026-09-24 08:37 — az első kör után ez még nyitott korlát volt, azóta
lezárva):

1. A `GET /auth/me` válasza (`CurrentUserResponse.expiresAt`,
   `@acropora/types`) az `AuthGuard` által beállított, a hosszabbítás UTÁNI
   lejáratot hordozza — mindkét úton (Bearer és süti), mert
   `AuthService.resolveToken` mindig visszaadja.
2. A mobil `restoreSession` (hidegindítás) ezzel írja felül a helyben tárolt
   `expiresAt`-et (`token-store.ts`, `saveSession`) — de CSAK ha a válasz
   ténylegesen hordoz értéket, hogy egy régebbi API-telepítés ellen a
   meglévő helyi érték maradjon meg.

**A `resumeSession` (háttérből visszatéréskor) szándékosan VÁLTOZATLAN
maradt** — Balázs 2026-08-18-i döntése szerint eleve nem hív szervert, csak a
helyi lejáratot nézi. Mivel a `restoreSession` minden hidegindításkor
frissíti ezt az értéket, egy 30 napos csúszó ablaknál ez bőven elég: a
felhasználó tipikusan gyakrabban indítja újra az appot (vagy tér vissza a
háttérből, amitől viszont nem törlődik a folyamat), mint 30 naponta egyszer.

A mobil kliens frissítése OTA-val megy ki, és a sorrend számít: a szerver
API telepítése előbb kell, mert egy régi API mellett a `/auth/me` válasza
nem hordoz `expiresAt`-et, és a kliens ilyenkor a meglévő helyi értéket
tartja meg (nem hibázik, csak nem frissül).

### Mobil auth

`POST /auth/mobile/login/password` törzse:

```json
{ "email": "owner@acropora.hu", "password": "..." }
```

Válasz:

```json
{
  "token": "...",
  "expiresAt": "2026-07-28T18:00:00.000Z",
  "user": { "...": "AuthenticatedUser" }
}
```

Ugyanazt a jelszó-ellenőrzést és `AuthService.loginWithPassword` hívást
használja, mint a webes production login — csak a token kézbesítése más: a
mobil kliensnek nincs böngésző-sütitárolója, ezért a token közvetlenül a
JSON válaszban érkezik, és a mobil kliens (`apps/mobile/src/lib/auth/token-store.ts`,
Expo SecureStore) tárolja, majd minden kérésen
`Authorization: Bearer <token>` fejlécként küldi (lásd
`apps/mobile/src/lib/api/client.ts`). Ez az endpoint nem állít be sem
session-, sem CSRF-sütit — a CSRF double-submit védelem kizárólag a
cookie-alapú auth-útvonalra vonatkozik, a Bearer-útvonalra sosem (lásd
`AuthGuard`).

### Jelszó beállítása egy felhasználónak

A `passwordHash` mezőt a felhasználó-kezelés (`users/users.repository.ts`)
állítja be, amikor egy admin jelszót ad meg egy `User` létrehozásakor vagy
szerkesztésekor. Egy `User`-nek addig nincs jelszava (`passwordHash: null`),
amíg valaki ezt explicit be nem állítja — jelszó nélküli felhasználóval a
production login mindig a fent leírt generikus `401`-et adja.

## Gépi hitelesítés (service token)

A felhasználói session mellett létezik egy **második, tőle teljesen független**
bejövő hitelesítési út: a `ServiceToken` tábla és a `ServiceTokenGuard`. Ez nem
felhasználót és nem sessiont old fel, hanem gépi hívót, és a kódbázisban
**egyetlen** ponton szerepel: a `POST /tasks/ingest` végponton. A service token
más végponton nem használható, mert más végpont nem is nézi.

Ami a két útban közös: a nyers tokenből csak a SHA-256 lenyomat kerül
adatbázisba (`ServiceToken.tokenHash`, ugyanaz a `hashSessionToken` util).

Ami eltér: a service token nem jár le, nincs hozzá szerepkör vagy permission, és
nem jelenik meg a felhasználókezelésben. A visszavonás explicit
(`ServiceToken.revokedAt`), operátori CLI-vel. Részletek: `docs/TASKS.md` és
[ADR-015](../adr/0015-service-token-machine-ingest.md).

## Providercsere

Egy jövőbeli, teljesebb auth providernek (pl. SSO, MFA) az alkalmazás által
használt `Session` és `AuthenticatedUser` szerződést kell előállítania. A
weben újabb `AuthAdapter` implementáció válthatja fel vagy egészítheti ki a
`ProductionAuthAdapter`-t. Az API-ban az `AuthService`/`AuthUserResolver`
helyére léphet egy külső identity-provider-integráció; a guardok és
permission dekorátorok változatlanul maradhatnak.

## Productionben tilos

- development felhasználólista használata;
- e-mail alapú, jelszó nélküli belépés;
- bearer token tárolása local storage-ban;
- `dev_` vagy `web_dev_` token elfogadása;
- HTTPS és biztonságos (`secure`, `httpOnly`) cookie nélkül élesíteni.

A development logint **két, egymástól független feltétel** védi, és mindkettőnek
teljesülnie kell:

1. `AUTH_PROVIDER` értéke pontosan `development`. **A hiányzó érték tilt** —
   éles telepítésen ez a változó nem szerepel, tehát ott a kapu magától zárva
   van.
2. `NODE_ENV` értéke nem `production`.

**Miért kettő, és miért nem ugyanazon a változón.** A `node-env.guard.ts` az
_ismeretlen_ `NODE_ENV` értéken állítja meg az API indulását, a `development`
viszont **ismert** érték: ha az kerül egy éles példányra (elgépelésből vagy egy
másolt környezeti fájlból), azt az őrző elengedi. Két zár, ami ugyanarra az egy
értékre támaszkodik, nem két zár. Az `AUTH_PROVIDER` azért alkalmas második
jelnek, mert erre az egy célra van elnevezve: nem utazik együtt a szokásos
környezeti sablonokkal.

**Mi a tét.** A development login jelszó ismerete nélkül ad munkamenetet, és a
`resolveDevelopmentIdentity` **létre is hozza** a hiányzó felhasználót `OWNER`
szerepkörrel. Éles példányon tehát nem csak belépés történne: keletkezne egy
tulajdonosi fiók az éles adatbázisban.

A megtagadás **oka a szerver naplójába kerül, nem a válaszba**: a hívó nincs
hitelesítve, és a pontos ok megmondaná neki, melyik beállítást kell megszereznie.

A production login (`/auth/login/password`) bármely környezetben
elérhető — nincs erre a szimmetrikus, "csak developmentben tiltott"
korlátozás, mert maga az endpoint eleve valódi jelszó-ellenőrzést végez.
