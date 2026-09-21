/**
 * A HIBAJEGY, AHOGY A FELÜLET LÁTJA.
 *
 * A nyolc belső állapot tükre. NEM a Prisma enumot importáljuk: ez a csomag a
 * kliensé is, és nem függhet az adatbázis-klienstől. A tükör viszont
 * ELCSÚSZHAT, ezért a szerveroldalon áll egy fordítási idejű őrző
 * (`service-job-status.ts`), ami `Record<ServiceJobStatus, ...>` alakban
 * kényszeríti ki, hogy a két lista ugyanaz maradjon. Ha valaki új állapotot
 * vesz fel a sémába, ott hasal el, nem itt - és nem a felhasználó előtt.
 */
export type ServiceJobStatusValue =
  | "NEW"
  | "TRIAGED"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "WAITING_FOR_PARTS"
  | "WAITING_FOR_CUSTOMER"
  | "COMPLETED"
  | "CANCELLED";

/** A négy állapot, amit a partner lát. A nyolc ennek a részletezése. */
export type ServiceJobPartnerStatus =
  "NEW" | "IN_PROGRESS" | "COMPLETED" | "CLOSED";

export interface ServiceJobListItem {
  id: string;
  jobNumber: string;
  title: string;
  status: ServiceJobStatusValue;
  partnerStatus: ServiceJobPartnerStatus;
  partnerStatusLabel: string;
  customerName: string | null;
  /**
   * A HELYSZIN TELJES UTJA, a partner neve ala.
   *
   * A JEGY-LISTA EDDIG SEMMIT nem mondott a helyszinrol, csak a partnert. Ket
   * jegy ugyanannal a partnernel tehat megkulonboztethetetlen volt azon a
   * kepernyon, ahol a szerelo valaszt kozuluk. Balazs 2026-09-16-an a
   * munkalap-listara kerte a teljes utat, es ugyanabban a mondatban ide is.
   *
   * `null`, ha a jegynek nincs helyszine VAGY az utat nem tudjuk felepiteni.
   * A ketto a listan ugyanugy nez ki, es ez rendben van: ott nincs mit tenni
   * egyikkel sem. Az adatlap `departmentPath` mezoje ugyanezt a szabalyt
   * koveti. URES TOMB SOHA.
   */
  departmentPath: string[] | null;
  worksheetCount: number;
  createdAt: string;
  /**
   * EL VAN-E REJTVE. Ugyanaz a mező és ugyanaz a szabály, mint a
   * munkalap-listán: alapból minden sor `false`, mert rejtett sor nem is jön.
   *
   * A PARTNER VÁLASZÁBAN IS OTT ÁLL, és mindig `false`: a partner-úton a
   * rejtett sor soha nem értelmezett. Nem külön alakot adunk a két oldalnak,
   * mert egy elágazó válasz-típus a KÖVETKEZŐ mezőnél is elágazna.
   */
  hidden: boolean;
}

/**
 * HANY JEGY ALL EGY-EGY ALLAPOTBAN.
 *
 * A SZAMOK A TELJES LATHATO HALMAZBOL JONNEK, NEM A VISSZAADOTT LAPBOL, es ez
 * a lenyegük. Az `items` legfeljebb ketszaz sort hoz; egy lapbol szamolt
 * osszesito ugyanugy nezne ki, es CSENDBEN mast jelentene, amint a
 * ketszazadik jegy megszuletik. A `groupBy` UGYANAZT a lathatosagi szurot
 * hasznalja, mint a lista, tehat egy partner sajat magat szamolja, nem a hazat.
 *
 * Minden allapot szerepel benne, a nullas is: egy hianyzo kulcs a kliensen
 * `undefined`, es az osszeadasban csendben eltunik.
 */
export type ServiceJobStatusCounts = Record<ServiceJobStatusValue, number>;

export interface ServiceJobListResponse {
  items: ServiceJobListItem[];
  counts: ServiceJobStatusCounts;
  /**
   * IGAZ, HA A LISTA A HATARBA UTKOZOTT, tehat van tobb sor, ami nem fert bele.
   * A SZERVER mondja meg, nem a kliens szamolja: a hatar a lekerdezese, es egy
   * kliensoldali "pont ketszaz jott" osszehasonlitas nemán avulna el, amint a
   * hatar valaha valtozik.
   */
  truncated: boolean;
}

/**
 * EGY LÉPÉS A JEGYEN, AHOGY A NAPLÓ MUTATJA.
 *
 * A `fromStatus` `null` a keletkezésnél: annak nincs előzménye. Az `actorName`
 * is `null` lehet, mert egy törölt felhasználó nem viheti magával a naplót -
 * ami történt, megtörtént.
 */
export interface ServiceJobStatusEvent {
  id: string;
  fromStatus: ServiceJobStatusValue | null;
  toStatus: ServiceJobStatusValue;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

/**
 * Egy munkalap a jegy mögött. A szám `null`, amíg a lap piszkozat.
 *
 * A `subject` A LAP NEVE, ÉS A LEGFRISSEBB VERZIÓJÁRÓL JÖN -- ugyanonnan,
 * ahonnan a csatoló választó is veszi. Azért kell a linknek is, mert a jegy
 * alatt eddig CSAK a szám állt, és piszkozatnál az sincs: a felhasználó egy
 * "Piszkozat" feliratot látott, ami minden számozatlan lapnál ugyanaz. Két
 * piszkozat a jegy alatt megkülönböztethetetlen volt.
 *
 * ÜRES STRING LEHET (verzió nélküli lap), és a `""` itt NEM a név hiányát
 * állítja, hanem azt, hogy nem tudjuk -- a rajzoló ezért esik vissza a
 * korábbi alakra, ahelyett hogy üres zárójelet írna ki.
 */
export interface ServiceJobWorksheetLink {
  id: string;
  number: string | null;
  subject: string;
  createdAt: string;
  handedOverAt: string | null;
}

/** Egy eszköz, amit a jegy érint. */
export interface ServiceJobAssetLink {
  id: string;
  assetId: string;
  assetNumber: string;
  assetName: string;
  attachedAt: string;
}

/**
 * A JEGYRE DELEGÁLT SZERVIZES KOLLÉGA.
 *
 * Alakra azonos a `WorksheetAssignee`-vel, és ez nem véletlen egyezés: a
 * hibajegy és a munkalap ugyanannak a munkának a két oldala, a kiosztás pedig
 * ugyanaz a fogalom. KÜLÖN TÍPUS mégis, mert a kettő KÜLÖN VÁLASZBAN utazik:
 * egy közös típus a két végpontot egymáshoz kötné, és egy munkalap-oldali
 * mező-bővítés a jegy válaszát is elmozdítaná, anélkül hogy bárki kérte volna.
 */
export interface ServiceJobAssignee {
  userId: string;
  /** A felületre szánt név: a becenév, ha van (lásd `personDisplayName`). */
  name: string;
  assignedAt: string;
}

/** Fénykép vagy egyéb fájl a jegyen. */
export type ServiceJobDocumentType = "PHOTO" | "OTHER";

/**
 * EGY CSATOLMÁNY A JEGYEN, TARTALOM NÉLKÜL.
 *
 * KÜLÖN TÍPUS, NEM AZ `AssetDocumentSummary` ÚJRAHASZNÁLÁSA, és ugyanabból az
 * okból, amit a `ServiceJobAssignee` már kimond: a kettő KÜLÖN VÁLASZBAN
 * utazik. Egy közös típus a két végpontot egymáshoz kötné, és egy eszköz-oldali
 * mező-bővítés a jegy válaszát is elmozdítaná, anélkül hogy bárki kérte volna.
 *
 * A `contentType` UNIÓ, NEM `string`, és ez mért tanulság, nem ízlés. Az
 * `AssetDocumentSummary`-ben egykor a rögzített `"application/pdf"` literál
 * állt, és igaz is volt addig, amíg a végpont csak PDF-et fogadott -- a képek
 * befogadása után csendben hazudni kezdett. A három érték itt azért van
 * kiírva, mert a szerver oldalán pontosan ennyit ismer a tartalom-felismerés
 * (`canonicalMimetypeFor`), és egy negyedik formátum felvétele ITT is
 * átvezetést kíván.
 *
 * ÉS A SZERVER IS EZT A TÍPUST ÍRJA KI a válaszában. Ha csak a kliens
 * deklarálná, a két oldal külön mozdulhatna el: egy elgépelt mezőnév
 * `undefined` alakban jelenne meg a képernyőn, hibaüzenet nélkül.
 */
export interface ServiceJobDocumentSummary {
  id: string;
  type: ServiceJobDocumentType;
  fileName: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  sha256: string;
  /**
   * A CSATOLMANY FELIRATA -- MIT LATUNK A KEPEN. `null`, ha nincs.
   *
   * A HIANY EGYFELE ALAKBAN ALL (`null`, nem ures string): kulonben a "nincs
   * felirat" es a "szandekosan ures felirat" megkulonboztethetetlen lenne, es
   * a rajzolonak ket agat kellene nyitnia ugyanarra a hianyra.
   */
  caption: string | null;
  createdAt: string;
}

/**
 * A RÉSZLETLAP VÁLASZA: EGY ÖSSZEFÉSÜLT SOR, A SZERVER RENDEZI.
 *
 * NEM három lista, és ezt megmértük, nem elvből döntöttük el. Az összefésülés
 * sorrendje SZABÁLY (mi számít egyidejűnek, mi jön előbb azonos bélyegnél), és
 * egy szabály ne lakjon két helyen. Egy közös tiszta függvény ezt csak akkor
 * oldaná meg, ha MINDKÉT kliens el tudná érni - a mobil csomag viszont NEM
 * függ a `@acropora/types`-tól (mérve 2026-09-02, a web igen, a mobil nem),
 * tehát ott a fésülés újraíródna. A kliens rajzol, nem dönt.
 *
 * Ha valaha típusra kell szűrni, az a végpont paramétere legyen, ne
 * kliens-oldali válogatás.
 */
export interface ServiceJobDetail {
  id: string;
  /**
   * EL VAN-E REJTVE. A RÉSZLETLAP REJTETT SORNÁL IS ELÉRHETŐ -- egy rejtett
   * elem nem „nem létezik", csak nincs a listákban --, tehát ez a mező itt
   * MIND A KÉT értéket felveheti, szemben a lista-elemmel, ahol alapból
   * mindig hamis.
   *
   * A FELÜLET EBBŐL TUDJA, MELYIK IRÁNYT KÍNÁLJA fel: elrejtést vagy
   * visszaállítást. E nélkül a gombnak találgatnia kellene, és egy rossz
   * irányba mutató gomb visszaállítás helyett újra elrejtene.
   */
  hidden: boolean;
  jobNumber: string;
  title: string;
  description: string | null;
  status: ServiceJobStatusValue;
  partnerStatus: ServiceJobPartnerStatus;
  partnerStatusLabel: string;
  customerName: string | null;
  /**
   * A PARTNER AZONOSITOJA, A NEVE MELLE.
   *
   * A NEV MEGJELENITESRE JO, SZURESRE NEM. A csatolhato lapok listaja a jegy
   * partnerere szukul, es ahhoz a felhasznalonak az AZONOSITOT kell atadnia --
   * a nevbol nem lehet lekerdezni, es ket azonos nevu sor nem is
   * kulonboztethetne meg.
   *
   * `null`, ha a jegynek meg nincs partnere. Ilyenkor a felulet a listat NEM
   * keri le: partner nelkul a csatolas ugyis elutasitana, es egy ures valaszto
   * ott ugy nezne ki, mintha nem lenne mit csatolni.
   */
  customerId: string | null;
  /**
   * HOL VAN A BAJ: a partner helyszine a jegyen.
   *
   * KET MEZO, ES NEM EGY. Az azonosito szureshez es tovabbi lepesekhez kell (a
   * munkalap ugyanezt a fat hasznalja), a nev a kepernyore. Csak az azonositot
   * adni azt jelentene, hogy a kliens kulon lekerdezessel oldja fel -- csak a
   * nevet adni pedig azt, hogy nem lehet ra epiteni.
   *
   * A nev EGY SZINT SZULOVEL jon, ha van (`Nagy fokamedence / Biodom`), mert a
   * nev csak testverek kozott egyedi. A teljes ut nem fer ide: a fa melysege
   * nem korlatos.
   *
   * Mindketto `null`, ha a jegynek nincs helyszine -- es az a mai jegyek
   * mindegyike, mert a mezo 2026-09-14-en keletkezett.
   */
  departmentId: string | null;
  /**
   * A HELYSZIN TELJES UTJA, a gyokertol lefele, egy-egy elemmel szintenkent.
   *
   * MIERT NEM ELEG A NEV, ES MIERT NEM ELEG A SZULO SEM: a kod es a nev csak
   * TESTVEREK kozott egyedi, tehat ket TAVOLI ag alatt ugyanaz a "Biodóm (BIO)"
   * megengedett es termeszetes. Ez a mezo korabban a szulot es a nevet fuzte
   * ossze -- az EGY szinttel tobb, de harom szintnel meg mindig nem mondja meg,
   * melyik agrol van szo.
   *
   * Balazs merte vissza 2026-09-16-an: a munkalap adatlapjan `NMD —
   * Nagymedence` allt, es abbol nem derul ki, melyik medencerol.
   *
   * `null`, ha a jegynek nincs helyszine. URES TOMB SOHA: az azt allitana, hogy
   * az ut ismert es nulla hosszu.
   */
  departmentPath: string[] | null;
  departmentName: string | null;
  createdAt: string;
  /**
   * A TERVEZETT IDŐPONT MEZŐ MARAD, ÉS NEM SZÁRMAZTATOTT.
   *
   * Más természetű, mint a másik kettő: ez TERV, nem esemény. Valaki
   * BEÁLLÍTJA, jövőbeli időpontra, és a naplóból soha nem vezethető le, mert
   * nem történt meg semmi.
   */
  scheduledAt: string | null;
  /**
   * MA MINDKETTŐ MINDEN JEGYEN `null`, ÉS EZ SZÁNDÉKOS.
   *
   * Az időpontok FORRÁSA a napló: a `timeline` státusz-bejegyzéseiből derül ki,
   * mikor lépett a jegy `IN_PROGRESS`-be és mikor `COMPLETED`-be. A lépés
   * NEM írja ezt a két mezőt, mert az második írót csinálna egy tényre, és
   * két elcsúszott időpont NÉMA hiba: két képernyő, két válasz, és senki nem
   * keresi.
   *
   * A mezők attól szerepelnek a válaszban, hogy a séma hordozza őket, és egy
   * kihagyott mező később csendes hiánynak látszana. A séma megjegyzése mondja
   * meg, mi hozná vissza a mezős irányt (indexelt lekérdezés a számlázáshoz).
   */
  startedAt: string | null;
  completedAt: string | null;
  /** Amit a jegy tehet innen. Üres, ha a jegy lezárult. */
  allowedSteps: ServiceJobStatusValue[];
  /** A három forrás egy időrendben, legújabb felül. A szerver rendezte. */
  timeline: ServiceJobTimelineEntry[];
  /**
   * A JEGY ALTAL ERINTETT ESZKOZOK, SAJAT LISTAKENT.
   *
   * === MIERT KULON MEZO, HA A `timeline` MAR TARTALMAZZA OKET ===
   *
   * A naplo az esemenyek IDORENDJE: ott az eszkoz egy BEJEGYZES, a sorrendje a
   * fesules szabalya szerint all, es a lista barmikor szukulhet (szures,
   * lapozas) anelkul, hogy az ESZKOZOK halmaza valtozna.
   *
   * A hibajegybol nyitott munkalap ezt a halmazt orokli (2026-09-15). Ha azt a
   * naplobol olvasnank ki, a felvitel egy MEGJELENITESI dontestol fuggne -- es
   * a veszteseg NEMA lenne: a lap egyszer csak kevesebb eszkozzel indulna, es
   * senki nem keresne a naplo szurojenel.
   *
   * URES TOMB ERVENYES VALASZ, nem hiba: a jegy keletkezhet eszkoz megnevezese
   * nelkul.
   */
  assets: ServiceJobAssetLink[];
  /**
   * AKIKRE A JEGYET DELEGÁLTÁK, a kiosztás sorrendjében (a régebbi elöl).
   *
   * ÜRES LISTA IS ÉRVÉNYES VÁLASZ, és nem hiba: egy jegy megszülethet
   * delegálás nélkül, és az iroda később osztja ki. A mező attól van mindig
   * jelen, hogy egy hiányzó kulcs a felületen `undefined`-ként csendes hibát
   * adna -- egy üres tömb viszont pontosan azt mondja, amit jelent.
   */
  assignees: ServiceJobAssignee[];
}

/**
 * EGY TÖRÖLT CSATOLMÁNY NYOMA.
 *
 * A SOR AKKOR KELETKEZIK, AMIKOR A FÁJL MEGSZŰNIK, és ez a lényege: amíg a
 * csatolmány megvan, a saját létezése a nyoma - ott áll a listán, letölthető,
 * látszik a mérete. Egy törölt fájl viszont nyomtalanul eltűnik, a tárolóból is,
 * és onnantól ez az egyetlen hely, ahol megmarad, hogy VOLT, és hogy KI vette le.
 *
 * Ezért nem szimmetrikus a naplózás: a feltöltés nem kerül bele, a törlés igen.
 *
 * A `fileName` MÁSOLAT, nem hivatkozás - a dokumentum sora addigra nincs meg.
 * Az `actorName` elhagyható: egy azóta törölt felhasználó nem viszi magával a
 * naplót, ahogy az állapotváltásoknál sem.
 */
export interface ServiceJobDocumentRemoval {
  id: string;
  fileName: string;
  /**
   * A MI BESOROLASUNK, nem a fajlnev vege: egy `.pdf` lehet bizonyito fenykep
   * scannelve is. Nelkule a naplo azt mondana, hogy egy FAJL tunt el, de nem
   * azt, MILYEN.
   */
  documentType: ServiceJobDocumentType;
  /**
   * AKI TOROLTE, ES AMIKOR. Az `actorName` elhagyhato: egy azota torolt
   * felhasznalo nem viszi magaval a naplot, ahogy az allapotvaltasoknal sem.
   */
  actorName: string | null;
  removedAt: string;
  /**
   * ES AKI FELTOLTOTTE, ES AMIKOR -- A TOROLT SORBOL ATVEVE.
   *
   * A feltoltes MA IS rogzitve van, csak nem a naploban: a csatolmany sora
   * hordozza. A torles viszont AZT A SORT viszi el, tehat a feltoltes nyoma
   * vele egyutt tunne el. Ez a ket mezo azert all itt, hogy egy torles EGY
   * dolgot semmisitsen meg, ne kettot.
   *
   * Az `uploadedAt` a regebbi bejegyzeseknel `null`: a mezo 2026-09-15-en
   * keletkezett, es a korabbi sorok nem hordozzak. A `null` itt azt mondja,
   * hogy NEM TUDJUK -- nem azt, hogy nem volt feltoltve.
   */
  uploadedByName: string | null;
  uploadedAt: string | null;
}

export type ServiceJobTimelineEntry =
  | {
      kind: "status";
      at: string;
      sortKey: string;
      event: ServiceJobStatusEvent;
    }
  | {
      kind: "worksheet";
      at: string;
      sortKey: string;
      worksheet: ServiceJobWorksheetLink;
    }
  | { kind: "asset"; at: string; sortKey: string; asset: ServiceJobAssetLink }
  | {
      kind: "document";
      at: string;
      sortKey: string;
      removal: ServiceJobDocumentRemoval;
    };

/**
 * A HÁROM FORRÁS EGY IDŐRENDI NAPLÓVÁ, LEGÚJABB FELÜL (Balázs, 2026-09-02).
 *
 * A SORREND DETERMINÁLT, és ez nem szőrszálhasogatás: azonos időbélyegnél (egy
 * tranzakcióban keletkezett sorok, vagy másodperc-pontosságú import) a
 * rendezés magától nem stabil, és ugyanaz a jegy két lekérdezésen más
 * sorrendben adná vissza ugyanazokat a sorokat. A másodlagos kulcs a fajta,
 * a harmadlagos az azonosító - mindkettő állandó.
 */
export function serviceJobTimeline(detail: {
  events: ServiceJobStatusEvent[];
  worksheets: ServiceJobWorksheetLink[];
  assets: ServiceJobAssetLink[];
  /**
   * KÖTELEZŐ MEZŐ, NEM ELHAGYHATÓ - ÉS EZ SZÁNDÉKOS.
   *
   * Egy `?` itt azt jelentené, hogy aki elfelejti átadni, ÜRES naplót kap a
   * törlésekről, és a hiány pontosan úgy nézne ki, mintha soha nem törölt volna
   * senki semmit. Kötelezőként a fordító kérdezi meg a hívót, nem a felhasználó.
   */
  documentRemovals: ServiceJobDocumentRemoval[];
}): ServiceJobTimelineEntry[] {
  const entries: ServiceJobTimelineEntry[] = [
    ...detail.events.map((event): ServiceJobTimelineEntry => ({
      kind: "status",
      at: event.createdAt,
      sortKey: event.id,
      event,
    })),
    ...detail.worksheets.map((worksheet): ServiceJobTimelineEntry => ({
      kind: "worksheet",
      at: worksheet.createdAt,
      sortKey: worksheet.id,
      worksheet,
    })),
    ...detail.assets.map((asset): ServiceJobTimelineEntry => ({
      kind: "asset",
      at: asset.attachedAt,
      sortKey: asset.id,
      asset,
    })),
    ...detail.documentRemovals.map((removal): ServiceJobTimelineEntry => ({
      kind: "document",
      at: removal.removedAt,
      sortKey: removal.id,
      removal,
    })),
  ];

  return entries.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.sortKey === b.sortKey) return 0;
    return a.sortKey < b.sortKey ? -1 : 1;
  });
}

/**
 * EGY MUNKALAP NEVE A JEGY ALATT: NÉV, ÉS ZÁRÓJELBEN AMI AZONOSÍTJA.
 *
 * Balázs kérése, 2026-09-16: a jegy alatt eddig CSAK a szám állt, piszkozatnál
 * pedig a "Piszkozat" szó. Az utóbbi MINDEN számozatlan lapnál ugyanaz, tehát
 * két piszkozat a jegy alatt megkülönböztethetetlen volt, és a lista nem
 * mondta meg, miről szól a lap - csak azt, hogy van.
 *
 * A NÉV ELŐRE KERÜL, A ZÁRÓJELBE AZ, AMI EDDIG OTT ÁLLT. Lezárt lapnál ez a
 * szám, piszkozatnál a szó. Így a sor akkor is olvasható marad, ha valaki a
 * számot keresi - csak már nem az az első, amit lát.
 *
 * NÉV NÉLKÜL A RÉGI ALAK MARAD, üres zárójel nélkül: a `""` azt jelenti, hogy
 * nem tudjuk a nevet (a laphoz nincs verzió), és egy "(Piszkozat)" felirat egy
 * hiányzó név előtt többet állítana, mint amit tudunk.
 *
 * === MIÉRT ITT ÁLL, ÉS NEM A WEBES CSOMAGBAN (2026-09-21) ===
 *
 * 2026-09-21-ig az `apps/web` saját `service-job-labels.ts` fájljában lakott.
 * A partnerportál ugyanezt a listát rajzolja ki a jegy alatt, és az `apps/web`
 * forrását nem érheti el (a `@acropora/partner` egyetlen belső függősége a
 * `@acropora/types`). Két másolat két helyen ugyanarra a sorra: a portálon és
 * a belső lapon UGYANAZ a munkalap kétféleképpen nézne ki, és a különbség
 * néma volna.
 *
 * A HELYE NEM ÖNKÉNY: a `serviceJobTimeline` -- ugyanennek a naplónak a
 * rendezése -- már itt áll, ugyanabból az okból (a mobil és a web külön
 * írná meg, és a két sorrend elcsúszna).
 */
export function serviceJobWorksheetLabel(worksheet: {
  number: string | null;
  subject: string;
}): string {
  const azonosito = worksheet.number ?? "Piszkozat";
  const nev = worksheet.subject.trim();
  return nev ? `${nev} (${azonosito})` : azonosito;
}

/**
 * A NÉGY LÁTSZÓ ÁLLAPOT FELIRATA, A PARTNER NYELVÉN.
 *
 * NÉGY ÁLLAPOT KIFELÉ, NYOLC BELÜL (Balázs döntése, 2026-09-02: „Legyen a
 * 4/8"). A kettő nem két rendszer: a nyolc a négynek a RÉSZLETEZÉSE. Hogy egy
 * jegy alkatrészre vár vagy az ügyfélre, az a MI munkaszervezésünk -- a
 * partnernek mindkettő egyszerűen „feldolgozás alatt".
 *
 * A NÉGY NEVE A PARTNER NYELVE, nem a miénk: „Feldolgozás alatt" -- ezt
 * Balázs 2026-08-26-án szó szerint így mondta.
 */
export const PARTNER_STATUS_LABELS: Record<ServiceJobPartnerStatus, string> = {
  NEW: "Új",
  IN_PROGRESS: "Feldolgozás alatt",
  COMPLETED: "Elkészült",
  CLOSED: "Lezárva",
};

/**
 * A nyolc belső állapot leképezése a négy látszóra.
 *
 * A `CANCELLED` a `CLOSED` alá esik: a partner felé az elállt jegy is lezárt
 * ügy. Hogy MIÉRT zárult le, az a mi oldalunk -- és egy külön „elállt" állapot
 * kifelé olyan magyarázatot kérne, amit nem minden esetben akarunk megadni.
 *
 * === MIÉRT ITT ÁLL, ÉS NEM A SZERVEREN (2026-09-21) ===
 *
 * 2026-09-21-ig az `apps/api` `service-job-status.ts` fájljában lakott, és
 * EGY HELYEN állt -- ami helyes volt, amíg egyetlen felületnek kellett. A
 * partnerportál viszont a jegy NAPLÓJÁBAN is meg akarja nevezni, melyik
 * állapotba lépett a jegy, és a napló-bejegyzés csak a BELSŐ értéket hordozza
 * (`ServiceJobStatusEvent.toStatus`). A szerver a lista- és a részletválaszba
 * beteszi a mai feliratot, a naplósorokba nem.
 *
 * A TARTALOM TEHÁT LÉTEZETT, csak nem volt olyan helye, ahonnan a portál
 * elérhette volna -- a partner saját, letölthető dokumentumcsomagja MA IS
 * ezzel a felirattal írja ki ugyanazt az eseményt.
 *
 * AMI NEM VÁLTOZIK: a szerver továbbra is ugyanezt küldi a válaszban, és a
 * leképezés továbbra is EGY helyen áll. Az `apps/api` innen olvassa, a saját
 * Prisma-típusára szabott burkolókkal, és a séma-tükör őrzője ott is marad --
 * ez a csomag a kliensé is, tehát nem függhet az adatbázis-klienstől.
 */
const PARTNER_STATUS: Record<ServiceJobStatusValue, ServiceJobPartnerStatus> = {
  NEW: "NEW",
  TRIAGED: "IN_PROGRESS",
  SCHEDULED: "IN_PROGRESS",
  IN_PROGRESS: "IN_PROGRESS",
  WAITING_FOR_PARTS: "IN_PROGRESS",
  WAITING_FOR_CUSTOMER: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CLOSED",
};

/**
 * A NYOLC ÁLLAPOT, FUTÁSIDŐBEN -- ÉS NEM KÉZZEL ÍRT LISTAKÉNT.
 *
 * A `PARTNER_STATUS` típusa `Record<ServiceJobStatusValue, ...>`, tehát a
 * FORDÍTÓ követeli meg, hogy minden állapot szerepeljen benne. A kulcsai így
 * egy TELJES felsorolást adnak, ami egy kilencedik állapot felvételekor
 * magától bővül -- egy külön, kézzel írt tömb épp az új esetet hagyná ki, és
 * nem szólna róla semmi.
 */
export const ALL_SERVICE_JOB_STATUS_VALUES = Object.keys(
  PARTNER_STATUS,
) as ServiceJobStatusValue[];

export function partnerVisibleStatus(
  status: ServiceJobStatusValue,
): ServiceJobPartnerStatus {
  return PARTNER_STATUS[status];
}

export function partnerStatusLabel(status: ServiceJobStatusValue): string {
  return PARTNER_STATUS_LABELS[partnerVisibleStatus(status)];
}

/**
 * A PARTNERNEK KULDOTT RESZLETLAP -- SAJAT TIPUS, NEM A BELSO MEGSZURVE.
 *
 * === A DONTES, ES AMIERT NEM SZURO-LISTA ===
 *
 * Balazs, 2026-09-21 12:07:32 UTC (Discord, fo csatorna, message_id
 * 1551565542886740020): "elfogadom a javaslatodat, johet a kovetkezo".
 * A javaslat: a partner PARTNER ALAKU valaszt kapjon, ne a belso reszletlapot
 * egy kepernyovel megszurve. Az indok: a "nem latja" NEM vedelem -- a bongeszo
 * fejlesztoi ablaka elolvassa a valaszt.
 *
 * A KULONBSEG AZ ALAPERTELMEZESBEN VAN, es ez a lenyeg: ha valaki holnap uj
 * mezot tesz a belso reszletlapra, a SAJAT TIPUS mellett az NEM megy ki
 * magatol. Egy szuro-lista ("ezeket vedd ki") mellett igen. Ugyanaz az elv,
 * mint a default-deny.
 *
 * === MI HIANYZIK A BELSOHOZ KEPEST, ES MIERT ===
 *
 * Tizenegy mezo, amit a portal MA SEM olvas (merve 2026-09-21, ket modszerrel
 * es kontrollal): hidden, status, customerName, customerId, departmentId,
 * departmentName, scheduledAt, startedAt, completedAt, allowedSteps,
 * assignees.
 *
 * A `status` kulon emlitest erdemel: a partner a `partnerStatus` es a
 * `partnerStatusLabel` mezot kapja. A belso, nyolc erteku allapot SOHA nem
 * megy ki -- pontosan ezert letezik a ket partner-mezo.
 */
export interface ServiceJobPartnerDetail {
  id: string;
  jobNumber: string;
  title: string;
  description: string | null;
  partnerStatus: ServiceJobPartnerStatus;
  partnerStatusLabel: string;
  departmentPath: string[] | null;
  createdAt: string;
  timeline: ServiceJobPartnerTimelineEntry[];
  assets: ServiceJobAssetLink[];
}

/**
 * A NAPLO-SOR PARTNER ALAKJA.
 *
 * KET DOLOG HIANYZIK A BELSOHOZ KEPEST, ES KET KULON DONTES ALL MOGOTTUK:
 *
 *   a MEGJEGYZES (`note`)   Balazs, 2026-09-21 10:5x: "a megjegyzes nem kell a
 *                           nev igen". A kezelo szabad szoveget ir a
 *                           statuszvaltashoz; semmi nem mondja ki rola, hogy
 *                           ugyfelnek szol.
 *   a BELSO ALLAPOT         a `fromStatus` es a `toStatus` a nyolc erteku belso
 *                           enum. Helyettuk `isCreation` all -- a portal
 *                           EDDIG IS csak annyit hasznalt beloluk, hogy a
 *                           `fromStatus` null-e (merve: `naplo-sor.ts`).
 *
 * A NEV MARAD (`actorName`), mert Balazs kimondta. Kulon allitas orzi,
 * kulonben a takaritas azt is elvinne.
 *
 * AZ `isCreation` NEVE SZANDEKOSAN NEM UTAL AZ ENUM ERTEKEIRE. Egy
 * `fromStatusWasNew` alaku nev a szokincset a NEVEN keresztul szivarogtatna ki.
 *
 * === A PARTNERI FELIRAT (2026-09-21 delutan) ===
 *
 * A belso enum kivetele utan a portal naplosora nem tudta MEGNEVEZNI, milyen
 * allapotba lepett a jegy -- nem azert, mert nem fert hozza a lekepezeshez
 * (az ITT all, ebben a fajlban), hanem mert az ERTEK nem volt a kezeben.
 *
 * A `partnerStatusLabel` ezt a hianyt zarja be, es NEM TAGITJA vissza a
 * szukitest. Harom fuggetlen merés all mogotte:
 *
 *   1. ugyanez a felirat MA IS kimegy a JEGY szintjen
 *      (`ServiceJobPartnerDetail.partnerStatusLabel`);
 *   2. ugyanez a felirat MA IS kimegy UGYANERRE AZ ESEMENYRE a partner
 *      letoltheto dokumentumcsomagjaban (`service-job-package-log.ts`, a
 *      `belso` kapcsolo `scope.kind === "internal"`-bol jon, tehat partnernel
 *      hamis -- es a felirat akkor is ott van);
 *   3. a szokincs a NEGY erteku partner-tabla, nem a nyolcé.
 *
 * AZ ATFEDES, MERVE, MERT KULONBEN FELREVEZET: a nyolc belso es a negy partneri
 * felirat KET SZON azonos (`Uj`, `Elkeszult`), mert azokra a lekepezes
 * azonossag (NEW -> NEW, COMPLETED -> COMPLETED). Ez NEM szivargas: ugyanaz a
 * szo ugyanazt az allapotot jelenti mind a ket szokincsben. Ami kifele SOHA nem
 * mehet, az a hat tobbi belso felirat (`Felmerve`, `Utemezve`, `Folyamatban`,
 * `Alkatreszre var`, `Ugyfelre var`, `Meghiusult`) es maga az enum.
 *
 * A MEZO A FELIRAT, NEM AZ ALLAPOT. A negy erteku `partnerStatus` enumot
 * SZANDEKOSAN nem tesszuk ide: a portal ma szoveget rajzol, es egy mezo, amit
 * senki nem olvas, ugyanugy a droton van.
 */
export interface ServiceJobPartnerStatusEvent {
  id: string;
  /** Igaz, ha ez a sor a jegy KELETKEZESE, nem egy kesobbi allapotvaltas. */
  isCreation: boolean;
  /**
   * A PARTNERI felirat ahhoz az allapothoz, amibe a jegy ekkor lepett
   * (`PARTNER_STATUS_LABELS`, negy ertek). A belso, nyolc erteku felirat
   * SOHA nem kerul ide -- lasd a fejlec atfedes-bekezdeset.
   */
  partnerStatusLabel: string;
  actorName: string | null;
  createdAt: string;
}

export type ServiceJobPartnerTimelineEntry =
  | {
      kind: "status";
      at: string;
      sortKey: string;
      event: ServiceJobPartnerStatusEvent;
    }
  | {
      kind: "worksheet";
      at: string;
      sortKey: string;
      worksheet: ServiceJobWorksheetLink;
    }
  | { kind: "asset"; at: string; sortKey: string; asset: ServiceJobAssetLink }
  | {
      kind: "document";
      at: string;
      sortKey: string;
      removal: ServiceJobDocumentRemoval;
    };

/**
 * A BELSO RESZLETLAPBOL A PARTNER ALAKJA -- TISZTA FUGGVENY.
 *
 * ITT, A KOZOS CSOMAGBAN ALL, nem az API-ban: igy a partner kliens ugyanazt a
 * TIPUST latja, amit a szerver eloallit, es a ketto nem tud elcsuszni.
 *
 * MINDEN MEZO KIIRVA, nem `...detail` szorassal. Ez nem stilus: a szoras
 * pontosan azt az alapertelmezest venne el, amiert ez a tipus letezik -- egy
 * holnap felvett belso mezo magatol atmenne rajta.
 */
export function partnerServiceJobDetail(
  detail: ServiceJobDetail,
): ServiceJobPartnerDetail {
  return {
    id: detail.id,
    jobNumber: detail.jobNumber,
    title: detail.title,
    description: detail.description,
    partnerStatus: detail.partnerStatus,
    partnerStatusLabel: detail.partnerStatusLabel,
    departmentPath: detail.departmentPath,
    createdAt: detail.createdAt,
    assets: detail.assets,
    timeline: detail.timeline.map((entry) =>
      entry.kind === "status"
        ? {
            kind: "status" as const,
            at: entry.at,
            sortKey: entry.sortKey,
            event: {
              id: entry.event.id,
              isCreation: entry.event.fromStatus === null,
              /*
                A BELSO ERTEKBOL LESZ PARTNERI FELIRAT, ES A NYERS ERTEK ITT
                MARAD. Ez a fuggveny az EGYETLEN hely, ahol a ketto talalkozik
                -- ezert all a lekepezes ugyanebben a fajlban, es ezert nem kell
                hozza sem uj vegpont, sem szerver-oldali szamitas.
              */
              partnerStatusLabel: partnerStatusLabel(entry.event.toStatus),
              actorName: entry.event.actorName,
              createdAt: entry.event.createdAt,
            },
          }
        : entry,
    ),
  };
}

/**
 * MELYIK ALAKOT KAPTUK -- ES MIERT KELL EZ KIMONDOTTAN.
 *
 * A `detail` vegpont ket kulonbozo alakot ad vissza a hivo hatokoretol
 * fuggoen. Aki a valaszt olvassa, ezzel valaszthat kozottuk.
 *
 * A JELOLO MEZO AZ `assignees`: a delegaltak listaja BELSO munkaszervezes, es
 * a partner alakjaban SOHA nem szerepel. Egy kulon `kind` mezo olcsobbnak
 * latszana, de AZ IS kimenne a droton -- egy mezo, ami csak arrol szol, hogy
 * mit NEM kuldtunk.
 */
export function isPartnerServiceJobDetail(
  detail: ServiceJobDetail | ServiceJobPartnerDetail,
): detail is ServiceJobPartnerDetail {
  return !("assignees" in detail);
}
