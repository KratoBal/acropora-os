# Biztonsági alapelvek

- API-kulcs soha nem kerül frontendbe vagy Git repositoryba.
- Titkok környezeti változókban vagy secrets managerben tárolandók.
- Számlázási és készletmódosítási műveletek teljes auditnaplót kapnak.
- Webhookok hitelességét ellenőrizni kell.
- Adminisztrátori és pénztárosi jogosultságok elkülönülnek.
- Adatbázisról napi mentés és rendszeres visszaállítási próba szükséges.
- Élesítés előtt HTTPS, rate limit, CSRF-védelem és biztonságos cookie-beállítás kötelező.

## UNAS credential

- Az adatbázisban tárolt UNAS API-kulcs AES-256-GCM hitelesített titkosítást,
  egyedi 12 bájtos IV-t, 16 bájtos authentication taget és verziózott AAD-t kap.
- A 32 bájtos főkulcs kizárólag verziózott környezeti változóból olvasható;
  adatbázisba, API-válaszba, auditba vagy repositoryba nem kerülhet.
- `DATABASE` módban decryption vagy envelope hiba fail-closed. `DISABLED` módban
  az `UNAS_API_KEY` fallback használata tilos.
- Az API-kulcsot, tokent, ciphertextet, kulcsfingerprintet, nyers UNAS-választ,
  XML `<Error>` szöveget és termékadatot naplózni vagy audit payloadba írni tilos.
- Az API csak fix maszkot és konfigurációs/verification metaadatot adhat vissza.
- Credentialcsere és manuális kapcsolatellenőrzés adatbázis-alapú cooldownnal
  védett és titokmentesen auditált.
- Csak explicit `ENV_FALLBACK` mód olvashat `UNAS_API_KEY` értéket; hiányzó
  singleton és sérült DATABASE envelope nem aktiválhat implicit fallbacket.
- A cooldown döntése PostgreSQL `CURRENT_TIMESTAMP` alapján atomikus. Cooldown
  elutasítás nem generál korlátlan audit-spamet; a tényleges manuális ellenőrzés
  és az elavult `STALE_TEST_RESULT` továbbra is auditált.
- Production startup fail-fast ellenőrzi a singletont, minden módban az aktív
  írási főkulcsot, ENV_FALLBACK módban az env credential meglétét, DATABASE
  módban a hivatkozott verziót és az envelope-ot. DISABLED credential nélkül
  érvényes.
- A login lejárata közös, injektálható órát használó szabály szerint validált;
  lejárt, túl rövid vagy irreális jövőbeli expiry nem kerül token cache-be.
