/**
 * A HIBAJEGY VÁLASZ-TÍPUSAI, A HÁLÓZATTÓL KÜLÖN.
 *
 * MIÉRT KÜLÖN FÁJL, ÉS EZ A REPÓ SAJÁT MINTÁJA: az `asset-fields.ts` fejléce
 * ugyanezt mondja ki -- a típusok azért állnak külön, hogy a róluk gondolkodó
 * logika ne húzza be a klienst, ami a SecureStore-hoz és a hálózathoz nyúl.
 *
 * ÉS NÁLAM EZ NEM ELMÉLETI VOLT: az első alakban a típusok a kliensben álltak,
 * és az első spec, ami a `worksheetsOf` függvényt mérte, behúzta rajtuk
 * keresztül a `client.ts`-t -- azon át a `@/config/env` és a
 * `@/lib/auth/token-store` alakot, amit a teszt-konfig SZÁNDÉKOSAN nem old fel
 * (lásd a `tsconfig.test.json` fejlécét). A mérés tehát nem a kódon bukott el,
 * hanem azon, hogy hol álltak a típusok.
 *
 * A MEZŐNEVEKET EGY ŐRZŐ VETI ÖSSZE a közös csomaggal
 * (`apps/api/src/mobile/mobile-response-mirror.spec.ts`): egy másolat pontosan
 * addig ér valamit, amíg igaz.
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

export interface ServiceJobListItem {
  id: string;
  jobNumber: string;
  title: string;
  status: ServiceJobStatusValue;
  partnerStatusLabel: string;
  customerName: string | null;
  /** A helyszín teljes útja, a gyökértől lefelé. `null`, ha nincs helyszín. */
  departmentPath: string[] | null;
  worksheetCount: number;
  createdAt: string;
}

export interface ServiceJobListResponse {
  items: ServiceJobListItem[];
  /**
   * A SZERVER ELVAGTA-E A LISTAT. Ketszaz sornal vagodik, es a valasz EZ ELOTT
   * is mindig kuldte -- a mobil TUKOR nem deklaralta, tehat a telefon nem
   * tudott rola.
   *
   * ES EZ NEM ELMELETI: a helyszin-letoltes epp ebbol tudja megmondani, hogy a
   * keszuleken levo masolat HIANYOS. Egy nem deklaralt mezo itt ugyanaz, mint
   * egy hianyzo: az adat a droton van, es senki nem olvassa.
   *
   * Elhagyhato, mert a tukor REGEBBI valaszokkal is talalkozhat (sorban allo,
   * mentett torzsek), es egy kotelezo mezo azokat forditaskor vagna el.
   */
  truncated?: boolean;
}

/**
 * EGY MUNKALAP, AMI A JEGYHEZ TARTOZIK.
 *
 * A MEZONEVEK A SZERVERTOL JONNEK, nem tolem: `number` (es `null` is lehet, ha
 * a lap meg piszkozat), `subject` a lap NEVE. Az elso alakom
 * `{ id, worksheetNumber, status }` volt -- HAROM mezo, amibol EGY sem letezik.
 * A typecheck nem szolt, mert a sajat deklaraciom onmagaval volt konzisztens.
 */
export interface ServiceJobWorksheetLink {
  id: string;
  /** `null`, amig a lap piszkozat: szama a kiadaskor keletkezik. */
  number: string | null;
  /** A lap NEVE (a `734` ota). Ez all a kepernyon, a szam melle. */
  subject: string;
  createdAt: string;
  handedOverAt: string | null;
}

/**
 * EGY ESZKOZ, AMIT A JEGY ERINT.
 *
 * KET AZONOSITO: az `id` a CSATOLASE, az `assetId` az ESZKOZE. A kepernyo az
 * eszkoz lapjara navigal, tehat az `assetId` kell neki -- az elso alakom az
 * `id`-t hasznalta, ami a csatolas sora, es egy nem letezo eszkoz-lapra vitt
 * volna.
 */
export interface ServiceJobAssetLink {
  id: string;
  assetId: string;
  assetNumber: string;
  assetName: string;
  attachedAt: string;
}

/**
 * A NAPLO EGY BEJEGYZESE. A MUNKALAPOK EZEN AT JONNEK, NEM KULON MEZOBEN.
 *
 * ES EZ VOLT A LEGSULYOSABB TEVEDESEM: a lap `detail.worksheets`-et olvasott,
 * ami A VALASZBAN NINCS -- `undefined.length`, vagyis az adatlap MEG SEM NYILT
 * volna meg. A kozos csomagban latott `worksheets: ServiceJobWorksheetLink[]`
 * sor a `serviceJobTimeline()` FUGGVENY parametere, nem a valasz tipusa; egy
 * grep-talalatot vettem a valasz alakjanak.
 */
export type ServiceJobTimelineEntry =
  | { kind: "status"; at: string; sortKey: string }
  | {
      kind: "worksheet";
      at: string;
      sortKey: string;
      worksheet: ServiceJobWorksheetLink;
    }
  | { kind: "asset"; at: string; sortKey: string; asset: ServiceJobAssetLink }
  | { kind: "document"; at: string; sortKey: string };

export interface ServiceJobDocumentSummary {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /**
   * MIT LATUNK A KEPEN. `null`, ha nincs felirat.
   *
   * A SZERVER 2026-09-17 OTA KULDI, es a telefon EDDIG NEM IS ISMERTE: az
   * irodaban irt felirat a webes lapokon latszott, a szerelo telefonjan nem. Egy
   * hianyzo mezo a tukorben NEM hibazik -- egyszeruen nincs mit kiirni.
   *
   * A HIANY EGYFELE ALAKBAN ALL (`null`, nem ures string), ugyanugy, mint a
   * szerveren: kulonben a "nincs felirat" es a "szandekosan ures felirat" ket
   * allapota egyformanak tunne.
   */
  caption: string | null;
  createdAt: string;
}

/**
 * A HIBAJEGY ADATLAPJA PARTNER-HATOKORBEN -- ES EZ A TUKOR EDDIG NEM LETEZETT.
 *
 * A szerver a `detail` vegponton partner-hatokoru hivonak MASIK alakot ad
 * (`partnerServiceJobDetail`), ami tizenegy belso mezot szandekosan elhagy.
 * A telefon tipusa viszont MINDIG a belso alakot allitotta -- tehat HAZUDOTT,
 * es a fordito ezert nem szolt, amikor a kepernyo olyan mezot olvasott, ami
 * partnernel nincs ott.
 *
 * AZ ARA MERT ES ELES VOLT (2026-09-22 20:05, Balazs iOS build 19): partner
 * fiokkal megnyitva a jegyet az alkalmazas OSSZEOMLOTT
 * (`detail.allowedSteps.length` egy `undefined` erteken).
 *
 * A MEZOK, AMIK ITT NINCSENEK, es amiket a belso alak visz: `status`,
 * `customerName`, `customerId`, `departmentId`, `departmentName`,
 * `scheduledAt`, `startedAt`, `completedAt`, `allowedSteps`, `assignees`,
 * `hidden`. Helyettuk `partnerStatus` es `partnerStatusLabel` all.
 */
export interface ServiceJobPartnerDetail {
  id: string;
  jobNumber: string;
  title: string;
  description: string | null;
  partnerStatus: string;
  partnerStatusLabel: string;
  departmentPath: string[] | null;
  createdAt: string;
  timeline: ServiceJobTimelineEntry[];
  assets: ServiceJobAssetLink[];
}

export interface ServiceJobDetail extends ServiceJobListItem {
  description: string | null;
  /**
   * A JEGY PARTNERE ES HELYSZINE, AZONOSITOVAL -- ES EZ NEM UJ VEGPONT.
   *
   * A szerver MAR MA kuldi mind a kettot (`service-jobs.service.ts`, a
   * reszletlap valasza), es a kozos tipuson is ott allnak. A telefon
   * tukor-tipusa viszont nem ismerte oket, tehat a munkalap-felvitel nem tudta
   * atvenni a jegy partnerét -- holott az adat ott volt a valaszban.
   *
   * Merve 2026-09-18: nulla `customerId` talalat volt ebben a fajlban. Ez az
   * "adat megvan, a parancs nincs" fajta, es a feloldasa nem szerver-munka,
   * hanem ez a ket sor.
   */
  customerId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /**
   * MIT LÉPHET INNEN -- ÉS EZT A SZERVER MONDJA MEG, NEM EGY TÜKÖR.
   *
   * Az átmenet-szabály tiszta függvényként áll az API-ban, és a telefon nem
   * húzhatja be a munkatér csomagjait. Egy MÁSOLAT kellett volna ide -- a
   * negyedik a matricakód, a teljesítmény-alak és a jogosultság után --, ha a
   * válasz nem hozná magával a listát. Hozza, tehát nincs mit elcsúsztatni.
   */
  allowedSteps: ServiceJobStatusValue[];
  /**
   * A HAROM FORRAS EGY IDORENDI NAPLOVA. A munkalapok ES a csatolt eszkozok
   * INNEN jonnek -- a valaszban nincs kulon `worksheets` mezo.
   */
  timeline: ServiceJobTimelineEntry[];
  assets: ServiceJobAssetLink[];
  /**
   * A JEGY FELELOSEI -- ES EZT IS A SZERVER KULDI MAR MA.
   *
   * A `detail()` valasza tartalmazza (userId, name, assignedAt), a kozos tipus
   * is ismeri; a telefon tukre nem. A munkalap-felvitel emiatt nem tudta
   * atvenni a jegy feleloset. Ugyanaz a fajta, mint a `customerId`: az adat
   * megvan, a parancs nincs.
   */
  assignees: ServiceJobAssignee[];
}

/** Egy felelos a jegyen. A `name` a becenev, ha van. */
export interface ServiceJobAssignee {
  userId: string;
  name: string;
  assignedAt: string;
}

/**
 * AMIT A TELEFON KULD EGY UJ JEGYHEZ -- KET UTON.
 *
 * GEP ELOL (a gyakori eset): a szerelo EGY gep elott all, es a partner meg a
 * helyszin abbol KOVETKEZIK -- az `originAssetId`-bol a SZERVER vezeti le oket
 * (`placementOfAsset`). Ilyenkor a telefon nem kuld partnert.
 *
 * MIERT NEM A TELEFON VEZETI LE: szallitoi eszkoznel a jegy partnere a szallito
 * TUKOR-sora (`Supplier.customerId`), ami a partner BELSO reszlete. Kliens-
 * szerzodesse teve nem lehetne megvaltoztatni anelkul, hogy a telefon elromoljon.
 *
 * GEP NELKUL (Balazs kerese, 2026-09-18): nincs mibol levezetni, tehat amit a
 * szerelo megad, az megy fel. A HAROM MEZO MIND ELHAGYHATO, es ez nem uj
 * szerzodes: a szerver DTO-jaban mind a harom `@IsOptional()`, a sema ket
 * oszlopa nullazhato, es a WEBES felvitel ma is igy mukodik -- `originAssetId`
 * nelkul, `customerId`/`departmentId` mezokkel. A telefon eddig csak nem
 * hasznalta ezt az utat.
 *
 * AMIT A KETTO KOZUL KULDUNK, AZT A `uj-jegy-torzs.ts` donti el, egy helyen:
 * gep mellett partner es helyszin NEM megy fel, mert a megadott ertek a
 * szerveren ELSOBBSEGET elvezne, es csendben felulirna azt, amit a gep mond.
 */
export interface CreateServiceJobInput {
  title: string;
  description?: string;
  /** Melyik eszkoznel nyitottak. Ebbol jon a partner es a helyszin. */
  originAssetId?: string;
  /** Csak gep NELKUL: amit a szerelo megadott. */
  customerId?: string;
  /** Csak gep NELKUL, es csak partnerrel egyutt -- a szerver is ezt orzi. */
  departmentId?: string;
  /**
   * A SOR AZONOSITOJA, ami a szerver IDEMPOTENCIA-KULCSA is. A sor a halozati
   * hibat SZANDEKOSAN ujraprobalja, es epp ott lehet, hogy a szerver mar
   * letrehozta a jegyet, csak a valasz veszett el.
   */
  clientOperationId?: string;
}

/**
 * A MŰVELET-AZONOSÍTÓ A TARTALOMBÓL SZÜLETIK, NEM VÉLETLENBŐL.
 *
 * Egy kétszer megnyomott gomb különben KÉT jegyet nyitna ugyanarról a hibáról,
 * és a szerelő a listán kétszer látná ugyanazt -- offline ráadásul úgy, hogy
 * mind a kettő fel is megy.
 *
 * AZ IDŐBÉLYEG BENNE VAN, ÉS EZ SZÁNDÉKOS: ugyanarról a gépről KÉT külön hibát
 * is be lehet jelenteni, akár ugyanazzal a címmel („zúg"). Az időpont az, ami
 * két valódi bejelentést megkülönböztet -- e nélkül a másodikat elnyelnénk.
 */
export function serviceJobOperationId(input: {
  originAssetId: string;
  openedAt: string;
}): string {
  return `service-job:${input.originAssetId}:${input.openedAt}`;
}
