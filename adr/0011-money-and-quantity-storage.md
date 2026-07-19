# ADR-011 – Pénz- és mennyiségtárolási stratégia

## Állapot

Elfogadva – 2026-07-19

## Kontextus

A lebegőpontos számítás kerekítési hibát okoz, a mértékegység vagy pénznem nélküli érték pedig üzletileg nem értelmezhető. A beszerzés, értékesítés és labor eltérő pontosságot igényel.

## Döntés

Pénz `Decimal(19,4)` és ISO 4217 hárombetűs pénznemkód. Általános mennyiség `Decimal(19,6)` és explicit unit; ICP érték legfeljebb nyolc tizedes. Az adatbázis nem végez automatikus deviza- vagy mértékegység-konverziót. Időpontot UTC-ben tárolunk.

## Következmények

- Nincs floating point pénzhiba, és a pontosság deklarált.
- API-határon a decimális érték stringként továbbítandó.
- Összegzés előtt pénznem- és unit-egyezést kell validálni.
- Árfolyam, rounding policy és unit conversion külön későbbi domain szolgáltatás.
