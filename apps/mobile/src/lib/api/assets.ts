import { apiRequest } from "./client";
import { buildDocumentUpload, type PickedFile } from "./document-upload";

// Declared in lib/assets/asset-fields.ts so the logic that reasons about
// them does not have to import this module, which reaches SecureStore and
// the network. Re-exported below because callers already import them from
// the API layer.
import type {
  AssetCriticality,
  AssetKind,
  AssetOwnerType,
  AssetStatus,
  UpdateAssetInput,
} from "@/lib/assets/asset-fields";

/**
 * A végpont előtagja EGY HELYEN. Ez a fájl korábban 7-szer írta le ugyanezt, és
 * 2026-08-27-én a munkalap-kliens pontosan ezért tudott HÁROM helyen egyszerre
 * rossz előtaggal hívni: a szerkezet megengedte, hogy egy helyen javuljon és a
 * másik kettőben ne. Egy konstansnál ez a hiba nem tud részlegesen megtörténni.
 */
const BASE = "/service/assets";

export type {
  AssetCriticality,
  AssetKind,
  AssetOwnerType,
  AssetStatus,
  UpdateAssetInput,
};

/**
 * MIT TALALT A BEOLVASOTT MATRICAKOD -- KET VALASZ, HAROM VILAG-ALLAPOTRA.
 *
 * A „nem letezik" es a „letezik, de nem lathatod" NEM szerepel itt: az 404,
 * egyetlen alakban. Kulonben a matricakod letezes-teszt lenne idegen
 * eszkozokre. A `FREE` valasz csak belso hatokoru, irasi joggal rendelkezo
 * hivonak megy ki -- az indok a szerver `scanLabelOutcome` fejleceben all.
 */
export type AssetLabelScanResult =
  { kind: "ASSET"; asset: AssetDetail } | { kind: "FREE"; code: string };

export interface AssetHierarchyItem {
  id: string;
  assetNumber: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
}

/**
 * A PARTNER ALEGYSÉGE, ahol az eszköz áll. Csak szerviz partner tulajdonosnál
 * van értéke; vevőnél a cím a pontosítás.
 *
 * A `path` a gyökértől eddig az egységig tartó nevek sora, és a szerver adja --
 * nem itt épül. A kód és a név csak TESTVÉREK között egyedi, tehát a puszta név
 * két távoli ágra ugyanazt a sort adná.
 */
export interface AssetUnit {
  id: string;
  code: string;
  name: string;
  path: string[];
}

export interface AssetListItem extends AssetHierarchyItem {
  criticality: AssetCriticality;
  owner: {
    type: AssetOwnerType;
    id: string;
    code: string;
    displayName: string;
  };
  address?: { id: string; name?: string; formatted: string };
  unit?: AssetUnit;
  aquarium?: { id: string; aquariumNumber: string; name: string };
  parent?: AssetHierarchyItem;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  /**
   * Az ugyfel sajat eszkozkodja. A LISTAN is megjon, mert a kereses nezi: egy
   * talalat, ami nem mutatja meg, mire illeszkedett, ugyanazt kerdezteti meg
   * masodszor.
   */
  inventoryNumber?: string;
  nextServiceAt?: string;
  /**
   * A QR-matricán lévő azonosító. A listán is megjön, mert a helyszíni
   * katalógus enélkül nem tudja feloldani a beolvasott kódot térerő nélkül.
   */
  qrToken: string;
  childCount: number;
  updatedAt: string;
}

export interface AssetDetail extends AssetListItem {
  category?: string;
  /**
   * A FUNKCIO -- FUGGETLEN A KATEGORIATOL, lasd az `AssetFunction` fejleceit
   * a kozos `packages/types`-ban. Kanban 68add892, 2026-09-22.
   */
  function?: string;
  functionId?: string;
  /**
   * A CSATOLMANYOK -- ES EZ A MEZO MINDIG IS JOTT A SZERVERTOL.
   *
   * A kozos `packages/types` `AssetDetail`-je hordozza (`documents:
   * AssetDocumentSummary[]`), a szerver `detail()` valasza tartalmazza, es a
   * WEBES lap mar hasznalja is. Csak EBBOL a masolatbol hianyzott.
   *
   * A mobil SZANDEKOSAN sajat tipus-masolatot tart (nincs kozos csomagja),
   * tehat a ket oldal kozott nincs fordito-szintu kapcsolat: az adat NEV
   * NELKUL is atjott, es a hianya nem hibazott -- csak megfosztott attol, hogy
   * hivatkozni lehessen ra. Ezert allt a telefonon nulla kep egy olyan
   * valaszban, ami a listat vegig tartalmazta.
   */
  documents: AssetDocumentSummary[];
  /**
   * AZ ESZKOZON ALLO MATRICA KODJA, HA VAN. A szerkeszto urlap EBBOL tolti elo
   * a mezot: egy ures doboz azt allitana, hogy nincs matrica, es a szerelo egy
   * mukodo kodot irna felul anelkul, hogy latna.
   */
  labelCode?: string;
  /**
   * A TELJESITMENY ES A KIIRT MERTEKEGYSEGE.
   *
   * AZ EGYSEG KIIRVA JON, nem csak azonositokent: a telefonnak `500 W`-ot kell
   * mutatnia, es tereró nelkul nem tudna egy masodik hivassal utananezni a
   * torzsadatban. A kivezetett egyseg is idejon -- a kivezetes a VALASZTOT
   * szukiti, nem a mar rogzitett erteket.
   */
  performance?: string;
  performanceUnit?: { id: string; code: string; name: string };
  /**
   * A TERFOGAT (m3) ES A FOGYASZTAS (kW) -- FUGGETLEN A TELJESITMENYTOL.
   * Kanban 8c77cf3e, 2026-09-23: 136 eszkozon egyszerre all teljesitmeny
   * ES fogyasztas, tehat kulon mezok. Mindketto mindig fix egysegben
   * ertendo, nincs kulon mertekegyseg-hivatkozas.
   */
  volume?: string;
  /**
   * AZ OSSZEADHATO SZAM. Balazs kerese (2026-09-23): ossze akarja adni a
   * fogyasztast, tehat ez SZAM, nem szabad szoveg.
   */
  powerConsumption?: string;
  /** A fogyasztas eredeti szovege -- lasd a `powerConsumption` fejleceit. */
  powerConsumptionRaw?: string;
  description?: string;
  installedAt?: string;
  warrantyExpiresAt?: string;
  serviceIntervalDays?: number;
  lastServicedAt?: string;
  notes?: string;
  product?: { variantId: string; sku: string; name: string };
  ancestors: AssetHierarchyItem[];
  children: AssetHierarchyItem[];
  events: {
    id: string;
    type: string;
    actor?: { id: string; displayName: string };
    occurredAt: string;
  }[];
  createdAt: string;
}

export interface AssetOwnerOption {
  type: AssetOwnerType;
  id: string;
  code: string;
  displayName: string;
  isActive: boolean;
  addresses: { id: string; name?: string; formatted: string }[];
  /**
   * Igaz, ha ez a tulajdonos ma NEM választható új eszközhöz (nem szerviz-jelölt
   * partner vagy webshopos vevő), és csak azért jött vissza, mert egy MÁR
   * rögzített eszközön rajta van. A telefonon új eszköz felvételekor nem
   * fordulhat elő; a mező azért van itt, hogy a lista egy alakú maradjon a
   * weben és a mobilon.
   */
  outsideServiceScope?: boolean;
}

export interface AssetQrCode {
  assetId: string;
  assetNumber: string;
  value: string;
  svg: string;
  labelSizeMm: 30;
}

export interface CreateAssetInput {
  /**
   * A HELYSZINI ROGZITES IDEMPOTENCIA-KULCSA, a sor azonositoja.
   *
   * Elhagyhato: terero mellett a felvitel nem all sorba, tehat nincs mit
   * ujrakuldeni. A sorbol indulo kuldes viszont MINDIG viszi, mert ott a
   * halozati hiba utani ujraprobalas a normalis ut -- es epp ott lehet, hogy a
   * szerver mar letrehozta az eszkozt, csak a valasz veszett el.
   */
  clientOperationId?: string;
  ownerType: AssetOwnerType;
  ownerId: string;
  customerAddressId?: string;
  /**
   * A partner alegysége. Csak `SUPPLIER` tulajdonosnál küldhető: vevőnél a
   * szerver el is utasítja, mert ott a cím a pontosítás.
   */
  departmentId?: string;
  parentAssetId?: string;
  kind: AssetKind;
  name: string;
  /** Az eszkoz kategoriaja, a torzsadatbol. Elhagyhato. */
  categoryId?: string;
  /** Az eszkoz funkcioja, FUGGETLENUL a kategoriatol. Elhagyhato. */
  functionId?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  /**
   * A partner SAJÁT azonosítója az eszközön (leltári szám). Nem a miénk: a
   * gépen gyakran ez a matrica van rajta, és a helyszínen ezt olvassa le a
   * szerelő. A szerver felvitelkor is fogadja.
   */
  inventoryNumber?: string;
  /**
   * AZ ELŐRE NYOMTATOTT MATRICA KÓDJA (egy betű és négy szám, pl. V2196).
   *
   * NEM UGYANAZ, MINT AZ `inventoryNumber`: az a PARTNERÉ, ez a MIÉNK. A
   * szerelő a helyszínen a mi matricánkat ragasztja fel, és ezt a kódot köti
   * az eszközhöz. A régi, generált QR-tokent NEM ez váltja ki: az továbbra is
   * a beolvasás kulcsa marad (Balázs, 2026-09-02 16:27: „nem tedd vissza a
   * régi qr-t, csak majd az újat").
   */
  labelCode?: string;
  /** A terfogat, mindig m3-ben. Elhagyhato. */
  volume?: string;
  /** A fogyasztas, mindig kW-ban -- az osszeadhato szam. Elhagyhato. */
  powerConsumption?: string;
  /** A fogyasztas eredeti szovege. Elhagyhato. */
  powerConsumptionRaw?: string;
  installedAt?: string;
  serviceIntervalDays?: number;
}

export interface AssetListResponse {
  items: AssetListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/**
 * A SZERELŐ LISTÁJA: a szerviz-partnerek eszközei.
 *
 * Az `ownerScope` EXPLICIT, mert ugyanezt a végpontot használja a webes
 * nyilvántartás is, ahol a teljesség az érték. A szűrés a szerveren történik:
 * egy már lapozott halmazt itt szűrni annyi lenne, hogy a lapszám a kihagyott
 * sorokat is számolja.
 */
/**
 * A KERESÉS A SZERVEREN FUT, és ugyanazt a hat mezőt nézi, amit a webes lista
 * (eszközszám, név, gyártó, modell, sorozatszám, leltári szám) plusz a
 * tulajdonos nevét. A telefonon szűrni egy már lapozott halmazt annyi lenne,
 * hogy ötven sorból hármat mutatunk, miközben a darabszám a többit is számolja.
 */
/**
 * A HELYSZIN-SZURO A SZERVEREN MAR LETEZIK, ES A RESZFAT IS BELEVESZI.
 *
 * Egy nagyobb egyseget valasztva az alatta allo egysegek eszkozei is jonnek
 * (`collectUnitSubtreeIds`) -- ez szandekos, es ugyanaz a szabaly, amit a jegy
 * felvitele var: "a Biodom alatti medencen logo eszkoz IS a Biodom eszkoze".
 *
 * AZ URES ERTEK NEM MEGY KI. Egy `departmentId=` alaku, ures parameter nem
 * ugyanaz, mint a parameter hianya: a szerver egy ures azonositot kapna, es a
 * reszfa-kibontast egy nem letezo egysegre futtatna.
 */
export function listAssets(
  page = 1,
  pageSize = 50,
  search = "",
  departmentId = "",
) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    status: "ACTIVE",
    ownerScope: "SERVICE_PARTNER",
  });
  if (search.trim()) query.set("search", search.trim());
  if (departmentId.trim()) query.set("departmentId", departmentId.trim());
  return apiRequest<AssetListResponse>(`${BASE}?${query}`);
}

export function getAsset(id: string) {
  return apiRequest<AssetDetail>(`${BASE}/${encodeURIComponent(id)}`);
}

export function scanAsset(qrToken: string) {
  return apiRequest<AssetDetail>(`${BASE}/scan/${encodeURIComponent(qrToken)}`);
}

/**
 * ESZKOZ A MATRICAKODROL.
 *
 * MASIK UT, MINT A `scanAsset`, ES EZ NEM MASOLAS. A ket azonosito EROSSEGE
 * kulonbozik: a `qrToken` 128 bites veletlen, a matricakod ot karakter
 * (260 ezer lehetoseg). Ezert a szerveren a matricas ut TULAJDONT IS
 * ELLENORIZ, a qrToken-es nem -- a jogosultsagi szintjuk azonos, a
 * lathatosaguk nem.
 *
 * A TELEFON 2026-09-17-IG SOHA NEM HIVTA. A vegpont 2026-09-02 ota all, es
 * egyetlen hivoja a webes felulet volt. Vagyis egy elore nyomtatott matricaval
 * nem lehetett megtalalni a gepet, amire fel van ragasztva -- holott a matrica
 * pont ezert kerul ra.
 */
export function scanAssetByLabel(code: string) {
  return apiRequest<AssetLabelScanResult>(
    `${BASE}/scan-label/${encodeURIComponent(code)}`,
  );
}

export function listAssetOwners() {
  return apiRequest<{ items: AssetOwnerOption[] }>(`${BASE}/owners`);
}

/**
 * AZ ESZKOZ-KATEGORIAK, A VALASZTOHOZ.
 *
 * CSAK AZ AKTIVAK: a kivezetett kategoria a felviteli urlapon pont azt hozna
 * vissza, ami miatt kivezettuk.
 */
export function listAssetCategories() {
  return apiRequest<{ items: { id: string; name: string }[] }>(
    "/asset-categories",
  );
}

/**
 * AZ ESZKOZ-FUNKCIOK, A VALASZTOHOZ -- SZO SZERINT A FENTI
 * `listAssetCategories`, mas vegponton. FUGGETLEN torzsadat, nincs kozottuk
 * kapcsolat (kanban 68add892, 2026-09-22).
 */
export function listAssetFunctions() {
  return apiRequest<{ items: { id: string; name: string }[] }>(
    "/asset-functions",
  );
}

export function createAsset(input: CreateAssetInput) {
  return apiRequest<AssetDetail>(BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * A NÉV-ÜTKÖZÉS ELLENŐRZÉSE, A MENTÉS ELŐTT. Nem ír, csak megnevezi, ha már
 * létezik ugyanilyen nevű eszköz -- lásd a szerver vezérlőjének jegyzetét. A
 * `createAsset` fentebb emiatt VÁLTOZATLAN marad, és ezt a hívást a MA élesben
 * futó telefon nem is ismeri, tehát nem is hívja -- a létrehozás betűre
 * ugyanaz marad neki.
 */
export function checkAssetName(name: string) {
  return apiRequest<AssetListItem[]>(
    `${BASE}/name-check?${new URLSearchParams({ name })}`,
  );
}

export function updateAsset(id: string, input: UpdateAssetInput) {
  return apiRequest<AssetDetail>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getAssetQr(id: string) {
  return apiRequest<AssetQrCode>(`${BASE}/${encodeURIComponent(id)}/qr`);
}

/**
 * A dokumentum-fajták, ahogy a szerver ismeri őket. SAJÁT másolat, nem a
 * `@acropora/types` csomagból: az Expo app szándékosan nem húzza be a pnpm
 * munkatér csomagjait (lásd `docs/MOBILE-DEVELOPMENT.md`). A nevek a
 * szerveréi, hogy a két oldal összevetése olvasásra is elvégezhető legyen.
 *
 * A FÉNYKÉPNEK 2026-09-22 ÓTA SAJÁT FAJTÁJA VAN. Ez a megjegyzés korábban azt
 * írta, hogy a fénykép az `OTHER` alá kerül, és hogy a külön `PHOTO` nyitott
 * termék-döntés. A döntés megszületett (Balázs, 2026-09-22): a partner lássa a
 * fényképeket, a számlát ne - és ezt csak külön fajtával lehet megadni, mert a
 * MIME-típust a feltöltő gépe mondja, a fajtát viszont ember választja.
 *
 * A LISTA ITT MÁSOLAT, ÉS EZ SZÁNDÉKOS: a mobil a pnpm workspace-en KÍVÜL áll,
 * tehát a közös csomagot nem tudja importálni. A fordító a két oldalt SOHA nem
 * veti össze - ha a szerveren egy hatodik fajta keletkezik, itt semmi nem szól.
 */
export type AssetDocumentType =
  "INVOICE" | "WARRANTY" | "MANUAL" | "OTHER" | "PHOTO";

/**
 * Egy feltöltött dokumentum sora, ahogy a végpont visszaadja.
 *
 * A MEZŐNEVEK A SZERVERÉI, ÉS EZT MEGMÉRTEM, NEM KITALÁLTAM. Az első
 * változatomban `uploadedAt` állt, a szerveren `createdAt` van, és a fordító
 * ezt SOHA nem mondta volna meg: a mobil szándékosan másolatot tart, tehát a
 * két oldal között nincs típus-kapcsolat. Egy elgépelt mezőnév itt
 * `undefined`-ként jelenne meg a képernyőn, hibaüzenet nélkül.
 */
export interface AssetDocumentSummary {
  id: string;
  type: AssetDocumentType;
  fileName: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  sha256: string;
  /**
   * A CSATOLMANY FELIRATA -- MIT LATUNK A KEPEN. `null`, ha nincs.
   *
   * A HIANY EGYFELE ALAKBAN ALL (`null`, nem ures string), ugyanugy, mint a
   * kozos tipusban: kulonben a "nincs felirat" es a "szandekosan ures felirat"
   * megkulonboztethetetlen lenne.
   *
   * MIERT HIANYZOTT EDDIG: a szerver 2026-09-17 ota kuldi, es a WEBES lap
   * hasznalja is -- csak EBBOL a masolatbol maradt ki. A mobil szandekosan
   * sajat tipus-masolatot tart, tehat a ket oldal kozott nincs fordito-szintu
   * kapocs: a mezo NEV NELKUL is atjott a valaszban, es a hianya nem hibazott.
   * Ugyanaz az alak, mint a `documents` mezo hianya egy szinttel feljebb.
   */
  caption: string | null;
  uploadedBy?: { id: string; displayName: string };
  createdAt: string;
}

/**
 * DOKUMENTUM- ÉS FÉNYKÉP-FELTÖLTÉS EGY ESZKÖZHÖZ.
 *
 * A törzset a `buildDocumentUpload` állítja össze, és a hibát MÉG A
 * KÜLDÉS ELŐTT megnevezi. Itt csak az marad, ami hálózatot igényel.
 *
 * A válasz LISTA, egyetlen fájlnál is: a végpont mindig azzal felel.
 */
/**
 * A TORZS NEVESITETT TIPUSSAL MEGY, EGYETLEN MEZONEL IS.
 *
 * MIERT: a `mobile-request-body.spec.ts` orzo a NEVESITETT tipusokat veti ossze
 * a szerver DTO-javal. Egy helyben megirt objektum (`{ caption }`) atcsuszna
 * rajta. Ugyanez az alak all a hibajegy-oldalon
 * (`SetServiceJobDocumentCaptionInput`), es ez SZANDEKOS ismetles: a ket ut
 * ket kulon vegpontra megy, tehat egy kozos tipus azt allitana, hogy egyszerre
 * valtoznak.
 */
export interface SetAssetDocumentCaptionInput {
  caption: string | null;
}

/**
 * A FELIRAT ATIRASA EGY ESZKOZ-CSATOLMANYON.
 *
 * `PATCH`, mert a sornak EGY mezojet mozditja: a fajl, a meret es a lenyomat a
 * feltoltes pillanatabol valo, es nem is irhato felul. A szerver ugyanezen az
 * utvonalon `SERVICE_MANAGE` jogot ker.
 */
export function setAssetDocumentCaption(
  id: string,
  documentId: string,
  caption: string | null,
) {
  const torzs: SetAssetDocumentCaptionInput = { caption };
  return apiRequest<{ ok: true }>(
    `${BASE}/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(torzs),
    },
  );
}

export async function uploadAssetDocuments(
  id: string,
  input: { type?: AssetDocumentType; files: readonly PickedFile[] },
): Promise<AssetDocumentSummary[]> {
  const built = buildDocumentUpload(input);
  if (!built.ok) throw new Error(built.reason);

  return apiRequest<AssetDocumentSummary[]>(
    `${BASE}/${encodeURIComponent(id)}/documents`,
    { method: "POST", body: built.body },
  );
}
