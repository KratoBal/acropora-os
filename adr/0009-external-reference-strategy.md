# ADR-009 – Központi external reference stratégia

## Állapot

Elfogadva – 2026-07-19

## Kontextus

Az UNAS, Számlázz.hu és későbbi integrációk azonosítóinak domainmodellekben szétszórt mezői providerfüggővé tennék a contexteket és megnehezítenék az idempotens szinkront.

## Döntés

Minden külső megfeleltetést az Integrations context `ExternalReference(system, entityType, entityId, externalId)` modellje birtokol. A kapcsolat szándékosan polimorf, adatbázis-foreign key helyett alkalmazásszintű entity type registryvel és validációval.

## Következmények

- Új provider sémamódosítás nélkül felvehető.
- Egyediség védi a belső és külső megfeleltetést.
- A hivatkozott aggregate létezését és törlését az integration service ellenőrzi.
- Provider-specifikus metadata csak integrációs adat, nem üzleti source of truth.
