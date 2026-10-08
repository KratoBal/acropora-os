/**
 * A LEVEL-SABLON BEHELYETTESITESE -- KULSO SZOVEG, TEHAT OVATOSAN.
 *
 * Balazs kerese, 2026-09-21 11:39:56 UTC (Discord, fo csatorna, message_id
 * 1551558600474886145), szo szerint: "igy jo es ha lehet akkor legyenek
 * valtozok amiket be tudok illeszteni a level torzsebe".
 *
 * === A VALTOZOK LISTAJA EXPORTALT ADAT, NEM A DOKUMENTACIOBAN ALL ===
 *
 * acrobot elso kikotese, es szerinte a negy kozul a legfontosabb: a szotar
 * latszodjon a szerkeszto mellett. Egy behelyettesito nyelv, aminek a szotara
 * nincs kiirva, hasznalhatatlan -- senki nem fogja kitalalni, hogy
 * `{{jegyszam}}` vagy `{{jegy_szama}}` a helyes alak.
 *
 * EZERT A LISTA KOD, NEM KOMMENT: a felulet ugyanezt a tombot kapja meg a
 * vegponton at, tehat a szotar es a motor NEM TUD ELCSUSZNI egymastol. Ha
 * kezzel irt lista allna a feluleten, az elso uj valtozonal ketté valna.
 *
 * === MIERT A KOZOS CSOMAGBAN ALL, ES NEM AZ API-BAN (2026-09-21 delutan) ===
 *
 * 2026-09-21 delelottig az `apps/api/src/notifications/mail/` alatt lakott, es
 * az HELYES volt, amig egyetlen fogyasztoja a kuldes volt.
 *
 * A szerkeszto felulet ELONEZETET mutat: a szerkesztett szoveget behelyettesiti
 * minta-ertekekkel, hogy a szerkeszto lassa, mit kap a vevo. Egy MASODIK
 * behelyettesito azt jelentene, hogy az elonezet HAZUDHAT -- es epp az elonezet
 * az egyetlen dolog, amiben bizni fognak, mielott level megy egy vevonek.
 *
 * EZERT NEM MASOLAT KESZULT, HANEM KOLTOZES. A modul TISZTA: nincs benne Node,
 * nincs halozat, nincs adatbazis -- ugyanaz a fajta logika, mint a
 * `partnerStatusLabel`, ami ma delelott ugyanebbol az okbol kerult ide (a
 * partnerportal nem erte el a szerveren).
 *
 * ES AMI EZZEL NEM KERUL SEHOVA: a sablon SZOVEGE es a titkok. Ez a fajl a
 * behelyettesites SZABALYAT hordozza es a valtozok NEVET -- a tarolt sablon az
 * adatbazisban all, a kuldes pedig tovabbra is kizarolag a szerveren tortenik.
 */

export interface MailTemplateVariable {
  /** A sablonban igy kell leirni, `{{` es `}}` kozott. */
  readonly name: string;
  /** Mit tesz a helyere, emberi szoval -- ez megy ki a szerkeszto melle. */
  readonly description: string;
  /**
   * `"link"`: az ertek egy webcim, tehat a formazott szerkesztoben link
   * CELJAKENT is beilleszheto (`<a href="{{jegy_linkje}}">`). Hianyzo ertek:
   * sima szoveg. A mezo a listan all, nem a feluleten, hogy a tisztito es a
   * szerkeszto ugyanabbol tudja, melyik nev lehet `href`.
   *
   * `"block"`: a system-built piece of the mail (an item list, a pickup point),
   * inserted after sanitizing and only as the sole content of a paragraph. Its
   * inside is not editable, only its position (`mail-blocks.ts`).
   */
  readonly kind?: "link" | "block";
}

/**
 * AMI A KULDES PILLANATABAN RENDELKEZESRE ALL -- ES NEM TOBB.
 *
 * acrobot kikotese: "merd le, mi all rendelkezesre a kuldes pillanataban, es
 * NE igerj tobbet". Az elso het mezo a hibajegy sorabol es a nyito User
 * sorabol jon, mind a ketto a kezunkben van a kuldeskor.
 *
 * === "A MUNKALAP ADATAI" MEGIS BEKERULT, ES EZ NEM ELLENTMOND A FENTINEK ===
 *
 * Az eredeti indok az volt, hogy "a jegy alatt tobb lap is allhat, tehat egy
 * `{{munkalap}}` valtozo nem lenne egyertelmu" -- ez a KIKULDES-esemenyre nem
 * all: a `WORKSHEET_SEND_FOR_SIGNATURE` level EGY KONKRET munkalaprol szol,
 * ami a kuldes pillanataban egyertelmuen adott (a felhasznalo AZT a lapot
 * kuldi ki, amelyiken all). Az egyertelmuseg tehat nem a mezotol fugg, hanem
 * az esemenytol -- es ez pont az az erv, amiert a valtozo-lista
 * esemenyenkent szur (`MailTemplateEvent.variables`, 2026-09-29).
 */
export const MAIL_TEMPLATE_VARIABLES: readonly MailTemplateVariable[] = [
  /**
   * A LEIRASA 2026-09-22-IG „A hibajegy nyitójának neve" VOLT, ES AZ MOSTANTOL
   * FELREVEZET.
   *
   * A mezo mindig a CIMZETT nevet tette a helyere (`cimzett: decision.name`).
   * Amig EGYETLEN esemeny letezett -- a munkalap alairasa --, a cimzett ES a
   * bejelento UGYANAZ a szemely volt, tehat a ket leiras egybeesett.
   *
   * A masodik esemenynel szetvalnak: ott a cimzett a FELELOS, a bejelento az
   * ugyfel. A regi mondat ott hamisat allitana, es ez a mondat a sablon-
   * szerkeszto mellett jelenik meg -- vagyis pont azt vezetne felre, aki a
   * sablont irja.
   */
  { name: "cimzett", description: "A levél címzettjének neve." },
  { name: "jegyszam", description: "A hibajegy száma, például HJ-2026-001." },
  { name: "jegy_targya", description: "A hibajegy címe." },
  {
    name: "jegy_leirasa",
    description: "A bejelentés szövege. Üres, ha nincs kitöltve.",
  },
  /**
   * Balazs kerese, 2026-09-22: „szeretnem ha meg belekerulne egy olyan
   * valtozo, ami a bejelento nevet tartalmazza".
   *
   * KULON MEZO, ES NEM A `cimzett` UJRAHASZNALASA: a ketto csak az EGYIK
   * esemenyen esik egybe (lasd fent).
   */
  { name: "bejelento", description: "A hibajegyet nyitó személy neve." },
  /**
   * KULON VALTOZO A `bejelento` MELLETT, es nem ugyanaz maskeppen: az egyik
   * SZEMELY, a masik CEG. acrobot kikotese, 2026-09-22: ha a push megnevezi az
   * ugyfelet, a level is logikusan teszi -- de a ketto MAS adat, es a nevuk
   * mondja meg a kulonbseget.
   *
   * URES MARAD, ha az ugyfelnek nincs rovidítése, vagy a jegynek nincs
   * ugyfele. Ez NEM hiba: a sablonban a korulotte allo mondat dontse el, mit
   * kezd vele.
   */
  {
    name: "ugyfelkod",
    description:
      "Az ügyfél rövidítése, például FANK. Üres, ha az ügyfélnek nincs.",
  },
  /**
   * Balazs kerese, 2026-09-22 19:49:22 UTC: "Lehet a valtozok koze berakni
   * egy olyat amit ha belerakok a levelbe akkor link latszik a levelben ami
   * a hibajegyre visz?"
   *
   * A BELSO FELULETRE MUTAT -- ez a valtozo a hibajegy-felelosoknek szolo ket
   * ertesitesben (`WORKSHEET_SIGNED`, `SERVICE_JOB_OPENED_BY_CUSTOMER`) all
   * rendelkezesre, mert mindketto BELSO cimzettnek megy. Egy PARTNERNEK szolo
   * levelben (az atadasi level) ez a link nem ertelmes: a partner-portal nem
   * ugyanaz az utvonal, es ott ma nincs sablon-behelyettesites sem.
   *
   * URES MARAD, ha a `WEB_URL` kornyezeti valtozo nincs beallitva -- lasd
   * `ticket-link.ts`. Ez NEM tartja fel a kuldest.
   */
  {
    name: "jegy_linkje",
    kind: "link",
    description:
      "A hibajegy belső oldalának linkje. Üres, ha a rendszer nem ismeri a saját webcímét.",
  },
  /**
   * A KOVETKEZO NEGY VALTOZO A `WORKSHEET_SEND_FOR_SIGNATURE` ESEMENYHEZ
   * TARTOZIK.
   *
   * ITT 2026-09-29-IG AZ ALLT, HOGY A TOBBI ESEMENY SZERKESZTOJEBEN "MINDIG
   * URESEN RENDERELODNEK". EZ HAMIS VOLT: a `renderMailTemplate` ismeretlen
   * nevnel NEM renderel, a level kimarad. Elesen igy maradt ki harom alairasi
   * felkero level 2026-09-29-en: a sablonba `{{kuldo_neve}}` kerult, a
   * mentes elfogadta (a nev letezett, csak MAS esemenynel), a kuldesi ut nem
   * adta. Azota minden esemeny maga mondja meg, milyen valtozot ad
   * (`MailTemplateEvent.variables`), es a mentes ahhoz mer.
   *
   * A `munkalap_szama` LEIRASA REBASE UTAN BOVULT: az anyagigeny esemenyek
   * (lent) ugyanezt a nevet hasznaljak, es a ket felhasznalas egymast fedi --
   * mindketto "melyik munkalaprol van szo" kerdesre valaszol, csak az egyik
   * (aláírásra kikuldes) a kapcsolt hibajegy szamat is figyelembe veszi
   * elsobbsegkent, a masik (anyagigeny) nem. A leiras mindket viselkedest
   * lefedi, egy nev alatt -- ket kulon nev ugyanazt a fogalmat duplazna.
   */
  {
    name: "munkalap_szama",
    description:
      "A munkalap sorszáma, például BIO-2026-001, vagy a hozzá tartozó hibajegy száma, ha az aláírásra kiküldés esetén van kapcsolt hibajegy. Üres, ha egyik sincs (piszkozat állapotú lap).",
  },
  {
    name: "partner_neve",
    description: "A munkalap partnerének (ügyfelének) teljes neve.",
  },
  {
    name: "alairo_neve",
    description: "A kiküldés címzettjeként választott aláíró neve.",
  },
  {
    name: "munkalap_linkje",
    kind: "link",
    description:
      "A munkalap linkje a PARTNER-PORTÁLON (nem a belső felületen). Üres, ha a rendszer nem ismeri a partner-portál webcímét.",
  },
  /**
   * A KOVETKEZO HAROM VALTOZO AZ ANYAGIGENY ESEMENYEKHEZ TARTOZIK. Balazs
   * kerese, 2026-09-22 12:15:46 UTC.
   *
   * KULON MEZO A `bejelento` MELLETT, es nem ugyanaz maskeppen: az egyik a
   * hibajegyet nyito ugyfel, a masik a munkalapon dolgozo, anyagot kero
   * kollega. A ketto MAS ESEMENYEN all, es soha nem egyszerre.
   */
  { name: "kero", description: "Az anyagigényt küldő kolléga neve." },
  {
    name: "tetelek",
    description:
      "Az anyagigény tételei, soronként: név, mennyiség, egység. Több sor.",
  },
  /**
   * `munkalap_belso_linkje`, NEM `munkalap_linkje` -- REBASE UTANI DONTES.
   * A `munkalap_linkje` (fent) MAR a PARTNER-PORTALRA mutat, az anyagigeny
   * cimzettjei (belsos szervizesek, beszerzok) viszont a BELSO feluletre
   * kell jussanak: oda nincs is belepesuk. Lasd a `ticket-mail.service.ts`
   * fejlecet a `MATERIAL_REQUEST_CREATED` esemeny mellett.
   */
  {
    name: "munkalap_belso_linkje",
    kind: "link",
    description:
      "A munkalap belső oldalának linkje. Üres, ha a rendszer nem ismeri a saját webcímét.",
  },
  /**
   * AZ `AQUARIUM_MEASUREMENT_RESULT` ESEMENYHEZ TARTOZIK. Balazs kerese,
   * 2026-09-24 17:03 UTC (Akvariumok szal, message_id 1552727165714563153).
   *
   * A `cimzett` UJRAHASZNALT: ez a level is a vevonek megy, es a cimzett neve
   * ugyanaz a fogalom, mint a tobbi esemenynel (lasd a mezo leirasat fent).
   */
  {
    name: "akvarium_neve",
    description: "Az akvárium vagy tó neve, amelyre a mérés vonatkozik.",
  },
  /**
   * Balazs kerese, 2026-09-25 10:31 UTC (Akvariumok szal): a level tartalmazza
   * annak a kollegának a nevet is, aki kikuldte. `AuthenticatedUser.displayName`
   * a forras -- KOTELEZO mezo a tipuson es a semaban is (`User.displayName`,
   * `NOT NULL`), tehat nincs "nincs teljes neve" eset, amire tartalek kellene.
   */
  {
    name: "kuldo_neve",
    description: "A levelet kiküldő kolléga neve.",
  },
  // A SZÁMLÁZÁSI BIZONYLAT LEVELÉNEK VÁLTOZÓI (2026-09-30). A nevük angol, mert
  // a brief és a kiküldő fiók így vezette be őket; a kiküldés a régi, egy
  // kapcsos zárójeles alakot is elfogadja.
  {
    name: "customer_name",
    description: "A vevő neve, ahogy a kiállított bizonylaton áll.",
  },
  {
    name: "document_number",
    description: "A bizonylat száma, amit a Számlázz.hu adott.",
  },
  {
    name: "invoice_number",
    description:
      "A számla száma. Csak számlánál és előlegszámlánál van értéke; díjbekérőnél a levél nem megy ki, ha a szöveg használja.",
  },
  {
    name: "gross_total",
    description:
      "A fizetendő bruttó végösszeg a pénznemmel, például 12 985 Ft.",
  },
  {
    name: "due_date",
    description: "A fizetési határidő, például 2026. 10. 08.",
  },
  {
    // nem `link` fajtájú: az a HTML-hivatkozásoké, a számla-levél sima szöveg
    name: "document_link",
    description:
      "A bizonylat a Számlázz.hu vevői fiókjában. Üres, ha a Számlázz.hu nem adott ilyet.",
  },
  {
    name: "order_number",
    description:
      "A bizonylat hivatkozása (például a vevő rendelésszáma). Ha a szöveg használja és nincs kitöltve, a levél nem megy ki.",
  },
  /*
    THE WEBSHOP MAILS' VALUES AND BLOCKS (2026-10-05). The webshop posts the
    facts, the OS derives these from them (`webshop-mail.ts`); every name here
    is filled by that derivation for the events that list it.
  */
  {
    name: "rendeles_szam",
    description: "A rendelés száma, # nélkül, például 38.",
  },
  {
    name: "ugyfel_neve",
    description:
      "A vevő neve a számlázási címből, vezetéknévvel elöl. Üres, ha a webshop nem adta.",
  },
  {
    name: "rendeles_datum",
    description:
      "A rendelés napja, például 2026. október 5. Üres, ha a webshop nem adta.",
  },
  {
    name: "rendeles_szamok",
    description:
      "A rendelés száma #-tel; vegyes kosárnál a két rendelésé, például #38 és #39.",
  },
  {
    name: "vegyes_kosar_mondat",
    description:
      "Vegyes kosárnál a mondat arról, hogy az élő állat miatt két rendelés lett. Egyébként üres.",
  },
  {
    name: "osszesen",
    description: "A fizetendő végösszeg, például 39 400 Ft.",
  },
  {
    name: "kovetkezo_lepes",
    description:
      "Mi történik most: összekészítjük, vagy a boltban veszed át. A rendelés szállításától függ.",
  },
  { name: "szallitasi_mod", description: "A szállítási mód neve." },
  {
    name: "szallito",
    description:
      "A szállító: FOXPOST – Packeta Group, GLS csomagpont vagy GLS házhozszállítás.",
  },
  { name: "tracking_szam", description: "A csomag követési száma." },
  {
    name: "tracking_link",
    description:
      "A csomag követése a szállító oldalán. Üres, ha nincs ilyen cím.",
    kind: "link",
  },
  {
    name: "zarolt_osszeg",
    description: "A kártyán zárolt és most feloldott összeg.",
  },
  {
    name: "bolti_rendeles_mondat",
    description:
      "Vegyes kosárnál a mondat a bolti átvételes rendelésről. Egyébként üres.",
  },
  {
    name: "masodik_resz_szam",
    description:
      "Szétbontott rendelésnél a később érkező rész száma #-tel, például #39.",
  },
  {
    name: "reszek_fizetese_mondat",
    description:
      "Szétbontott rendelésnél a mondat arról, hogyan fizeti a két részt: kártyával, utánvéttel vagy a boltban.",
  },
  {
    name: "fizetesi_link",
    description: "A fizetési oldal címe.",
    kind: "link",
  },
  {
    name: "fizetendo",
    description:
      "A fizetési link összege; vegyes kosárnál a két rendelésé együtt.",
  },
  {
    name: "link_lejarat",
    description:
      "Az utolsó nap, amikor a link még fizet, például 2026. október 11.",
  },
  {
    name: "visszaterites_osszege",
    description: "Ennek a visszatérítésnek az összege.",
  },
  {
    name: "kartya_megnevezes",
    description:
      "A kártya: „a 4242 végű kártyádra”, vagy ha a szám nem ismert, „a kártyádra, amellyel fizettél”.",
  },
  {
    name: "eddigi_visszaterites_mondat",
    description:
      "Ha erről a rendelésről korábban is volt visszatérítés, a mondat az eddigi összegről. Egyébként üres.",
  },
  {
    name: "rendeles_tetelek",
    description:
      "Blokk: a rendelés tételei, a szállítás, a végösszeg és a fizetési mód. A rendszer állítja össze, külön bekezdésben áll.",
    kind: "block",
  },
  {
    name: "fizetendo_doboz",
    description:
      "Blokk: a kiemelt fizetendő összeg (utánvétnél, bolti fizetésnél, fizetési linknél). Ha nincs mit fizetni, nem jelenik meg.",
    kind: "block",
  },
  {
    name: "szallitas_doboz",
    description:
      "Blokk: a szállító, a cím vagy a pont, a követési szám és a követés gombja.",
    kind: "block",
  },
  {
    name: "csomag_tartalma",
    description: "Blokk: a csomagban lévő tételek, ár nélkül.",
    kind: "block",
  },
  // #1582 P3: the quote mail's own variables
  {
    name: "ajanlat_szama",
    description: "Az árajánlat száma, például AJ-2026-0001.",
  },
  { name: "ajanlat_megnevezese", description: "Az árajánlat megnevezése." },
  {
    name: "ajanlat_verzioja",
    description: "A kiküldött verzió száma, például 2.",
  },
  {
    name: "ajanlat_ervenyes",
    description: "Az ajánlat érvényességének utolsó napja, például 2026.11.06.",
  },
  {
    name: "ajanlat_ugyfele",
    description:
      "Az ajánlat ügyfelének neve. Üres, ha az ajánlathoz nincs ügyfél rendelve.",
  },
] as const;

export const MAIL_TEMPLATE_GROUPS = ["SERVICE", "WEBSHOP"] as const;
export type MailTemplateGroup = (typeof MAIL_TEMPLATE_GROUPS)[number];

/** Egy levelezesi esemeny: a sablon kulcsa es az emberi neve. */
export interface MailTemplateEvent {
  /** A `TicketMailTemplate` sor azonositoja. */
  readonly id: string;
  /** Ez all a valasztoban es a lap tetejen. */
  readonly name: string;
  /** Mikor megy ki -- a szerkeszto melle. */
  readonly description: string;
  /**
   * The tab it is listed under. `SERVICE`: the OS's own mails (service,
   * worksheets, materials, measurements, invoices). `WEBSHOP`: the mails the
   * webshop sends, rendered by the OS.
   */
  readonly group: MailTemplateGroup;
  /**
   * A valtozok, amiket EZ AZ ESEMENY kuldesi utja kitolt -- es csak ezek.
   * A mentes ehhez mer, a szerkeszto ezeket ajanlja fel. Egy itt felsorolt, de
   * az uton ki nem toltott nev a level kimaradasat jelenti: ezt az esemenyenkenti
   * kuldesi teszt fogja meg (`ticket-mail.service.spec.ts`,
   * `aquarium-measurement-mail.service.spec.ts`).
   */
  readonly variables: readonly string[];
}

const BILLING_DOCUMENT_VARIABLES = [
  "customer_name",
  "document_number",
  "invoice_number",
  "gross_total",
  "due_date",
  "document_link",
  "order_number",
] as const;

/**
 * A LEVELEZESI ESEMENYEK, EGY HELYEN.
 *
 * Balazs kerese, 2026-09-22: „Sablon mar van valamire, de legyen tobb sablon.
 * Ennek pl az legyen a neve, hogy Ugyfel hibajegyet rogzit."
 *
 * === MIERT ITT, ES MIERT NEM AZ ADATBAZISBAN ===
 *
 * A `TicketMailTemplate` SOR a szerkesztheto SZOVEGET tarolja. Hogy MILYEN
 * esemenyek leteznek, az nem adat, hanem a kod tulajdonsaga: minden esemenyhez
 * tartozik egy kuldesi ut, amit valaki megirt. Egy adatbazisban felvett uj
 * nev nem kuldene semmit -- csak egy ures szerkesztot adna.
 *
 * ES AZERT A KOZOS CSOMAGBAN: a lista kell a szervernek (melyik azonositot
 * fogadja el a vegpont) ES a feluletnek (mit ajanljon fel a valaszto). Ket
 * masolat pontosan ott csuszna szet, ahol senki nem nezi.
 */
export const MAIL_TEMPLATE_EVENTS: readonly MailTemplateEvent[] = [
  {
    id: "WORKSHEET_SIGNED",
    group: "SERVICE",
    name: "Munkalapot aláírtak",
    description:
      "A hibajegyhez tartozó munkalap aláírása után megy ki a jegy nyitójának.",
    variables: [
      "cimzett",
      "jegyszam",
      "jegy_targya",
      "jegy_leirasa",
      "jegy_linkje",
    ],
  },
  {
    id: "SERVICE_JOB_OPENED_BY_CUSTOMER",
    group: "SERVICE",
    name: "Ügyfél hibajegyet rögzít",
    description:
      "Akkor megy ki, amikor egy ügyfél hibajegyet nyit a partnerportálon. Címzettje mindenki, akinél a hibajegy-felelős szerep be van jelölve.",
    variables: [
      "cimzett",
      "jegyszam",
      "jegy_targya",
      "jegy_leirasa",
      "bejelento",
      "ugyfelkod",
      "jegy_linkje",
    ],
  },
  {
    id: "WORKSHEET_SEND_FOR_SIGNATURE",
    group: "SERVICE",
    name: "Munkalap aláírásra kiküldve",
    description:
      "Akkor megy ki, amikor egy kolléga a munkalapot aláírásra kiküldi. Címzettje a kiválasztott aláíró, a partner munkatársa.",
    variables: [
      "alairo_neve",
      "kuldo_neve",
      "munkalap_szama",
      "partner_neve",
      "munkalap_linkje",
    ],
  },
  {
    id: "MATERIAL_REQUEST_CREATED",
    group: "SERVICE",
    name: "Anyagigény érkezett",
    description:
      'Akkor megy ki, amikor egy szervizes anyagigényt küld a munkalapról. Címzettje mindenki, akinél a "szerviz anyagbeszerzés: értesítést fogad" jelölő be van jelölve.',
    variables: [
      "cimzett",
      "munkalap_szama",
      "kero",
      "tetelek",
      "munkalap_belso_linkje",
    ],
  },
  {
    id: "MATERIAL_REQUEST_RECEIVED",
    group: "SERVICE",
    name: "Anyag beérkezett",
    description:
      "Akkor megy ki, amikor a beszerző megjelöli, hogy az anyag megérkezett. Címzettje az igényt kérő kolléga és a munkalap minden felelőse.",
    variables: [
      "cimzett",
      "kuldo_neve",
      "munkalap_szama",
      "tetelek",
      "munkalap_belso_linkje",
    ],
  },
  {
    id: "MATERIAL_REQUEST_CLAIMED",
    group: "SERVICE",
    name: "Anyagigény beszerzése átvéve",
    description:
      "Akkor megy ki, amikor egy kolléga átveszi az anyagigény beszerzését („Én intézem a beszerzést”). Címzettje az igényt kérő kolléga.",
    variables: [
      "cimzett",
      "kuldo_neve",
      "munkalap_szama",
      "tetelek",
      "munkalap_belso_linkje",
    ],
  },
  {
    id: "MATERIAL_REQUEST_ORDERED",
    group: "SERVICE",
    name: "Anyag megrendelve",
    description:
      "Akkor megy ki, amikor a beszerzés felelőse rögzíti, hogy megrendelte az anyagot. Címzettje az igényt kérő kolléga.",
    variables: [
      "cimzett",
      "kuldo_neve",
      "munkalap_szama",
      "tetelek",
      "munkalap_belso_linkje",
    ],
  },
  {
    id: "MATERIAL_REQUEST_CANCELLED",
    group: "SERVICE",
    name: "Anyagigény visszavonva",
    description:
      "Akkor megy ki, amikor egy már átvett anyagigényt visszavonnak. Címzettje a beszerzés felelőse. Ha még senki nem vette át, nem megy ki.",
    variables: [
      "cimzett",
      "kuldo_neve",
      "munkalap_szama",
      "tetelek",
      "munkalap_belso_linkje",
    ],
  },
  /**
   * Balazs kerese, 2026-09-24 17:03 UTC (Akvariumok szal, message_id
   * 1552727165714563153): a vizmeres-level "keszuljon hozza sablon, mint a
   * tobbi levelhez". Kuldo oldalon: `aquarium-measurement-mail.service.ts`.
   */
  {
    id: "AQUARIUM_MEASUREMENT_RESULT",
    group: "SERVICE",
    name: "Vízmérés eredménye",
    description:
      "Akkor megy ki, amikor egy kolléga elküldi egy akvárium vagy tó vízmérésének eredményét az ügyfélnek, gombnyomásra.",
    variables: ["cimzett", "akvarium_neve", "kuldo_neve"],
  },
  {
    id: "BILLING_DOCUMENT_MANUAL",
    group: "SERVICE",
    name: "Számla kiküldése (kézi számlázás)",
    description:
      "A kiállított számla, díjbekérő vagy előlegszámla kiküldésének alapszövege. A kiküldő fiók ezzel nyílik meg, és küldés előtt átírható. A PDF csatolmányként megy. Formázható: a levél HTML-ként és szöveges alternatívaként megy ki.",
    variables: BILLING_DOCUMENT_VARIABLES,
  },
  /**
   * #1582 P3: the quote's send drawer opens with this text; it can be edited
   * before sending. Sender: `quote-mail.service.ts`.
   */
  {
    id: "QUOTE_SEND",
    group: "SERVICE",
    name: "Árajánlat kiküldése",
    description:
      "A publikált árajánlat kiküldésének alapszövege. A kiküldő fiók ezzel nyílik meg, és küldés előtt átírható. A PDF csatolmányként megy, sima szöveges levélben.",
    variables: [
      "ajanlat_ugyfele",
      "ajanlat_szama",
      "ajanlat_megnevezese",
      "ajanlat_verzioja",
      "ajanlat_ervenyes",
      "kuldo_neve",
    ],
  },
  {
    id: "BILLING_DOCUMENT_WEBSHOP_ORDER",
    group: "SERVICE",
    name: "Számla kiküldése (webshopos rendelés)",
    description:
      "A webshop-rendeléshez automatikusan kiállított számla levele. Ma csak a sablon szerkeszthető: az automatikus számlázás és kiküldés még nem épült meg.",
    variables: BILLING_DOCUMENT_VARIABLES,
  },
  /*
    THE WEBSHOP'S CUSTOMER MAILS (Balazs, 2026-10-05 20:11 UTC: the OS
    renders, the webshop sends). The webshop decides WHEN; these hold only
    WHAT. Keys: `WEBSHOP_MAIL_KEYS` in `webshop-mail.ts`.
  */
  {
    id: "WEBSHOP_ORDER_PLACED",
    group: "WEBSHOP",
    name: "Rendelés leadva",
    description: "A rendelés leadása után.",
    variables: [
      "rendeles_szam",
      "ugyfel_neve",
      "rendeles_datum",
      "rendeles_szamok",
      "vegyes_kosar_mondat",
      "osszesen",
      "kovetkezo_lepes",
      "rendeles_tetelek",
    ],
  },
  {
    id: "WEBSHOP_ORDER_CONFIRMED",
    group: "WEBSHOP",
    name: "Rendelés visszaigazolva",
    description: "Amikor a rendelés Visszaigazolva státuszba kerül.",
    variables: [
      "rendeles_szam",
      "ugyfel_neve",
      "rendeles_datum",
      "szallitasi_mod",
      "osszesen",
      "fizetendo_doboz",
      "rendeles_tetelek",
    ],
  },
  {
    id: "WEBSHOP_ORDER_OUT_FOR_DELIVERY",
    group: "WEBSHOP",
    name: "Kiszállítás alatt",
    description:
      "Amikor a rendelés kiszállítás alatt van. Nem megy ki, ha a „Feladtuk a csomagodat” levél már elment.",
    variables: [
      "rendeles_szam",
      "ugyfel_neve",
      "rendeles_datum",
      "szallitasi_mod",
      "osszesen",
      "fizetendo_doboz",
      "rendeles_tetelek",
    ],
  },
  {
    id: "WEBSHOP_ORDER_READY_FOR_PICKUP",
    group: "WEBSHOP",
    name: "Üzletben átvehető",
    description: "Amikor a rendelés az üzletben átvehető.",
    variables: [
      "rendeles_szam",
      "ugyfel_neve",
      "rendeles_datum",
      "szallitasi_mod",
      "osszesen",
      "fizetendo_doboz",
      "rendeles_tetelek",
    ],
  },
  {
    id: "WEBSHOP_ORDER_SHIPPED",
    group: "WEBSHOP",
    name: "Csomag átadva a szállítónak",
    description: "Amikor a csomagot átadtuk a szállítónak, a követési számmal.",
    variables: [
      "rendeles_szam",
      "ugyfel_neve",
      "rendeles_datum",
      "szallito",
      "tracking_szam",
      "tracking_link",
      "szallitas_doboz",
      "fizetendo_doboz",
      "csomag_tartalma",
    ],
  },
  {
    id: "WEBSHOP_ORDER_SPLIT",
    group: "WEBSHOP",
    name: "Rendelés két részben",
    description:
      "Amikor a rendelést két részre bontjuk, mert egyes tételei később érkeznek.",
    variables: [
      "rendeles_szam",
      "ugyfel_neve",
      "rendeles_datum",
      "rendeles_szamok",
      "masodik_resz_szam",
      "reszek_fizetese_mondat",
      "rendeles_tetelek",
    ],
  },
  {
    id: "WEBSHOP_SHIPPING_DELAYED",
    group: "WEBSHOP",
    name: "Szállítási csúszás",
    description:
      "Amikor a kártyás zárolást feloldjuk, mert a rendelés nem teljesíthető időben.",
    variables: [
      "rendeles_szam",
      "ugyfel_neve",
      "rendeles_datum",
      "rendeles_szamok",
      "zarolt_osszeg",
      "bolti_rendeles_mondat",
      "rendeles_tetelek",
    ],
  },
  {
    id: "WEBSHOP_PAYMENT_LINK",
    group: "WEBSHOP",
    name: "Fizetési link",
    description: "Amikor a rendeléshez fizetési linket küldünk.",
    variables: [
      "rendeles_szam",
      "ugyfel_neve",
      "rendeles_datum",
      "rendeles_szamok",
      "fizetesi_link",
      "fizetendo",
      "link_lejarat",
      "bolti_rendeles_mondat",
      "fizetendo_doboz",
      "rendeles_tetelek",
    ],
  },
  {
    id: "WEBSHOP_PAYMENT_REMINDER",
    group: "WEBSHOP",
    name: "Fizetési emlékeztető",
    description:
      "A fizetési link kiküldése után a 3. napon, ha még nem érkezett fizetés.",
    variables: [
      "rendeles_szam",
      "ugyfel_neve",
      "rendeles_datum",
      "rendeles_szamok",
      "fizetesi_link",
      "fizetendo",
      "link_lejarat",
      "bolti_rendeles_mondat",
      "fizetendo_doboz",
      "rendeles_tetelek",
    ],
  },
  {
    id: "WEBSHOP_REFUND",
    group: "WEBSHOP",
    name: "Visszatérítés",
    description: "Amikor a kártyás fizetésből visszatérítés indult.",
    variables: [
      "rendeles_szam",
      "ugyfel_neve",
      "rendeles_datum",
      "visszaterites_osszege",
      "kartya_megnevezes",
      "eddigi_visszaterites_mondat",
    ],
  },
  {
    id: "WEBSHOP_ORDER_CLOSED",
    group: "WEBSHOP",
    name: "Rendelés lezárva",
    description: "Amikor a rendelés Megrendelés lezárva státuszba kerül.",
    variables: [
      "rendeles_szam",
      "ugyfel_neve",
      "rendeles_datum",
      "szallitasi_mod",
      "osszesen",
      "fizetendo_doboz",
      "rendeles_tetelek",
    ],
  },
] as const;

/**
 * Az esemeny valtozoi, a leirasukkal, a kozos lista sorrendjeben. Ismeretlen
 * esemenyre ures: annak nincs kuldesi utja, tehat semmit nem ad.
 */
export function mailTemplateEventVariables(
  eventId: string,
): readonly MailTemplateVariable[] {
  const nevek = new Set(
    MAIL_TEMPLATE_EVENTS.find((esemeny) => esemeny.id === eventId)?.variables,
  );
  return MAIL_TEMPLATE_VARIABLES.filter((valtozo) => nevek.has(valtozo.name));
}

/** Ismert esemeny-e. A vegpont ES a felulet ezt kerdezi, nem sajat listat. */
export function isMailTemplateEvent(id: string): boolean {
  return MAIL_TEMPLATE_EVENTS.some((esemeny) => esemeny.id === id);
}

export type MailTemplateValues = Readonly<Record<string, string>>;

export type MailTemplateRender =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly unknown: readonly string[] };

const HELY = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * ISMERETLEN VALTOZONAL NEM RENDERELUNK -- SE URESET, SE NYERS `{{...}}`-T.
 *
 * acrobot masodik kikotese, es az indoka a sajat lapomon is all: egy elgepelt
 * mezonevtol a mondat ERTELMES MARAD, csak mast mond. Ez a behelyettesites
 * legalattomosabb alakja: nem csonkit, hanem MODOSIT, es a hossz sem arulja el.
 *
 *   ures stringgel      "Kedves !" -- a vevo latja, mi meg nem tudjuk meg soha
 *   nyers `{{izé}}`-vel a vevo latja a belso mezonevunket
 *   NEM RENDERELUNK     a kuldes megnevezett okkal kimarad, es a naplo megmondja
 *
 * A harmadik a helyes: a nem kikuldott level POTOLHATO, a kikuldott nem.
 * MINDEN ismeretlen nevet osszegyujtunk, nem csak az elsot -- kulonben a
 * szerkeszto egyesevel, ujrakuldesenkent tudna meg, hany elgepelese van.
 */
export function renderMailTemplate(
  template: string,
  values: MailTemplateValues,
): MailTemplateRender {
  return behelyettesit(template, values, (ertek) => ertek);
}

/**
 * A KOZOS MAG: EGY MINTA, EGY ISMERETLEN-NEV SZABALY. A ket nyilvanos fuggveny
 * csak abban ter el, mit tesz az ertekkel, mielott beirja -- ha ket kulon
 * `replace` allna itt, a szoveges es a HTML level mast tartana ismeretlennek.
 */
function behelyettesit(
  template: string,
  values: MailTemplateValues,
  alakit: (ertek: string, helyzet: { tagon: boolean }) => string,
): MailTemplateRender {
  const ismeretlen: string[] = [];
  const text = template.replace(
    HELY,
    (_egesz, nev: string, hely: number, egesz: string) => {
      if (!Object.prototype.hasOwnProperty.call(values, nev)) {
        ismeretlen.push(nev);
        return "";
      }
      return alakit(values[nev] ?? "", { tagon: tagonBelul(egesz, hely) });
    },
  );
  return ismeretlen.length
    ? { ok: false, unknown: [...new Set(ismeretlen)] }
    : { ok: true, text };
}

/**
 * A HELY EGY TAG BELSEJEBEN ALL-E (`<a href="{{...}}">`), VAGY SZOVEGBEN.
 *
 * Tisztitott HTML-en megbizhato: ott a szovegben allo `<` es `>` mar
 * `&lt;`/`&gt;`, tehat a legutolso nyers `<` es `>` sorrendje eldonti.
 */
function tagonBelul(html: string, hely: number): boolean {
  return html.lastIndexOf("<", hely) > html.lastIndexOf(">", hely);
}

function escapeHtml(ertek: string): string {
  return ertek
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A FORMAZOTT (HTML) SABLON BEHELYETTESITESE.
 *
 * Balazs kerese, 2026-09-26 14:10: HTML szerkeszto a levelsablonokhoz.
 *
 * AZ ERTEK SZOVEG, NEM HTML. Egy hibajegy cime (`Szuro <b> & tsa`) vagy egy
 * `"` a bejelentesben kulonben HTML-kent futna, illetve egy `href` attributumot
 * torne el. Ezert minden ertek escape-elve kerul be.
 *
 * A TOBBSOROS ERTEK (`tetelek`, `jegy_leirasa`) SZOVEGBEN `<br>`-t kap, kulonben
 * a HTML egy sorba vonna. TAGON BELUL (a link cime) a sortores szokoz lesz: egy
 * `<br>` egy attributumban nem sortores, hanem sertett jeloles.
 *
 * A KIMENET NEM TISZTITOTT. A hivo (a kuldes) utana a `sanitizeRichHtml`-t
 * futtatja, ES AZ DOBJA KI a nem `http(s)`/`mailto` linket, ami egy ertekbol
 * jott. Ez a fuggveny tiszta, fuggoseg nelkuli csomagban all, a tisztito nem.
 */
export function renderMailTemplateHtml(
  template: string,
  values: MailTemplateValues,
): MailTemplateRender {
  return behelyettesit(template, values, (ertek, { tagon }) => {
    const biztos = escapeHtml(ertek);
    return tagon
      ? biztos.replace(/\r?\n/g, " ")
      : biztos.replace(/\r?\n/g, "<br>");
  });
}

/**
 * A FORMAZAS ALTAL KETTEVAGOTT VALTOZOK.
 *
 * Ha egy helyorzo belsejere formazas kerul (`{{jegy<strong>szam</strong>}}`),
 * a `HELY` minta a HTML-en NEM illeszkedik: a level a nevet NYERSEN kuldene ki,
 * es az `unknownTemplateVariables` sem szolna, mert nem lat valtozot. Ez a
 * behelyettesites legrosszabb alakja -- nema modositas --, csak uj uton.
 *
 * A szerkeszto a valtozot atomkent kezeli, tehat onnan ilyen nem jon. De a
 * vegpont kozvetlenul is hivhato, es a kliens nem kontroll: ezt a SZERVER
 * kerdezi menteskor.
 *
 * A MERES: a tagok nelkuli szovegben talalt helyorzok kozul melyik NINCS meg
 * ugyanannyiszor a HTML szoveg-reszeiben (tagon kivul). A tagon belulieket
 * (`href`) szandekosan nem szamoljuk: azok a szovegbol eltunnek, nem
 * keletkeznek.
 */
export function splitTemplateVariables(html: string): readonly string[] {
  const szamol = (nevek: string[]) => {
    const db = new Map<string, number>();
    for (const n of nevek) db.set(n, (db.get(n) ?? 0) + 1);
    return db;
  };
  const epek = szamol(
    [...html.matchAll(HELY)]
      .filter((m) => !tagonBelul(html, m.index))
      .map((m) => m[1] as string),
  );
  const szoveg = html.replace(/<[^>]*>/g, "");
  const latszo = szamol([...szoveg.matchAll(HELY)].map((m) => m[1] as string));
  return [...latszo]
    .filter(([nev, db]) => db > (epek.get(nev) ?? 0))
    .map(([nev]) => nev);
}

/**
 * A SABLON ALLITASA A SZERKESZTESKOR -- HOGY A HIBA OTT DERULJON KI.
 *
 * Ugyanaz a motor, de a kimenete a SZERKESZTONEK szol, nem a vevonek. Enelkul
 * egy elgepelt mezonev csak a kovetkezo valodi kuldeskor bukna ki, amikor mar
 * senki nem emlekszik ra, hogy a sablont atirtak.
 *
 * AZ `allowed` KOTELEZO, ES EZ A LENYEG: az ESEMENY valtozoi, nem a kozos
 * lista. 2026-09-29-ig a kozos listahoz mert, igy egy MASIK esemeny valtozoja
 * (`kuldo_neve` az alairasi levelben) atment a mentesen, es a level kimaradt.
 */
export function unknownTemplateVariables(
  template: string,
  allowed: readonly string[],
): readonly string[] {
  const ismertek = new Set(allowed);
  const talalt = [...template.matchAll(HELY)].map((m) => m[1] as string);
  return [...new Set(talalt.filter((n) => !ismertek.has(n)))];
}
