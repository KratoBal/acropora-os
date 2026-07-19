# Biztonsági alapelvek

- API-kulcs soha nem kerül frontendbe vagy Git repositoryba.
- Titkok környezeti változókban vagy secrets managerben tárolandók.
- Számlázási és készletmódosítási műveletek teljes auditnaplót kapnak.
- Webhookok hitelességét ellenőrizni kell.
- Adminisztrátori és pénztárosi jogosultságok elkülönülnek.
- Adatbázisról napi mentés és rendszeres visszaállítási próba szükséges.
- Élesítés előtt HTTPS, rate limit, CSRF-védelem és biztonságos cookie-beállítás kötelező.
