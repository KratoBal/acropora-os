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
