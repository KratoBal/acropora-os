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

A development login `NODE_ENV=production` környezetben kifejezetten le van
tiltva. A production login (`/auth/login/password`) bármely környezetben
elérhető — nincs erre a szimmetrikus, "csak developmentben tiltott"
korlátozás, mert maga az endpoint eleve valódi jelszó-ellenőrzést végez.
