# Árajánlat P3 – kiküldés emailben

Jóváhagyott terv: [#1582](https://github.com/KratoBal/acropora-os/issues/1582#issuecomment-6036894392), „P3 Email”.

## Végpontok

| Végpont                                  | Jogosultság   |
| ---------------------------------------- | ------------- |
| `GET /quotes/:id/versions/:v/send-draft` | `quotes.send` |
| `POST /quotes/:id/versions/:v/send`      | `quotes.send` |
| `POST /quotes/:id/versions/:v/resend`    | `quotes.send` |

A kiküldések az ajánlat részletében jönnek (`deliveries`, a legújabb elöl),
külön lista-végpont nincs.

## A küldés lépései

1. Ugyanaz a `requestId` a rögzített kísérletet adja vissza, levél nélkül.
2. Csak egy még élő ajánlat (DRAFT, SENT, POSTPONED, ACCEPTED) PUBLISHED
   verziója mehet ki; felülírt verzió 409. Az első küldés és az újraküldés két
   külön végpont: egy kiment verzió a `send`-en 409, egy ki nem ment a
   `resend`-en 409.
3. Címzett, tárgy, szöveg: hibás cím 400, még a foglalás előtt.
4. A levél-kapu: `TICKET_MAIL_MODE`, az új `TICKET_MAIL_QUOTE`, a próbacím és a
   küldő. Zárva 503, egy mondattal, sor nélkül.
5. A publikáláskor tárolt PDF megy csatolmányként, újrarajzolás nélkül.
6. Feltételes foglalás a verzión (`sendingSince`, új oszlop): egyszerre egy
   küldés. Egy 10 percnél régebbi foglalás elakadt küldésnek számít.
7. Egy küldés, utána egy tranzakcióban: a kézbesítési sor (`QuoteMailDelivery`,
   kimenet SENT, FAILED vagy INDETERMINATE), a foglalás feloldása, sikeres
   küldésnél a DRAFT ajánlat SENT lesz, a `SENT` vagy `SEND_FAILED` esemény és az
   audit-sor.

Migráció: `20261008080000_quotes_p3_mail`.

## A levél szövege

A Levelezés oldal új eseménye: „Árajánlat kiküldése” (`QUOTE_SEND`), az
ajánlat saját változóival (`ajanlat_ugyfele`, `ajanlat_szama`,
`ajanlat_megnevezese`, `ajanlat_verzioja`, `ajanlat_ervenyes`) és a
`kuldo_neve`-vel. A kiküldő fiók ezzel nyílik meg, a változók már kitöltve, és
küldés előtt minden átírható. A levél sima szöveg, a PDF csatolmány.

## Ami szándékosan más, mint a tervben

- A billing küldő-útját nem emeltem ki közös segédbe: a karbantartási levél
  sem így készült, és a számla-kiküldés így változatlan marad (a terv ezt
  közepes kockázatnak nevezte). A közös darabok (kapu, címzett-ellenőrzés,
  fejléc-tisztítás, küldő) ugyanazok.
- Az utánkövetési feladatok (`after-send`, `before-expiry`) a P7-ben jönnek.
- Az „elfogadó link mellékelése” a P4b után.
