# Árajánlat P4a – kézi elfogadás, elutasítás, halasztás, visszavonás

Jóváhagyott terv: [#1582](https://github.com/KratoBal/acropora-os/issues/1582#issuecomment-6036894392), „P4a Kézi elfogadás, elutasítás”.
Döntés: elfogadáskor rögzítjük a kért opcionális tételeket (Balázs, 2026-10-07, 2. pont).

## Végpontok

| Végpont                                      | Jogosultság                |
| -------------------------------------------- | -------------------------- |
| `POST /quotes/:id/acceptances`               | `quotes.acceptance.record` |
| `POST /quotes/:id/acceptances/:a/revoke`     | `quotes.acceptance.record` |
| `POST /quotes/:id/reject` (ok kötelező)      | `quotes.manage`            |
| `POST /quotes/:id/postpone` (dátum kötelező) | `quotes.manage`            |
| `POST /quotes/:id/cancel` (ok nem kötelező)  | `quotes.manage`            |

Mind az öt a frissített ajánlatot adja vissza, a jogfüggő mapperen át.

## Állapotok

```
DRAFT, SENT, POSTPONED  (nyitott)
   ├─ elfogadás (csak PUBLISHED verzió) ──> ACCEPTED
   ├─ elutasítás okkal ──────────────────> REJECTED   (végleges)
   ├─ halasztás dátumra ─────────────────> POSTPONED  (nyitott marad)
   └─ visszavonás ───────────────────────> CANCELLED  (végleges)
ACCEPTED
   └─ az elfogadás visszavonása indokkal ─> SENT, ha volt kiküldés, különben DRAFT
      (csak amíg a projekt nem indult el: HANDOFF_EXECUTED esemény után 409)
```

Elfogadott ajánlat nem utasítható el, nem halasztható, nem vonható vissza és
nem publikálható új verzióval: előbb az elfogadást kell visszavonni. A
REJECTED és a CANCELLED újranyitása nincs a tervben.

## Amit az adatbázis maga őriz

- Ajánlatonként legfeljebb egy élő (nem visszavont) elfogadás: részleges
  egyedi index (`QuoteAcceptance_one_live_per_quote_idx`). Két ember egyszerre,
  vagy egy dupla kattintás egy sort ad; a másik 409.
- Az elfogadott verzió ugyanahhoz az ajánlathoz tartozik: összetett idegen
  kulcs `(quoteVersionId, quoteId)`.
- Az ajánlat állapota és oszlopai egyeznek: ACCEPTED ⇔ `acceptedVersionId`,
  POSTPONED ⇔ `postponedUntil`, REJECTED ⇒ `closeReason` (CHECK-ek).
- Egy kliens-ismétlés ugyanazzal a `requestId`-vel ugyanazt az elfogadást
  kapja vissza (egyedi oszlop).

## Mi íródik

Minden lépés zár alatt, egy tranzakcióban: `QuoteEvent` (a payload csak
enum-értéket és dátumot visz: `source`, `closeReason`, `postponedUntil`, soha
nevet vagy megjegyzést) és `AuditLog`. Elfogadáskor `DomainEvent quote.accepted`
is (`quoteNumber`, `versionNumber`, `acceptanceId`).

## Ami nincs benne

- Publikus elfogadó link: P4b.
- A follow-up feladatok lezárása elfogadáskor: a QUOTE forrású feladatok a
  P7-ben jönnek létre, addig nincs mit lezárni.
- Lejárt ajánlat: a kézi elfogadás engedett, a felület figyelmeztet (terv,
  „Amit magam döntöttem el”).
