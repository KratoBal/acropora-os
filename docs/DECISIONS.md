# Döntési napló

## ADR-001 – A készlet elsődleges gazdája

**Döntés:** az Acropora ERP a készlet elsődleges nyilvántartása. Az UNAS az eladható webshopkészlet tükrét kapja.

## ADR-002 – Készletmozgás alapú modell

**Döntés:** minden változást megváltoztathatatlan készletmozgásként rögzítünk. Hibás bizonylatot ellenmozgással javítunk.

## ADR-003 – Külső integrációk queue-n keresztül

**Döntés:** UNAS- és Számlázz.hu-hívások háttérfeladatként futnak, egyedi idempotencia-kulccsal.

## ADR-004 – Bevételezéskor relatív készletváltozás

**Döntés:** normál bevételezés és eladás során `in/out` jellegű relatív változást küldünk. Teljes készletérték felülírása csak leltáregyeztetéskor használható.

## ADR-005 – Számlázz.hu elsődleges számlaszinkron, NAV napi ellenőrzés

**Dátum:** 2026-07-24

**Döntés:** a bejövő és kimenő **számlanyilvántartás** (M8.4) elsődleges,
push-alapú szinkronforrása a Számlázz.hu pénzügyi adatkapcsolata (M8.3). A
NAV Online Számla ehhez a nyilvántartáshoz kizárólag napi, független
teljességi/eltérés-ellenőrzésként (M9) kapcsolódik – nem elsődleges
adatforrás. Ez lezárja a korábban nyitott üzleti döntést (lásd
`ACROPORA-OS-MASTER-MILESTONE-PLAN.md` 11. fejezet, #6 pont).

**Kiterjesztés a bevételezésre:** a tulajdonos megerősítette, hogy hosszabb
távon a Számlázz.hu bejövő számla push (M8.3) **ki fogja váltani** a
2026-07-24-én épített, NAV `queryInvoiceDigest`/`queryInvoiceData`
lekérdezésen alapuló belföldi bevételezési segédletet
(`/beszerzes/nav-szamlak`) is. Ez **nem azonnali** változás: a NAV-alapú
bevételezési folyamat a Számlázz.hu-integráció megépüléséig változatlanul
üzemel, és a leváltás csak azután történik, hogy az M8 számlanyilvántartás
és a bejövő push-fogadás bizonyítottan működik. A NAV-alapú bevételezési
kód eltávolítása/deprecate-elése ezért **külön, jövőbeli munkacsomag**, nem
része az M8 kezdeti implementációjának.

**Miért:** a Számlázz.hu-nál a beszállítói/vevői számla a tényleges,
strukturált forrás (tételek, ÁFA-bontás, PDF), amit ő maga állít elő vagy
fogad be; a NAV Online Számla ugyanerre az adatra csak utólagos,
jelentési célú, kevésbé kényelmes lekérdezési felületet ad. A NAV
ugyanakkor a bejelentett számlák **teljességének** független ellenőrzésére
alkalmasabb, mint elsődleges munkafolyamat-forrásnak.

**Hogyan alkalmazzuk:** minden új M8-implementációs munka a Számlázz.hu
adatmodellt és push-fogadást tekinti elsődlegesnek; a NAV-integráció (M9)
csak ez után, ehhez képest egyeztető szerepben épül tovább. A meglévő
NAV-alapú bevételezési UI/kód (`/beszerzes/nav-szamlak`,
`NavIncomingInvoice`, `nav-online-invoice.client.ts`) érintetlen marad,
amíg a tulajdonos külön jóvá nem hagyja a leváltását.

## ADR-006 – M8.2 kimenő automatikus számlázás visszabontása read-only UNAS-tükörré

**Dátum:** 2026-07-27

**Döntés:** a korábban megépített M8.2 "kimenő automatikus számlázás" (worker

- állapotgép + lease/retry + Számlázz.hu Agent API `createInvoice` hívás +
  UNAS-visszaírás) teljes egészében visszabontásra került. A webshop
  (UNAS) rendelésekhez tartozó kimenő számlát **soha nem** az Acropora OS
  állítja ki – azt a UNAS beépített Számlázz.hu-modulja végzi. Az Acropora
  OS ehelyett egyirányú, read-only tükröt vezet: a meglévő UNAS
  rendelésszinkron (`unas-order-sync`) a `getOrder` válasz
  `Invoice.Status`/`Number`/`Url` mezőit `SalesOrder.unasInvoiceStatus`-ba
  és egy általános `Invoice` sorba (`source=UNAS`) másolja, konfliktus
  esetén (két rendelés ugyanarra a számlaszámra) felülírás nélkül. Ez lezárja
  a korábban nyitott architektúra-kérdést (lásd
  `ACROPORA-OS-MASTER-MILESTONE-PLAN.md`, "M8 – Számlázz.hu Integration and
  Invoice Registry", "Végleges architektúra (2026-07-27)" alfejezet, A) pont).

**Miért:** a UNAS Számlázz.hu-modulja már ki van fizetve és üzemel a
webshopon – egy párhuzamos, Acropora OS-oldali `createInvoice`-hívás
dupla számlázás, számsorrend-ütközés és jogi/adózási kockázat nélkül nem
építhető biztonságosan a jelenlegi UNAS-adatstruktúra mellett (nincs
UNAS-oldali "foglalás"/zárolás a dupla kiállítás ellen). Az egyirányú,
read-only tükrözés ugyanazt az üzleti célt (a webshop-számla adatai
látszanak Acropora OS-ben) kockázat nélkül szolgálja ki.

**Hogyan alkalmazzuk:** az Acropora OS soha nem hív Számlázz.hu Agent API
`createInvoice`-t webshop-rendeléshez, soha nem ír vissza számlaadatot a
UNAS-ba, és nem futtat számlázási workert/ütemezőt/lease-állapotgépet.
Hiányzó UNAS-adatot (dátum, összeg) nem szabad kitalálni vagy
rendelés-összegből levezetni – ezek a mezők `null` maradnak, amíg a
Számlázz.hu pénzügyi adatkapcsolat (M8.3, még nem implementált) utólag,
`invoiceNumber` alapján párosítva fel nem tölti őket. A nem-webshopos
(munkalap/POS/kézi) kimenő számlázás – ahol Acropora OS ténylegesen
kezdeményezhet Számlázz.hu API-hívást – külön, jövőbeli mérföldkő, ez a
döntés nem vonatkozik rá (lásd a milestone-terv C) pontja).

## ADR-007 – Az Acropora OS és a Medusa közötti azonosság, és az első vetítés

**Dátum:** 2026-08-25

**Döntés:** melyik Acropora OS termék melyik Medusa termék, azt az
`ExternalReference` táblában tartjuk nyilván, `MEDUSA` rendszerrel. **Nem új
szerkezet:** a leképezés a UNAS-nál is ezen áll, és a tábla két irányban
egyedi kulcsot visel (`[system, entityType, externalId]` és
`[system, entityType, entityId]`), tehát rendszerenként egy termékhez egy
külső azonosító tartozhat, és egy külső azonosítóhoz egy termék. Csak a
felsorolás értéke hiányzott, és
az `OTHER` használata nem megoldás lett volna, hanem összemosás: attól
kezdve nem lehetne megmondani, mi a Medusa és mi minden más.

**A kör állítása nem az átvitel, hanem a MEGISMÉTELHETŐSÉG.** Az
újrafuttatás nem hoz létre második terméket: ha van leképezés, a meglévőt
módosítja; ha nincs, előbb megnézi a célt is, a törölt sorokkal együtt, és
ha ott áll a mi külső azonosítónk, a leképezést helyreállítja ahelyett,
hogy újat hozna létre.

**Ahol nem lehet biztosan dönteni, megállunk, és a megállás előtt csak
olvastunk.** Négy ok: nincs cikkszám; a keresés kimerítette az ötvenes
limitet (csonkolt halmazon nem döntünk, mert a lista nem rendez); két élő
találat viseli ugyanazt az azonosítót; és a csak törölt találat, vagyis a
megszakadt azonossági lánc. Az utolsónál a létrehozás két terméket adna
ugyanazzal az azonosítóval, a visszaállításra pedig az admin API-n nincs
művelet, ezért a megállás a visszafordítható válasz.

**Az ár szándékosan kimaradt, és ez állítás, nem mulasztás.** A változat
ár-tömbje üresen megy: a mező azért van ott, mert a Medusa termék-létrehozó
végpontja megköveteli (mérve: `Invalid request: Field 'variants, 0, prices'
is required`, HTTP 400), a tartalma azért üres, mert az Acropora OS-ben
nincs önálló eladási ár, csak a webshop árának tükre. Ütemező sincs: az
első betöltés ember által indított, egyszeri művelet.

**Amit a kör közben MÉRTÜNK a Medusa oldalán** (2.19.0, a telepített
csomagokból, nem dokumentációból). Ezek a kikötések nem feltevések:

- a titkos API kulcs **teljes jogú**: jogkör-választás nincs, a `type` mező
  kétértékű (`publishable` vagy `secret`), és az nem jogkör;
- **lejárat mint mező nincs**, de a késleltetett visszavonás (`revoke_in`)
  ugyanazt tudja, tehát rövid élet mint képesség van;
- a **visszavonás azonnal hat**: a hitelesítés minden kéréshez az
  adatbázisból listáz, és nincs gyorsítótár a hitelesítési úton;
- a **`last_used_at` soha nem íródik**, tehát a felületén látható üres
  érték nem bizonyíték arra, hogy a kulcsot nem használják;
- a jogosultsági rendszer (`rbac`) **kapcsolótól függ**, és a kulcs sosem
  kap szerepkört: ha valaha bekapcsolják, a gépi hívásaink `403`-at kapnak.
  A `401` és a `403` ezért nem keverhető össze: az első a kulcsról szól, a
  második a másik oldal beállításáról.

**Amit a leképezés egyedisége NEM véd:** a Medusa sorát. Két párhuzamos
futás, ami nem talál leképezést, mindkettő létrehozhat odaát; a kulcs csak
a második leképezés-írást utasítja el, addigra viszont két termék áll. Ezt
terméken belüli egyetlen író zárja le, nem ez a kulcs.

**Ami ebből a körből tanulság lett, és megváltoztatja, hogyan dolgozunk:**
a `create` bemenetének alakját sokáig semmi nem tartotta (a szolgáltatás
tesztje a hívás-sorrendet mérte, a kliensé a keresést), és a hiány élesben
derült ki, egy 400-as elutasításban. Azóta két védvonal tartja: a típusban
az üres tuple, és egy állítás a teljes payloadra.

## ADR-008 – A címkére kerülő eszközszám bélyege helyi idő szerint áll, jelöléssel

**Dátum:** 2026-08-27

**A hiba, amit javít:** a dokumentum-kódok bélyege a `toISOString()` értékéből
készül, ami UTC. Nyáron ez két órával a magyar fali óra mögött jár, és este
22:00 után **a dátum is elcsúszik**: egy helyi idő szerint augusztus 28-án
00:30-kor kiadott eszközszámban `20260827` áll. Mérve: a bélyeget **senki nem
fejti vissza dátummá** – a címke a szám utolsó két blokkját mutatja, a keresés
`contains` illesztés, a rendezés a létrehozás mezője szerint megy –, tehát az
átállás semmilyen számítást nem tör el. Egy **ember** viszont leolvassa a
szalagról, és neki rossz óra, néha rossz nap.

**Döntés:** az eszközszám bélyege Europe/Budapest szerint áll, és az időpont
blokkja egy záró kisbetűs `h`-t kap: `ESZK-20260827-035000h-3906`.

**Miért kell jelölés:** a már kiadott számok visszamenőleg nem változnak, tehát
a sorozatban van egy pont, ahol a bélyeg jelentése megváltozik. Jelölés nélkül
ugyanaz a mező két dolgot jelentene, kívülről megkülönböztethetetlenül – ami
**rosszabb, mint az egységesen rossz érték**, mert azt legalább át lehet
számolni.

**Miért az időpont blokk végén:** a címkére a szám utolsó két blokkja kerül, így
egy dátum-blokkba tett jelölő pontosan annak lenne láthatatlan, akinek szól. És
miért kisbetű: a szám vége csupa nagybetűs hexa, tehát a kisbetű az egyetlen
karakter a kódban, ami nem illik a mintába – magyarázat nélkül elüt.

**A hatókör egyetlen hely, és teszt tartja ott:** minden más család bélyege UTC
marad. A beszerzési bizonylatszám és a POS rendelésszám **külső rendszerbe is
kimegy** (NAV, UNAS, szamlazz.hu), és azok alakjának megváltoztatása nem ennek a
körnek a dolga. A hatókör egyetlen sorral tágítható úgy, hogy semmilyen más
teszt nem bukna el – ezért őrzi `stamp-scope.spec.ts`.

**Sorrend:** ez a változás a QR-geometria **mögött** áll, egyirányú függéssel. A
jelölt szám egy karakterrel hosszabb, és a régi címke feliratsávjába a spec 10
százalékos tartalékával nem fér bele (23,62 mm kellene, 22,50 van); a
19,05 mm-es QR mellett a sáv 24,19 mm, és kifér. Fordítva nem áll: a
QR-változtatásnak saját indoka van (a modul legyen egész számú nyomtatási pont
minden 60-nal osztható felbontáson).

## ADR-009 – A munkalapszám globális éves sorozat, partner tag nélkül

**Dátum:** 2026-08-27

**Döntés:** a munkalapszámból a partner tagja kimarad, mert a lap címe már
azonosítja a partnert (tulajdonosi döntés, 2026-08-25). Az alak
`BIO-2026-001`, és **az egyediséget a sorozat adja**: egy számláló évenként, az
egész cégre.

**Amit ez a döntés helyett kizár:** a partner tag elhagyása önmagában ütköző
számokat állítana elő. A számláló ma `(partnerCode, departmentCode, year)`
hármasonként fut, tehát két különböző partner azonos kódú egysége ugyanabban az
évben mindkettő `BIO-2026-001` számot kapná, és a `Worksheet.number` egyediségi
megkötése miatt a második lap **lezárása hasalna el, a felhasználó előtt**. Az
egység kódja ma csak partneren belül egyedi, és a `BIO` tipikus név.

**A két elvetett alak:** a teljes helyszín-út a számban (`BIO-FNM-2026-001`)
nem old meg semmit, mert két partner útja is lehet azonos – csak ritkábbá és
kiszámíthatatlanabbá teszi az ütközést. A globálisan egyedi egység-kód
visszavonná a helyszín-fa egyik tulajdonságát (két különböző ág alatt ugyanaz a
kód megengedett), anélkül hogy megcáfolná.

**A számláló ÚJ tábla, nem a régi átalakítása.** Kézenfekvő lenne a két
kódmezőt nullázhatóvá tenni és a globális sort azzal jelölni, hogy mindkettő
`NULL` – és ez ugyanaz a csapda, mint a helyszín-fánál: a Postgresben a NULL nem
egyenlő önmagával, tehát a `@@unique` a globális soron nem érne semmit, és két
párhuzamos lezárás két számláló-sort hozna létre ugyanarra az évre.

**A váltás pontja magától látszik**, ezért itt nem kell jelölés: a partner tag
eltűnése maga a jel. A régi és az új szám **nem tud ütközni** (más karakterlánc),
tehát az új sorozat 1-ről indulhat, és a régi lapok számát nem kell átírni.

**Az ára, amit vállalunk:** egy egység saját lapjai nem lesznek egymás utániak
(`001`, `007`, `013`). A könyvelési hiánytalanság sértetlen, mert az egy
sorozatra vonatkozik, és az hézagmentes – de ember szemmel ez ugrálásnak
látszik, és a szervizes látni fogja.

## ADR-010 – A szervizpartner helyszínei fát alkotnak, és a gyökér védelme külön indexen áll

**Dátum:** 2026-08-27

**Döntés (tulajdonosi, 2026-08-25):** a szervizpartner helyszínei **több
szinten** állhatnak – Fank, azon belül Biodóm, azon belül Nagy főkamedence –,
nem két rögzített szinten. A kód három karakter, a teljes alak `FANK-BIO-FNM`.

**AMI NEM MELLÉKTERMÉK, HANEM A FA LÉNYEGE:** két **különböző ág** alatt
ugyanaz a kód megengedett. A Fank alatti `BIO` és a Korallszirt alatti `BIO`
egyszerre létezhet; **egy szülőn belül** viszont két testvér nem viselheti
ugyanazt a kódot. Ez a szabály az, amiért a megkötés `(customerId, parentId,
code)`, és nem `(customerId, code)`.

**ÉS EZÉRT KELLETT EGY MÁSODIK, RÉSZLEGES INDEX.** A hármas megkötés a
**legfelső szinten nem ér semmit**: a PostgreSQL-ben a `NULL` nem egyenlő
önmagával, tehát két gyökér-sor azonos kóddal átmenne rajta – és a bevezetés
pillanatában **minden sor gyökér-szintű volt**. A korábbi garancia tehát
csendben elveszett volna. Ezt a `WorksheetDepartment_customer_root_code_key`
részleges egyedi index tartja meg (`WHERE "parentId" IS NULL`), amit a Prisma
séma nem tud kifejezni, ezért a migrációban áll nyers SQL-ként.

**A kettő EGYÜTT adja azt, amit korábban egy megkötés adott.** Aki a két indexet
eggyé akarja egyszerűsíteni, ezt a bekezdést keresse meg előbb: az
egyszerűsítés a gyökér-szintet védtelenül hagyja, és a hiány nem hibaüzenetben
jelentkezik, hanem két azonos nevű helyszínben.

**Mérve, nem levezetve** (2026-08-27, külön, üres adatbázison, minden
migrációval): két gyökér azonos kóddal elutasítva, két testvér azonos kóddal
elutasítva, ugyanaz a kód más ág alatt átmegy. Ugyanez a három eset azóta az
integrációs specben áll, tehát a CI tartja.

**Egy következmény, amit érdemes tudni:** a szülőre `Restrict` áll, tehát egy
`deleteMany` a fa fölött a sorrendtől függően elhasalhat. A takarítás ezért
levélről gyökér felé halad.

## ADR-011 – A telefon offline OLVAS, de nem ír, és a mentett másolat sosem néma

**Dátum:** 2026-08-27

**Döntés:** a mobil alkalmazás helyszíni eszközkatalógusa térerő nélkül is
működik OLVASÁSRA (lista, adatlap, QR-feloldás), az ÍRÁS viszont továbbra sem
sorolódik helyben. A `sync_queue` tábla marad, de nem hív senki.

**Miért nem szimmetrikus a kettő.** Az olvasás offline másolata legrosszabb
esetben elavult adatot mutat, és ezt ki lehet írni a képernyőre. Az offline
írásnál a hiba nem látszik: két kolléga ugyanazt a lapot módosítja, és az
ütközés csak a szinkronnál derül ki, amikor már mindketten továbbmentek. A
`docs/MOBILE-DEVELOPMENT.md` protokoll-szabályai (idempotencia, ütközés-kezelés,
soha nem aláírunk offline) pont ezért állnak ott: az írás külön munka, saját
bizonyítási kötelezettséggel.

**Mit tárolunk a készüléken.** Két külön táblát, és a különbségük a felületen is
látszik:

- `cached_assets`: minden aktív, szerviz partnerhez tartozó eszköz listasora. A
  lista MINDEN oldalát lehúzzuk, nem csak az első ötvenet, mert a szerelő azt a
  matricát olvassa be, amelyik előtte van.
- `cached_asset_details`: a teljes adatlap, de csak arról, amit valaki már
  megnyitott térerővel. Eszközönként egy hívás egy nagyobb partnernél percekig
  tartana, és a lista megnyitását tenné használhatatlanná.

Ezért a mentett adatlap KÉTFÉLE lehet, és a sáv kimondja, melyik: a listából
összerakott lap hiányos (leírás, beszerelés dátuma, garancia, részegységek), és
mivel a hiányzó mezők a repó szabálya szerint nem üres sorként, hanem sehogy nem
jelennek meg, a hiányukról semmi más nem szólna.

**A mentett másolat sosem néma.** Egy offline lista pontosan úgy néz ki, mint egy
online. Ha nem mondjuk ki, a szerelő a tegnapi adat alapján dönt, és nem tudja,
hogy döntött. A sáv a kor mellett azt is jelzi, ha a másolat régi, MÉG térerő
mellett -- akkor van értelme frissíteni, nem a helyszínen.

**A készülék offline jelzése nem dönt.** A `netinfo` tévedhet, ezért a lekérdezés
mindig elindul, és a mentett másolat csak akkor kerül elő, ha a hívás tényleg
elhasalt. Egy rosszul jelentő jelzés így legfeljebb egy fölösleges sávot ír ki,
nem tart vissza egy működő lekérdezést.

**Kijelentkezéskor a másolat törlődik.** Partner-eszközök adatai ülnek a
készüléken, a telefon pedig gazdát cserélhet. A törlés helyi művelet, tehát
akkor is lefut, ha maga a kijelentkezés hívása nem ért el a szerverhez.

**Ami nyitva marad:** a felső korlát (ma húsz oldal, ezer eszköz) becslés, nem
mérés. Ha egy telepítés ezt túllépi, a felület kiírja, hány eszköz maradt ki --
és akkor lesz adatunk arról, mekkora korlát kell.

## ADR-012 – A menü egy közös forrásból származik, és a telefon a szerverről kapja

**Dátum:** 2026-09-02

**Döntés:** a menü szerkezete EGY forrásból származik, amit a webes felület és a
szerver is olvas, a telefon pedig a szervertől kap meg a `GET /auth/me`
válaszában. A jogosultság marad a kapu; a menü-adat csak elrejteni tud,
engedélyezni nem.

**A mérés, amiből következik (2026-09-02):** a menü ma két helyen áll, két külön
névkészlettel. A weben 27 tétel egy kódba írt tömbben, tételenként egy
jogosultsági kulccsal. A telefonon 7 csempe, három különböző módon kapuzva: öt
tükrözött képesség-táblából (`assetsView` ott, `service.view` a szerveren), egy
szerep-listából, és a "látszik-e" külön áll a "megnyitható-e" mezőtől. Ebből jött
a korlát, amit ez az ADR old fel: a telefon menüjének megváltoztatása
kódváltozás, tehát új bolti kiadás, míg a weben ugyanaz egy sor.

### Miért a `GET /auth/me` bővítése, és nem külön végpont

Mindkét kliens **már hívja**, pontosan akkor, amikor a keretet felépíti (a mobil
induláskor, a web a munkamenet betöltésekor). Egy válaszban nincs részleges
állapot. Egy testvérvégpont két új állapotot hozna létre, amelyek ma nem
léteznek: mit rajzol a keret, amíg az a hívás tölt, és mit, ha hibázik.

**Amit ez költ:** a `/auth/me` válasza nő. Ha a menü később nagyra nő, vagy saját
gyorsítótár-élettartamot kap, a szétválasztás visszafelé kompatibilis lépés (új
végpont, a mező egy ideig mindkettőben) – ezért nem zár be semmit.

### AZ ÍGÉRET HATÁRA, SZÓ SZERINT

**Elrejteni új kiadás nélkül lehet. Megmutatni csak azt lehet, amit a TELEPÍTETT
alkalmazás már ismer: a képernyő a buildben van.** Egy új menüpont a telefonon
továbbra is kiadást igényel.

Ez a mondat azért áll itt szó szerint, mert enélkül a döntés "a menü a szerverről
jön, tehát nincs több kiadás" alakban fog továbbutazni – és az fele igaz.

Ebből következik a kliens szabálya: az **ismeretlen azonosítójú tételt hagyja ki**,
ne próbálja kirajzolni. Egy újabb szerver így nem tör el egy régebbi alkalmazást;
a verzió-csúszás normál állapot, nem kivétel.

### Az új oldal alapértelmezése: LÁTSZIK

Egy oldal, amit a kód már ismer, de a menü-adat még nem, **alapértelmezetten
látszik annak, akinek a joga megvan.**

**Az indok, és ezért áll itt, mert a fordítottja látszik biztonságosabbnak:** a
túl tág láthatóság HANGOS – valaki szól, hogy lát valamit, amit nem kellene, és
egy sorral javítható. A túl szűk NÉMA: egy kész funkció láthatatlan marad, és
senki nem keresi, mert nem tud róla. A ritkább, de rejtve maradó hiba a drágább.

Ebből következik a határ: **a jogosultság a kapu, az adat csak elrejteni tud.**
Egy adatsor sosem adhat láthatóságot annak, akinek a joga hiányzik – különben a
beállítás-felület jogosultság-osztóvá válna, és a kapu két helyre kerülne.

### A NAV-csempe: szerep-listás ág marad, lejárati feltétellel

**Mérve:** a csempe mai szerep-listája (OWNER, ADMIN, MANAGER, WAREHOUSE,
VIEWER) **pontosan** azoké, akiknek `purchasing.view` joguk van – tehát egyetlen
joggal kifejezhető, holott a kód kommentje három jogot nevez meg
(`settings.manage` + `customers.manage` + `purchasing.view`; azok `all` alakban
csak OWNER-t és ADMIN-t, `any` alakban SALES-t is adnának).

**Döntés:** a forrás ismer egy szerep-listás ágat, és azon **egyetlen** tétel áll.

**A két elvetett út, és miért – hogy fél év múlva ne kelljen újra megmérni:**

- **`purchasing.view`-ra cserélni.** Ma betűre ugyanaz a viselkedés. A tévedése
  később jön elő, és **néma**: ha valaki egyszer ad `purchasing.view` jogot a
  SALES szerepnek, a csempe megjelenik nála, és senki nem fogja egy refaktorhoz
  kötni. A két szabály ma egybeesik, de nem ugyanaz.
- **`all` a három jogra**, ahogy a komment szándéka sugallja. Ez **azonnal**
  elvenné a láthatóságot a MANAGER, a WAREHOUSE és a VIEWER szereptől, és ez is
  néma: aki eddig látta, annak eltűnik, hibaüzenet nélkül.
- A szerep-listás ág tévedése ezzel szemben **hangos**: ha rossz a lista, valaki
  azonnal szól, és egy sorral javítható.

**És a lejárat, mert egy kivétel feltétel nélkül örökre megmarad:** a
szerep-listás ág `retiredBy` mezője **kötelező**, és megnevezi, mi szünteti meg –
az a kimondott döntés, hogy a csempe joga `purchasing.view` legyen. Ma nincs
értelme megkérdezni: a csempe nem nyitható meg (`enabled={false}`), és egy nem
nyitható csempe láthatóságáról dönteni ugyanaz a hiba lenne, mint egy üres
oldalhoz jogosultsági szabályt tervezni. Amikor a funkció épül, a szabály **bele**
kerül, nem rá.

**Jog-halmaz (bármelyik/mindegyik) szándékosan nincs.** Mérve: ma egyetlen tétel
sem kéri – mind a 26 webes oldal és a 7 csempéből 6 pontosan egy jogon áll.
Előrelátást nem építünk oda, ahol a mérés azt mondja, hogy senki nem kéri, és ez
azért olcsó, mert a bővítés visszafelé kompatibilis: egy jogból bármikor lehet
egyelemű halmaz úgy, hogy a régi alak értelmezése megmarad.

### Amit ez a lépés menet közben lezárt

A webes keret és a felhasználó-szerkesztő "mely oldalakat éri el ez a szerep"
előnézete **két külön listát fűzött össze**, és el is csúsztak (mérve
2026-09-02): az előnézet kihagyta a Tartalom oldalt, és duplán sorolta a két
szerviz-menüpontot – 26 oldal helyett 27 tételt mutatott. Ez nem a telefonról
szólt, hanem ugyanarról a hibafajtáról egy felületen belül. Az összefűzés
mostantól egy helyen áll (`allNavigationPages`), tehát ez az elcsúszás nem
"javítva lett", hanem nem tud előállni.

### AZ ÁLLAPOT: MI ÁLL EBBŐL MA, ÉS MI A TERV

Ez az ADR a **döntést** rögzíti, nem a kész állapotot. A bevezetés négy lépés,
mindegyik külön PR, és a sorrend kötött: **előbb álljon az új állítás, csak
utána essen ki a régi** – nem lehet olyan kör, amelyben semmi nem méri.

1. **KÉSZ.** A forrás létrejött (`packages/types/src/navigation.ts`), a webes
   felület onnan dolgozik, és két háló őrzi, hogy a viselkedés nem változott: a
   webes menü minden szerepre azt adja, amit a korábbi, kódba írt kulcsok adtak,
   a forrás mobil nézete pedig azt, amit a telefon mai táblái.
2. **KÉSZ.** A szerver kiadja a `GET /auth/me` válaszában, a kérőre már szűrve.
   Menet közben derült ki, hogy a telefon **friss bejelentkezéskor** nem hívja az
   `/auth/me`-t, hanem a bejelentkezési válaszból veszi a felhasználót – így a
   menü csak egy alkalmazás-újraindítás után érkezett volna meg. Mindkét belépési
   pont ugyanazt adja, és állítás követeli meg, hogy egyezzenek.
3. **KÉSZ.** A telefon a kiadott válaszra áll át. A mobil táblái megmaradnak,
   tehát két független forrás áll egyszerre, és mindkettő mérve van.
4. **ÁTÍRÁS ALATT, MERT A TERV EZEN A PONTON TÉVEDETT.** Eredetileg ez állt itt:
   "csak ezután esik ki a mobil tábla és a hozzá tartozó két ellenőrzés". A 3. lépés után elvégzett mérés szerint **ez nem lehetséges**, két független okból:

   - A képesség-táblákat a kezdőképernyőn **kívül** 11 képernyő használja. Ebből
     4 a `*Manage` kulcsokat, amik nem menü-kérdések: a közös forrás azt írja le,
     mit **lát** valaki, nem azt, mit **csinálhat**. Ha "manage" is bekerülne a
     kiadott válaszba, a jogosultság-táblát duplikálnánk egy menü-forrásban.
   - A `*View` kulcsok többsége **alképernyőt** véd (`assets/[id]`, `orders/[id]`,
     `assets/new`, `assets/scanner` és társaik): a 11-ből csak 4-nek van saját
     menüpontja. A menü arról szól, mi jelenjen meg a kezdőlapon; ezek sosem
     jelennek meg ott.

   **Amíg a táblák élnek, a két ellenőrzésnek van tárgya**, és a kivételükkel épp
   azok a helyek maradnának őrizetlenül, ahol a tábla tovább él. A 4. lépés ezzel
   egyetlen, még **el nem döntött** kérdésre szűkül: megmaradjon-e a kezdőképernyő
   visszaesése (a `tileVisible` fallback argumentuma). Megtartva egy hibás vagy
   régi szerver mellett a telefon **csendben** a saját régi tábláira esik vissza;
   kivéve ugyanott a kezdőlap **üres** lesz, ami hangos és egy sorral visszatehető.

   **Amit valóban nyugdíjazna a táblát, és ami nem ez a terv:** ha a telefon a
   **jogait** is a szerverről kapná, és mind a 11 képernyő abból dolgozna. Az új
   fogalom a válaszban, és külön döntés – itt azért áll, hogy a "majd a 4. lépés
   megoldja" ne élhessen tovább.

**Az ígéret ("elrejteni új kiadás nélkül lehet") a 2. és 3. lépéssel vált igazzá.**
Mindkettő bent van; az itteni státuszok a `main` ágon mért állapotot írják le.

### Amit ez az ADR NEM dönt el

A beállítás-felület és a felhasználónkénti felülbírálat. Mindkettő külön terv, és
ez az ADR az előfeltételük, nem a helyettesítőjük.
