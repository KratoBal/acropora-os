# Domain follow-up backlog

## Szándékosan elhalasztott kérdések

- termékvariáns attribútumséma, képek, dokumentumok, árlisták és árérvényesség;
- részletes termék- és élőlénytaxonómia;
- lot lejárat, karantén és teljes serial number életciklus;
- stock reservation, adjustment és stock count konkurenciakezelése;
- shipment/package, payment/refund és számlareferencia részletes állapotgépei;
- CRM contact, note, tag, consent history és timeline projection;
- service request/visit/task/material/time részletes aggregate-határai;
- aquarium equipment, livestock, maintenance és task részmodell;
- ICP sample, element definition, trend és AI/szakértői recommendation provenance;
- webhook delivery, import/export job és integration event payloadok.

## Nyitott üzleti döntések

- Engedhető-e negatív készlet, és mely role/context számára?
- Mekkora beszerzési mennyiség- és áreltérés fogadható automatikusan?
- Mi az order cancel és reservation release pontos tranzakciós sorrendje?
- Mely státuszok és események ügyfélláthatók?
- Milyen rounding szabály érvényes nettó–áfa–bruttó számításnál?
- A szolgáltatásanyag készletmozgása `SALE` vagy külön `INTERNAL_USE` típus legyen?

## Későbbi architekturális és optimalizációs munka

- Brand Resolution review UI, accept/reject műveletek és auditált döntési workflow;
- Brand Management CRUD, alias/prefix karbantartás és config verzió publikálás;
- resolver-szabályok regressziós katalógusa és üzleti tulajdonosa;

- transactional event outbox, retry és dead-letter stratégia;
- idempotens event consumer és schema compatibility teszt;
- nagy készletfőkönyv partitioning és projection rebuild;
- warehouse costing: FIFO, súlyozott átlag vagy más értékelési módszer;
- multi-company tenant- és jogosultsági modell;
- multi-currency árlista, árfolyam és realizált különbözet;
- accounting integration a referenciaalapú Finance context után;
- GDPR retention, anonimizálás, consent evidence és legal hold;
- livestock egyedi példánykezelés, származás és elhullás;
- taxonómiai provider és verziózott besorolások;
- lot/serial traceability és visszahívási folyamat;
- historikus projection és riportadatbázis.
