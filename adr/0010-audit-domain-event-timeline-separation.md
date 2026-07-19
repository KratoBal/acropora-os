# ADR-010 – Audit, domain event és timeline szétválasztása

## Állapot

Elfogadva – 2026-07-19

## Kontextus

A technikai változásnapló, a géppel feldolgozható üzleti esemény és a felhasználóknak mutatott aktivitás eltérő célú, hozzáférésű és megőrzési idejű adat.

## Döntés

Az `AuditLog` biztonsági/technikai napló. A `DomainEvent` verziózott üzleti tény és integrációs szerződés. A `TimelineEvent` context-specifikus, lokalizálható olvasási modell. Egyik sem univerzális helyettesítője a másiknak.

## Következmények

- A retention és hozzáférés adattípusonként szabályozható.
- A timeline újraépíthető domain eseményekből, de kézi eseményt is tartalmazhat.
- Több tárolási és projection folyamat szükséges.
- Az outbox és timeline projector későbbi implementáció.
