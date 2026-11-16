# A ticket@ postafiókba érkező levelek → hibajegy-vázlat

Kártya: ec7b947b. Terv: a flotta `agents/murena/ticket-ai-terv-2026-11-16.md` fájlja. A ticket@acropora.hu postafiókba érkező hibabejelentések a Szerviz / Piszkozatok listára kerülnek, ugyanabba a `ServiceTicketDraft` táblába, amelyet a Cápasuli napi jelentők is használnak. **Hibajegy csak akkor jön létre, ha egy belső OWNER vagy ADMIN elfogadja a vázlatot** (az elvetett vázlat nem foglal jegyszámot, és a lista „Elvetett” fülén megmarad). A beolvasás alapból **ki van kapcsolva**.

Állapot ebben a változatban: a beolvasás, az elfogadás, a lista és a push kész; az AI-kitöltés (S3) **még nincs**, ezért a bekapcsolt feladó vázlata `AI nélkül` jelzéssel áll, a levél szövegével.

## A három bejövő ág, egy listában

A levél feladója a `From` fejlécből jön, **de csak akkor hiszünk neki, ha a Gmail saját hitelesítési eredménye igazolja** (lásd lent). A vázlat `intakeState` mezője mondja meg, melyik ág:

| Ág                                     | Mikor                                                                                | Mi áll a vázlaton                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `AI_UNAVAILABLE` (`AI nélkül`)         | igazolt feladó, belső aktív felhasználó, **be van jelölve az „E-mail AI figyelése”** | a felhasználó neve, egyetlen hozzárendelt helyszíne javaslatként (több vagy nincs: üres), push a menedzsereknek |
| `WATCH_OFF` (`Figyelés kikapcsolva`)   | igazolt feladó, belső aktív felhasználó, a jelölés **nincs** bekapcsolva             | a felhasználó neve, helyszín nélkül, push nélkül                                                                |
| `UNKNOWN_SENDER` (`Ismeretlen feladó`) | bárki más, és minden feladó, akinek a `From` fejléce nem igazolható                  | se név, se helyszín, push nélkül                                                                                |

Az `AI_DRAFT` az AI-kitöltés (S3) állapota lesz; a `RULE_DRAFT` a Cápasuli sorok jele. Ugyanaz a lista mind: a különbség a jelvény, és forrás szerint szűrhető (Minden forrás / Ticket levelek / Cápasuli jelentők).

Az „E-mail AI figyelése” a felhasználó adatlapján jelölhető (`TICKET_MAIL_AI_WATCH` képesség), **csak a felhasználó-szerkesztővel** (`users.manage`: OWNER, ADMIN), a felhasználó a sajátját nem jelölheti. Alapérték: ki. A push szerepe: „AI hibajegy-vázlat felelős” (`SERVICE_TICKET_AI_DRAFT`), szintén a felhasználó adatlapján.

## Elfogadás

A kezelő az összes aktív helyszínből választ (aktív, nem archivált ügyfélnél); a feladó hozzárendelt helyszíne csak előre kijelölt javaslat. A jegyet az **ismert, még aktív feladó** nyitja, különben az elfogadó kezelő. A csatolmányok közül a kép fotóként, a PDF egyéb dokumentumként kerül a jegyre. Kétszeri elfogadás egy jegyet ad (`service-draft:<vázlat azonosító>`). A Cápasuli vázlat elfogadása változatlan.

## Biztonság

- **Csak olvasás.** A postafiókból csak GET kérés megy (egyetlen POST: az OAuth frissítés); a kliens nem küld, nem címkéz, nem töröl. A token ugyanaz, mint a küldő `GMAIL_TICKET_*` (gmail.readonly + gmail.send, acrobot döntése), de az olvasó külön nevet kap (`GMAIL_TICKET_READ_*`); hogy az olvasó nem küld, az a kódon és a teszten áll.
- **A `From` nem hiteles magában.** **Minden** `mx.google.com` szerkesztő-azonosítójú `Authentication-Results` fejlécet RFC 8601 szerint bontunk, és mindnek ugyanazt kell mondania: **pontosan egy** `dmarc` eredmény, `pass`, és a `header.from` ugyanabban az eredményben egyezik a `From` domainjével. A szabály a fejlécek **sorrendjétől független**: a feladó maga is írhat Gmail-azonosítójú fejlécet a levélbe, ezért egyetlen bukó, kétértelmű vagy más domaint nevező fejléc is nem igazolttá teszi a levelet, bárhol áll; a hamis fejléc legfeljebb a saját levelét rontja el. Más szerkesztő-azonosítójú, jól formált fejlécet figyelmen kívül hagyunk (legalább egy Gmail-fejléc kell), a Gmail-nek induló hibás fejléc sosem hiteles. A megjegyzések, idézetek és más eredmények szövegét (a boríték-feladó helyi része támadói szöveg lehet) soha nem olvassuk dmarc eredménynek; hibás fejléc, több `From` fejléc: nem igazolt. Ami nem igazolt, az ismeretlen feladó.
- **Gépi levél sosem vázlat:** saját cím, no-reply és postmaster feladó, `Auto-Submitted` (nem `no`), `Precedence: bulk|list|junk|auto_reply`, `List-Id`. A kihagyott levél is egy `ServiceDraftMail` sort kap (`skipReason`), hogy ne olvassuk újra.
- **Korlátok:** futásonként legfeljebb 50 új levél (a többi a következő futásra marad, a legrégebbitől haladva); egy ismeretlen cím óránként 5, az összes ismeretlen feladó együtt óránként 30 vázlatot kaphat, ami felette van, `CAPPED` jelzéssel rögzül, de nem kerül a listára.
- **Mérgezett levél:** ha egy levél felvétele elbukik, az adatbázisban számoljuk (`ServiceDraftMailFailure`), és 3 sikertelen futás után `FAILED` sorral, szöveg nélkül lezárjuk, hogy ne foglalja el a futás helyeit. A postafiók-kapcsolat hibája (token, korlát, időtúllépés, hálózat, 5xx) nem számít levélhibának. A mentett szövegekből a NUL karakter kimarad. Más, nem Gmail eredetű hiba (például egy túlterhelt adatbázis időtúllépése) levélhibának számít: a státusz `sealed` száma mutatja.
- **A csatolmány idegen fájl:** csak tartalom szerint felismert PDF, JPEG és PNG, legfeljebb 10 fájl és 10 MiB fájlonként (25 MiB levelenként); ami kimarad, azt a vázlat számolja (`droppedAttachments`).
- **A levél szövege idegen szöveg.** A vázlat szövege a levél tisztított olvasópéldánya (az idézett válasz, az aláírás levágva), **nem redakció**. Az AI-kitöltés (S3) csak redaktált szöveget kap (Balázs döntése, 2026-11-16), mezőket tölt ki, és semmit nem indíthat el.

## Beállítás (env)

A bekapcsolás acrobot lépése, a valódi tesztlevél mérése után (az S2 vége).

| Változó                                                           | Jelentés                                      | Alapérték                                                                |
| ----------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `GMAIL_TICKET_INTAKE_ENABLED`                                     | a beolvasás kapcsolója                        | `false` (ismeretlen érték is ki)                                         |
| `GMAIL_TICKET_READ_CLIENT_ID`, `_CLIENT_SECRET`, `_REFRESH_TOKEN` | az olvasó OAuth hármasa                       | nincs                                                                    |
| `GMAIL_TICKET_READ_USER`                                          | a postafiók                                   | `ticket@acropora.hu`                                                     |
| `GMAIL_TICKET_READ_QUERY`                                         | a lekérdezés                                  | `in:inbox -in:spam -category:promotions -category:social newer_than:14d` |
| `TICKET_MAIL_INTERVAL_MINUTES`                                    | a futás gyakorisága                           | 10 (5 és 1440 között)                                                    |
| `TICKET_MAIL_MAX_PER_RUN`                                         | új levél futásonként                          | 50                                                                       |
| `TICKET_MAIL_UNKNOWN_SENDER_PER_HOUR`                             | egy ismeretlen cím óránként                   | 5                                                                        |
| `TICKET_MAIL_UNKNOWN_TOTAL_PER_HOUR`                              | az összes ismeretlen feladó együtt óránként   | 30                                                                       |
| `TICKET_MAIL_MAX_ATTEMPTS`                                        | hány futás után zárjuk le a mérgezett levelet | 3                                                                        |

Állapot a vezérlőpulton: a Piszkozatok oldal „Ticket postafiók feldolgozás” része (`GET /service/drafts/ticket-mail/status`, belső OWNER és ADMIN).

## Nem mért, nyitott

- **A beolvasás bekapcsolásának FELTÉTELE egy valódi tesztlevél mérése** (az S2 vége): nem mértük, hogy a Gmail API a ticket@ postafiókban a fenti alakú, Gmail-azonosítójú `Authentication-Results` fejlécet adja-e. Ha ilyen fejléc nincs, minden levél ismeretlen feladó lesz (ez a biztonságos irány). A szabály a sorrendtől független, ezért a sorrend mérése már nem a biztonságot dönti el. Ami a szabályon kívül marad: ha a Gmail saját fejléce hiányozna a levélről, egy hamis fejléc egyedül átmenne; a Gmail mindig hozzáadja a sajátját, és a tesztlevél ezt méri.
- Az AI-kitöltés (S3) nincs meg; a `PD-001` elvhez a szűrt szöveg Balázs döntése szerint megy.
- Egy meglévő levélre érkező válasz külön tételként jelenik meg; összefésülés nincs.
