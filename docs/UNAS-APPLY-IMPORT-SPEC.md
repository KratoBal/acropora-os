# UNAS Apply Import specifikáció

Ez a dokumentum a későbbi apply végrehajtó szerződése. A #0006.6 nem valósít meg Apply Import endpointot vagy adatírást.

> Implementációs állapot: az első tranzakciós backend engine a #0006.8-ban
> elkészült. Aktuális működés: `docs/UNAS-APPLY-ENGINE.md`.

## Jóváhagyás és állapotok

Apply-t kizárólag `products.manage` jogosultságú aktív felhasználó indíthat, külön, vissza nem vonható következményeket összegző megerősítéssel. Javasolt állapotok: `STAGED → VALIDATED → APPROVED → APPLYING → APPLIED`, illetve `REJECTED`, `STALE`, `FAILED`.

- `ERROR` issue-t tartalmazó batch nem hagyható jóvá és nem alkalmazható.
- A jóváhagyás rögzítse a felhasználót, időpontot, riportverziót és forráshash-t.
- Apply előtt új diff készül. A jóváhagyás óta változott célrekord vagy konfiguráció a batch-et `STALE` állapotba teszi és új jóváhagyást követel.
- Ugyanaz a provider + SHA-256 csak egy sikeres logikai importot azonosíthat.

## Tranzakciós stratégia

Egy előkészítő szakasz minden external reference-et, mappinget és constraintet ellenőriz. Ezután egy adatbázis-tranzakcióban történik:

1. kategóriák topologikus upsertje és `ExternalReference`;
2. előzetesen jóváhagyott brand-feloldás;
3. Product és alapértelmezett ProductVariant upsert;
4. ProductCategory teljes, determinisztikus szinkronja, pontosan egy primary kapcsolattal;
5. képek sorrendtartó szinkronja;
6. UNAS ChannelListing és Product szintű ExternalReference upsert;
7. az alkalmazott változásokat leíró DomainEvent és AuditLog;
8. batch `APPLIED` állapota és apply-összesítője.

Az egész batch egy tranzakcióban fusson, amíg a mérés ennek elfogadható zárási és lock idejét igazolja. Ha később chunkolás szükséges, az csak explicit checkpointtal és kompenzációs tervvel vezethető be; észrevétlen részleges siker tilos.

## Idempotencia és rekordfeloldás

A bemenet azonosságát a nyers fájl SHA-256, provider és parser/schema verzió együtt adja. Létező rekordot elsődlegesen az `ExternalReference(system=UNAS, entityType, externalId)`, termékvariánst pedig ellenőrzött SKU fallback old fel. Ellentmondó external ID/SKU blokkoló hiba. Az upsertek és kapcsolatszinkronok determinisztikusak; egy már `APPLIED` batch ismétlése no-op és az eredeti apply riportot adja vissza.

## Hiány és törlés

Az exportból hiányzó Acropora OS terméket, kategóriát, képet vagy kapcsolatot alapértelmezetten nem törlünk és nem archiválunk. Automatikus archiválás csak külön üzleti szabállyal, teljes export igazolásával és külön jóváhagyással engedhető. A legacy `Product.categoryId` kompatibilitási pointer nem forrásigazság.

## Hibakezelés és helyreállítás

Hiba esetén a tranzakció rollbackel, a batch `FAILED` állapotba kerül a személyes adatot és secretet nem tartalmazó hibakóddal. Újrapróbálás ugyanazon immutable stagingből, új próbálkozás-azonosítóval lehetséges. AuditLog rögzíti az approvert, executort, állapotváltásokat és darabszámokat. Külső mellékhatás (kép letöltés, üzenetküldés) nem lehet az adatbázis-tranzakció része; outbox-alapú későbbi feldolgozás kell. Egy sikeresen commitolt apply általános automatikus visszagörgetése nem ígérhető: korrekciós import vagy célzott domainművelet szükséges.

## Készlethatár

A katalógusimport nem írhat aktuális készletet, StockItem értéket vagy StockMovement rekordot. Nyitókészlet külön, ellenőrzött `OPENING_BALANCE` StockMovement migráció. Az ismétlődő UNAS készletszinkron külön integrációs stratégia és source-of-truth döntés tárgya.

## Mezőszintű tulajdon

| Adat                                       | Elsődleges forrás az első migrációnál | Hosszú távú szabály                                                   |
| ------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------- |
| UNAS external ID, slug, URL, nyers státusz | UNAS                                  | ChannelListing/ExternalReference őrzi                                 |
| Név, leírás, kategóriák, képlinkek         | UNAS                                  | read-only mirror; az UNAS a Product Master                            |
| Brand                                      | jóváhagyott mapping                   | Acropora OS törzsadat; ismeretlen név nem hozható létre automatikusan |
| UNAS 0/1/2/3 státusz jelentése             | nincs meghatározva                    | üzleti mappingig csak raw `externalStatus`                            |
| Mirror lifecycle állapot                   | UNAS teljes snapshot                  | hiányból nem következik azonnali archiválás                           |
| Eladási ár                                 | UNAS                                  | read-only mirror; beszerzési ártól elkülönítve                        |
| Készlet                                    | készletmozgások főkönyve              | UNAS katalógusimport soha nem írja közvetlenül                        |

A hosszú távú ownershipot az
[ADR-013](../adr/0013-unas-product-master-and-local-extension.md), a következő
szinkronmérföldkövet az
[M2.1 UNAS Product Synchronization](./M2.1-UNAS-PRODUCT-SYNCHRONIZATION.md)
rögzíti.

## Helyi reprodukció

```bash
docker compose up -d --wait
pnpm --filter @acropora/database prisma:generate
pnpm --filter @acropora/database exec prisma migrate dev
pnpm prisma:seed
node apps/api/scripts/merge-unas-catalog.mjs <products.xlsx> <categories.xlsx> </private/tmp/catalog.xlsx>
```

DB-integrációs tesztet kizárólag külön adatbázissal futtass:

```bash
DATABASE_URL=postgresql://acropora:acropora@localhost:5432/acropora_test_0006_6 pnpm --filter @acropora/api test:integration
```
