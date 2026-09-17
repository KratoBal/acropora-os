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

export interface ServiceJobDetail extends ServiceJobListItem {
  description: string | null;
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
}

/**
 * AMIT A TELEFON KULD EGY UJ JEGYHEZ -- ES EZ SZUKEBB, MINT A WEBE.
 *
 * A webes urlap partnert, helyszint es eszkozoket valasztat. A helyszinen a
 * szerelo EGY gep elott all, es abbol a harom KOVETKEZIK: az `originAssetId`-bol
 * a SZERVER vezeti le oket (`placementOfAsset`).
 *
 * MIERT NEM A TELEFON VEZETI LE: szallitoi eszkoznel a jegy partnere a szallito
 * TUKOR-sora (`Supplier.customerId`), ami a partner BELSO reszlete. Kliens-
 * szerzodesse teve nem lehetne megvaltoztatni anelkul, hogy a telefon elromoljon.
 */
export interface CreateServiceJobInput {
  title: string;
  description?: string;
  /** Melyik eszkoznel nyitottak. Ebbol jon a partner es a helyszin. */
  originAssetId: string;
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
