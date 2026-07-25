# Authentication

## Jelenlegi állapot

A Commit #0003 óta providerfüggetlen session-absztrakció létezik. Ez a
commit vezeti be az első valódi, jelszó-alapú production bejelentkezést:
`POST /auth/login/password`, ami a `User.passwordHash` mezőt és a már
korábban is létező `verifyPassword` (scrypt) utilt használja. Session-store
egyelőre továbbra is memóriában él (lásd alább) — ez egy külön, még nyitott
korlát, nem ennek a commitnak a hatóköre. Többfaktoros azonosítás nincs.

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
  jelszó-ellenőrzött bejelentkezés
- `GET /auth/me`: védett (mindkét auth-mód elfogadott)
- `POST /auth/logout`: védett; cookie-alapú sessionnél törli mindkét sütit is

Az API session-store (mindkét login-útvonalon) jelenleg memóriában él,
ezért szerver-újraindításkor minden session elvész, és több `api` replika
esetén a session nem osztott — ez egy ismert, dokumentált korlát (lásd
`docs/PRODUCTION-DEPLOYMENT-ARCHITECTURE-REVIEW.md`), amit ez a commit nem
old meg, csak a jelszó-ellenőrzést és a session-átadás biztonságát javítja.

### Jelszó beállítása egy felhasználónak

A `passwordHash` mezőt a felhasználó-kezelés (`users/users.repository.ts`)
állítja be, amikor egy admin jelszót ad meg egy `User` létrehozásakor vagy
szerkesztésekor. Egy `User`-nek addig nincs jelszava (`passwordHash: null`),
amíg valaki ezt explicit be nem állítja — jelszó nélküli felhasználóval a
production login mindig a fent leírt generikus `401`-et adja.

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
