# ADR-006 – Providerfüggetlen authentication absztrakció

## Állapot

Elfogadva – 2026-07-19

## Kontextus

A rendszernek már a korai fejlesztés során több felhasználót és szerepkört kell kezelnie, miközben a végleges identity provider, session-infrastruktúra és üzemeltetési környezet még nincs kiválasztva. Egy konkrét szolgáltató közvetlen beépítése korán összekötné a domainmodellt a provider saját típusaival és életciklusával.

## Döntés

Az alkalmazás saját, providerfüggetlen `AuthenticatedUser` és `Session` szerződést használ. A webes auth állapot egy `AuthAdapter` interfészen keresztül működik. Az API guardjai validált domainfelhasználót kapnak az `AuthService` rétegtől, és nem ismerik a token kibocsátóját.

A jelenlegi adapter és API session-store kizárólag fejlesztési implementáció. Production környezetben a development login tiltott.

## Következmények

- Az identity provider később adaptercserével integrálható.
- A role/permission domainmodell nem függ külső claims-elnevezésektől.
- A provider claims és az Acropora role-ok közötti leképezést a későbbi adapternek kell elvégeznie.
- A mock session nem jelent production biztonsági megoldást, és nem használható valós adatokkal.
