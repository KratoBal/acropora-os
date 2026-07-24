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
