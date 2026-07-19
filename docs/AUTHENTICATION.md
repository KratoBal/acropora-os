# Authentication

## Jelenlegi állapot

A Commit #0003 providerfüggetlen session-abstrakciót és kizárólag fejlesztési célú mock bejelentkezést vezet be. Valódi identity provider, jelszókezelés, többfaktoros azonosítás és production session-store még nincs bekötve.

## Development auth

### Web

A `/login` oldal négy előre definiált fejlesztési felhasználó közül enged választani. A `DevelopmentAuthAdapter` rövid életű mock sessiont hoz létre, és azt a böngésző local storage-ában tárolja. Az `AuthProvider` az adapter mögött tartja az állapotot, az `AuthGate` pedig bejelentkezés nélkül nem rendereli az App Shellt.

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

A válasz mock sessiont és `dev_` előtagú bearer tokent ad. A védett végpontokon ezt az `Authorization: Bearer <token>` fejlécben kell küldeni.

A fejlesztési felhasználólista az e-mailt, nevet és role-t meghatározó identity-sablon. Bejelentkezéskor az API e-mail alapján determinisztikusan létrehozza vagy frissíti a hozzá tartozó adatbázisbeli `User` rekordot, és a sessionbe már annak belső `User.id` értéke kerül. A védett kéréseknél az identity ismét feloldódik egy létező, aktív `User` rekordra; így a `DomainEvent` és `AuditLog` hivatkozások nem mock vagy külső identityt, hanem valódi belső felhasználóazonosítót tárolnak. Ismeretlen vagy inaktív identity kontrollált `401` hibát eredményez.

- `GET /health`: publikus
- `POST /auth/login`: publikus, kizárólag development
- `GET /auth/me`: védett
- `POST /auth/logout`: védett

Az API session-store jelenleg memóriában él, ezért szerver-újraindításkor minden session elvész.

## Providercsere

A későbbi auth providernek az alkalmazás által használt `Session` és `AuthenticatedUser` szerződést kell előállítania. A weben új `AuthAdapter` implementáció válthatja a `DevelopmentAuthAdapter` osztályt. Az API-ban az `AuthService.resolveToken` helyére provider token-validáció vagy biztonságos szerveroldali session-store kerülhet; a guardok és permission dekorátorok változatlanul maradhatnak.

## Productionben tilos

- development felhasználólista használata;
- e-mail alapú, jelszó nélküli belépés;
- bearer token tárolása local storage-ban;
- memóriában tárolt session;
- `dev_` vagy `web_dev_` token elfogadása;
- HTTPS, CSRF-védelem, tokenrotáció és biztonságos cookie nélkül élesíteni.

A development login `NODE_ENV=production` környezetben kifejezetten le van tiltva.
