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
   */
  readonly kind?: "link";
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
 * az esemenytol -- es ez pont az az erv, amiert a valtozo-lista majd
 * esemenyenkent fog szurni.
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
   * TARTOZIK, es ez a lista MA MEG NEM ESEMENYENKENT SZUR -- lasd a
   * `MAIL_TEMPLATE_VARIABLES` fejlecet. Vagyis ezek a mai WORKSHEET_SIGNED es
   * SERVICE_JOB_OPENED_BY_CUSTOMER szerkesztoiben IS megjelennek, es ott
   * mindig uresen renderelodnek (a hivo nem tolti ki oket). Ismert allapot,
   * nem hiba -- a szetvalasztas kulon dontesre var.
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
    description: "A vízmérés eredményét kiküldő kolléga neve.",
  },
] as const;

/** Egy levelezesi esemeny: a sablon kulcsa es az emberi neve. */
export interface MailTemplateEvent {
  /** A `TicketMailTemplate` sor azonositoja. */
  readonly id: string;
  /** Ez all a valasztoban es a lap tetejen. */
  readonly name: string;
  /** Mikor megy ki -- a szerkeszto melle. */
  readonly description: string;
}

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
    name: "Munkalapot aláírtak",
    description:
      "A hibajegyhez tartozó munkalap aláírása után megy ki a jegy nyitójának.",
  },
  {
    id: "SERVICE_JOB_OPENED_BY_CUSTOMER",
    name: "Ügyfél hibajegyet rögzít",
    description:
      "Akkor megy ki, amikor egy ügyfél hibajegyet nyit a partnerportálon. Címzettje mindenki, akinél a hibajegy-felelős szerep be van jelölve.",
  },
  {
    id: "WORKSHEET_SEND_FOR_SIGNATURE",
    name: "Munkalap aláírásra kiküldve",
    description:
      "Akkor megy ki, amikor egy kolléga a munkalapot aláírásra kiküldi. Címzettje a kiválasztott aláíró, a partner munkatársa.",
  },
  {
    id: "MATERIAL_REQUEST_CREATED",
    name: "Anyagigény érkezett",
    description:
      'Akkor megy ki, amikor egy szervizes anyagigényt küld a munkalapról. Címzettje mindenki, akinél a "szerviz anyagbeszerzés: értesítést fogad" jelölő be van jelölve.',
  },
  {
    id: "MATERIAL_REQUEST_RECEIVED",
    name: "Anyag beérkezett",
    description:
      "Akkor megy ki, amikor a beszerző megjelöli, hogy az anyag megérkezett. Címzettje az igényt kérő kolléga és a munkalap minden felelőse.",
  },
  /**
   * Balazs kerese, 2026-09-24 17:03 UTC (Akvariumok szal, message_id
   * 1552727165714563153): a vizmeres-level "keszuljon hozza sablon, mint a
   * tobbi levelhez". Kuldo oldalon: `aquarium-measurement-mail.service.ts`.
   */
  {
    id: "AQUARIUM_MEASUREMENT_RESULT",
    name: "Vízmérés eredménye",
    description:
      "Akkor megy ki, amikor egy kolléga elküldi egy akvárium vagy tó vízmérésének eredményét az ügyfélnek, gombnyomásra.",
  },
] as const;

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
 */
export function unknownTemplateVariables(template: string): readonly string[] {
  const ismertek = new Set(MAIL_TEMPLATE_VARIABLES.map((v) => v.name));
  const talalt = [...template.matchAll(HELY)].map((m) => m[1] as string);
  return [...new Set(talalt.filter((n) => !ismertek.has(n)))];
}
