# ADR-007 – Eseményalapú készletnyilvántartás

## Állapot

Elfogadva – 2026-07-19

## Kontextus

Egy közvetlenül írható készletmező nem magyarázza meg az egyenleg eredetét, nehezen auditálható, és párhuzamos értékesítési, beszerzési és szervizfolyamatok mellett könnyen inkonzisztenssé válik.

## Döntés

A készlet source of truth-ja a postolt `StockMovement` és `StockMovementLine` főkönyv. A `StockItem` kizárólag újraépíthető olvasási projection. Postolt mozgás nem módosítható; hibát ellenmozgással korrigálunk.

## Következmények

- Minden készletváltozás eredete és aktora visszakövethető.
- A projection gyors lekérdezést ad, miközben rekonstruálható.
- A postolás, idempotencia és konkurenciakezelés alkalmazásszintű tranzakciót igényel.
- A costing, lot és serial részletszabályai későbbi döntések.
