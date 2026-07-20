# M1 Stabilization Review

Ellenőrzés dátuma: 2026-07-19

## Scope

Az ellenőrzés az M1 Brand Import lezárása utáni technikai stabilizációra terjed ki. Nem változtatja meg a Brand Import üzleti szabályait és nem készít új domainfunkciót.

## Talált problémák

- Nem volt GitHub Actions workflow, ezért a repository nem ellenőrizte automatikusan a frozen installt, migrációkat, seedet, integration teszteket és production buildet.
- Nem volt olyan teszt, amely a teljes Nest `AppModule` runtime dependency graphját felépítette volna; emiatt egy hibás decorator metadata csak kézi indításkor derült ki.
- A meglévő `GET /health` végponthoz nem volt valódi HTTP-szintű Nest smoke teszt.
- A `.gitignore` nem tiltotta általánosan a SQL dumpokat, adatbázismentéseket, valós CSV/XLS/XLSX exportokat és több import report formátumot.
- Nem volt gyökérszintű `SECURITY.md` a privát sérülékenység-jelentési folyamathoz.
- A README quick start folyamatából hiányzott a Prisma generate, migrate és seed lépés, a parancslista pedig nem fedte le a teszt- és migrációs workflow-t.
- A CONTRIBUTING nem írta le az infrastruktúrát igénylő ellenőrzéseket és az importadatokra vonatkozó repository-safety szabályokat.
- A repository nem tartalmaz `LICENSE` fájlt. A gyökér `package.json` `UNLICENSED` értéket használ; ebből nem következik hozzáadható nyílt forrású licenc.

## Elvégzett módosítások

- Teljes Nest application-context bootstrap teszt készült, amely feloldja az `AuthService` és `AuthUserResolver` runtime providereket, majd bezárja a module reference-t és a Prisma kapcsolatot.
- A meglévő health endpointhoz valódi Nest HTTP application instance-on futó smoke teszt készült. A teszt 200 választ, valamint application/database/redis `ok` állapotot vár, és bezár minden megnyitott kapcsolatot.
- CI workflow készült PostgreSQL 16 és Redis 7 service konténerrel, frozen installal, Prisma migrate deploy és seed lépéssel, statikus ellenőrzésekkel, unit/integration/bootstrap/smoke tesztekkel és production builddel.
- Külön `prisma:deploy`, `test:bootstrap` és `test:smoke` parancs készült.
- A `.gitignore`, README és CONTRIBUTING a tényleges workspace parancsokhoz és adatbiztonsági követelményekhez igazodott.
- Gyökérszintű `SECURITY.md` készült GitHub private vulnerability reporting útmutatással.
- A `docs/CURRENT_STATUS.md` az M1 elkészült állapotát és a stabilization → M2 sorrendet rögzíti.

## Nyitva maradt kockázatok

- Nincs formális LICENSE. Licencet a repository tulajdonosának kell kiválasztania; automatikusan nem adható hozzá.
- A GitHub private vulnerability reporting tényleges engedélyezettsége repository-beállítás, lokálisan nem ellenőrizhető.
- A teljes Git history secret scan nem történt meg. A jelenlegi tracked fájlok és ignore-szabályok vizsgálata nem helyettesíti a történeti és remote secret scanninget.
- A GitHub Actions workflow tényleges hosted-runner futása csak push vagy pull request után igazolható teljesen; lokálisan a benne szereplő parancsok ellenőrizhetők.
- A web production build a `next/font` Google Fonts letöltésétől függ, ezért a hosted CI hálózati hibája a kódtól független buildhibát okozhat.
- A development auth továbbra is jelszó nélküli, memóriában tárolt sessiont használ, és kizárólag development célú.
- A health smoke külső PostgreSQL és Redis szolgáltatást igényel; infrastruktúra nélkül szabályosan sikertelen.

## M2 előtt ajánlott lépések

1. Futtasd és ellenőrizd az első GitHub Actions CI run eredményét.
2. Engedélyezd vagy ellenőrizd a GitHub private vulnerability reporting és secret scanning beállításait.
3. Tulajdonosi döntéssel tisztázd a repository licencét.
4. Készíts helyreállítási próbával ellenőrzött development/production backup eljárást a repositoryn kívül.
5. Csak zöld stabilization suite és review után kezdd el az M2 Product Import fejlesztését.
