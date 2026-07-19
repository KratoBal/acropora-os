# UNAS Apply Import Engine

> Az emberi brand review és a megerősített admin felület: [UNAS-BRAND-REVIEW-UI.md](./UNAS-BRAND-REVIEW-UI.md).

Az approval a #0006.9-től a külön mentett review döntéseket használja. Kompatibilitási okból a korábbi, teljes `brandDecisions` payload továbbra is elfogadott, de az admin UI üres approval payloadot küld, és a backend tranzakcióban ellenőrzi, hogy nem maradt `PENDING` sor.

## Biztonsági határ

Az Apply Import egy korábban stagingelt, validált és explicit jóváhagyott UNAS katalógus-batch domainalkalmazása. Nem olvas új XLSX fájlt, nem hoz létre Brand rekordot, nem módosít készletet, StockMovementet, vevőt, rendelést vagy árat, és nem töröl vagy archivál automatikusan terméket.

## API és jogosultság

Mindkét művelet `products.manage` jogosultságot igényel:

- `POST /imports/unas/:batchId/approve`
- `POST /imports/unas/:batchId/apply`

A jóváhagyás minden `BrandResolutionReview` sorhoz explicit döntést követel:

```json
{
  "brandDecisions": [
    { "sourceRowNumber": 12, "decision": "ACCEPT", "brandKey": "eheim" },
    { "sourceRowNumber": 13, "decision": "NO_BRAND" }
  ]
}
```

`ACCEPT` csak a dry-run evidence-ben szereplő jelöltre mutathat. Hiányzó, duplikált vagy ismeretlen döntés elutasítja a teljes jóváhagyást. `NO_BRAND` tudatos döntés, nem automatikus fallback.

## Állapotgép és preflight

`STAGED → VALIDATED → APPROVED → APPLIED`; elavult elemzés `STALE` állapotot kap. Apply kizárólag `APPROVED` állapotból indulhat.

Jóváhagyás és apply előtt kötelező:

- az analysisVersion egyezzen az aktuális `brand-resolution-config-v2` verzióval;
- ne legyen invalid staging sor vagy report-szintű validation error;
- minden review sor kapjon döntést;
- a batch ne legyen más állapotban.

Az `APPLIED` batch ismételt apply hívása a tárolt apply riportot adja vissza és nem ír új rekordot.

## Egytranzakciós folyamat

Az Apply `SERIALIZABLE` Prisma tranzakcióban, 120 másodperces tranzakciós limittel fut:

1. batch és review állapot újraellenőrzése;
2. kategóriák upsertje UNAS ExternalReference alapján;
3. kategóriafa parent kapcsolatainak rendezése;
4. létező Brand rekordok illesztése a verziózott szótár aliasaihoz;
5. Product és alapértelmezett ProductVariant upsert external ID/SKU alapján;
6. UNAS ProductCategory kapcsolatok és legacy primary pointer szinkronja;
7. UNAS képek sorrendtartó szinkronja;
8. UNAS ChannelListing upsert nyers státusszal és SEO-mezőkkel;
9. Product ExternalReference upsert;
10. UNAS-forrású ProductRelation kapcsolatok szinkronja;
11. determinisztikus DomainEvent rekordok;
12. batch `APPLIED` állapota és apply riportja.

Bármely hiba rollbackeli a teljes tranzakciót. A batch `APPROVED` marad, így a probléma javítása után biztonságosan újrapróbálható. Részleges domainállapot vagy félkész apply riport nem marad.

## Entitásszinkron és ownership

- Category: external ID alapján upsert. A slug `unas-<externalId>-<name>` alakú; a kategórianév nem globálisan egyedi, mert a valós fa ismétlődő neveket tartalmaz.
- Product: external reference, majd SKU fallback. Név és leírás frissül; hiány a következő exportban nem jelent törlést vagy archiválást.
- ProductVariant: SKU alapján egy alapértelmezett variáns.
- ProductCategory, ProductImage és ProductRelation: csak `source=UNAS` rekordok cserélhetők. Manuális kapcsolatok megmaradnak.
- ChannelListing: az UNAS 0/1/2/3 státusz kizárólag raw `externalStatus`; nem módosít automatikusan aktivitást vagy publikáltságot.
- Brand: csak meglévő Brand társítható. A feloldott, de törzsadatban nem létező brand számlálóba kerül és nem jön létre automatikusan.

## Idempotencia és események

A batch egyszer alkalmazható. Product és Category upsert ExternalReference/SKU alapján determinisztikus. A DomainEvent ID a batch, event type és aggregate azonosítóból SHA-256-tal képzett stabil kulcs.

Események:

- `product.created`
- `product.updated`
- `catalog-import.applied`

Az események ugyanabban a tranzakcióban jönnek létre, mint az entitásváltozások. Event publisher továbbra sincs implementálva.

## Apply riport

A riport create/update és szinkronizált Category, Product, Variant, ProductCategory, ProductImage, ProductRelation, ChannelListing, ExternalReference és DomainEvent darabszámokat, valamint a törzsadat hiánya miatt nem társítható brandek számát tartalmazza.

## Üzemeltetési korlátok

- A valós 1 884 termékes batch nem alkalmazható automatikusan: 881 review sor üzleti döntést igényel.
- Nagy batch tranzakciós idejét production-közeli adatmennyiségen mérni kell.
- Nincs progress UI, background job, retry queue vagy event publisher.
- Nincs automatikus Brand-létrehozás, ár-, készlet-, vevő- vagy rendelésimport.
