import { apiRequest } from "./client";
import {
  buildAssetDocumentUpload,
  type PickedFile,
} from "./asset-document-upload";

/**
 * A végpont előtagja EGY HELYEN. Ez a fájl korábban 3-szer írta le ugyanezt, és
 * 2026-08-27-én a munkalap-kliens pontosan ezért tudott HÁROM helyen egyszerre
 * rossz előtaggal hívni: a szerkezet megengedte, hogy egy helyen javuljon és a
 * másik kettőben ne. Egy konstansnál ez a hiba nem tud részlegesen megtörténni.
 */
const BASE = "/service/worksheets";

/**
 * MUNKALAPOK A TELEFONON.
 *
 * A telefonon a munkalap MUNKAUTASÍTÁS: a szerelő azt nézi meg, mit kell
 * csinálni, hol, és kire van kiosztva. A lap MEGNYITÁSA, a tételek rögzítése és
 * az ALÁÍRÁS innen is megy; a lezárás és az ár az irodáé (lásd lent).
 *
 * A szerver ugyanazzal a jogosultsággal védi a munkalapot, mint az eszközöket
 * (`service.view` az olvasáshoz, `service.manage` az íráshoz).
 *
 * === EZ A MODUL 2026-09-03 ÓTA ÍR IS, ÉS A KORÁBBI SZŰKÍTÉS INDOKA MEGDŐLT ===
 *
 * Itt korábban az állt, hogy a telefonon szándékosan nincs írás, mert egy
 * félkész lap-írás olyan állapotot hozna létre, amit csak a webes felület tud
 * befejezni. A LAP MEGNYITÁSA nem ilyen: a szerver három mezőt kér
 * (`customerId`, `departmentId`, `subject`), a tételek listája alapértelmezetten
 * ÜRES, tehát a helyszínen nyitott lap TELJES ÉRTÉKŰ, csak még nincs rajta tétel.
 *
 * === ÉS AZ ALÁÍRÁS IS ITT VAN, 2026-09-03 ÓTA ===
 *
 * Itt korábban az állt, hogy az aláíratás az irodai oldalon dől el. Ez a mondat
 * MA MÁR NEM IGAZ: Balázs döntése szerint a lapot a SZERELŐ írja alá, a saját
 * nevében, a telefonon. A régi mondatot nem kiegészítettem, hanem átírtam --
 * egy megjegyzés, ami egy megváltozott szabályt ír le, rosszabb a semminél.
 *
 * Ami továbbra sem itt van: a LEZÁRÁS és az ÁR. Azok az irodai oldalon dőlnek
 * el (Balázs döntése, 2026-09-02), és ez az aláírás előfeltétele is: a szerver
 * csak `AWAITING_SIGNATURE` állapotú verziót ír alá, oda pedig a lezárás visz.
 *
 * A típusok SAJÁT másolatok, nem a `@acropora/types` csomagból jönnek: az Expo
 * app szándékosan nem húzza be a pnpm munkatér csomagjait (lásd
 * `docs/MOBILE-DEVELOPMENT.md`). A neveik a szerveréi, hogy a két oldal
 * összevetése olvasásra is elvégezhető legyen.
 */

export type WorksheetVersionStatus =
  "DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED";

export interface WorksheetListItem {
  id: string;
  /** `null`, amíg a lap piszkozat: a sorszám a lezáráskor keletkezik. */
  number: string | null;
  /** A szám a verzióval együtt (`BIO-2026-001/2`), vagy `null` piszkozaton. */
  label: string | null;
  customerName: string;
  departmentCode: string;
  subject: string;
  status: WorksheetVersionStatus;
  version: number;
  versionCount: number;
  grossAmount: string;
  /** A felelősök neve. Üres tömb, ha a lap még nincs kiosztva. */
  assigneeNames: string[];
  updatedAt: string;
}

export interface WorksheetListResponse {
  items: WorksheetListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface WorksheetAssignee {
  userId: string;
  name: string;
  assignedAt: string;
}

export interface WorksheetLineDetail {
  id: string;
  position: number;
  description: string;
  detail: string | null;
  assetId: string | null;
  assetNumber: string | null;
  /**
   * Az ugyfel sajat eszkozkodja, elo hivatkozassal: a szerver olvasaskor huzza
   * az eszkozrol, a soron nincs masolata.
   */
  inventoryNumber: string | null;
  quantity: string;
  unit: string;
  unitNet: string;
  vatRatePercent: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
}

export interface WorksheetSignatureDetail {
  decision: "ACCEPTED" | "REJECTED";
  signerName: string;
  signedByName: string | null;
  signedAt: string;
  note: string | null;
}

export interface WorksheetVersionSummary {
  id: string;
  version: number;
  label: string | null;
  status: WorksheetVersionStatus;
  changeReason: string | null;
  createdByName: string | null;
  createdAt: string;
  closedAt: string | null;
  closedByName: string | null;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  signature: WorksheetSignatureDetail | null;
}

export interface WorksheetVersionDetail extends WorksheetVersionSummary {
  subject: string;
  unitName: string | null;
  description: string | null;
  issueDate: string | null;
  fulfillmentDate: string | null;
  dueDate: string | null;
  currency: string;
  lines: WorksheetLineDetail[];
}

/** Egy szem a folytatás-láncban. A szám `null`, amíg az a lap piszkozat. */
export interface WorksheetChainLink {
  id: string;
  number: string | null;
}

export interface WorksheetDetail {
  id: string;
  number: string | null;
  customer: {
    id: string;
    customerNumber: string;
    displayName: string;
    worksheetPartnerCode: string | null;
  };
  department: {
    id: string;
    code: string;
    name: string;
  };
  createdByName: string | null;
  /**
   * A HIBAJEGY, AMI MOGOTT EZ A LAP ALL -- vagy `null`, ha nincs.
   *
   * A `null` NEM hianyzo adat, hanem a folyamat egyik rendes allapota: a lap
   * keletkezhet hibajegy nelkul (a szerelo a helyszinen felveszi, a jegy nalunk
   * szuletik meg utolag). A kepernyo ezert nem elrejti, hanem kimondja.
   *
   * A SZERVER EZT MAR REGOTA KULDI, es a webes lap ki is rajzolja. A telefon
   * tipusabol hianyzott, tehat a mezo megerkezett es eldobodott -- nem hianyzo
   * kepesseg volt, hanem be nem kotott.
   */
  serviceJob: { id: string; jobNumber: string } | null;
  assignees: WorksheetAssignee[];
  createdAt: string;
  updatedAt: string;
  continues: WorksheetChainLink | null;
  continuedBy: WorksheetChainLink[];
  currentVersion: WorksheetVersionDetail;
  versions: WorksheetVersionSummary[];
}

export interface WorksheetListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  /**
   * A SAJÁT LAPOK szűrője. A szerver szűr, nem a telefon: egy már lapozott
   * halmazból itt kiszedni az idegen sorokat annyi lenne, mint huszonöt sor
   * helyett hármat mutatni egy oldalon, miközben a darabszám a többit is
   * beleszámolja.
   */
  assigneeId?: string;
  /**
   * A PARTNER szűrője. A `customerId` a munkalapé, nem a partneré: a szerviz
   * partner lapjait egy saját vevő-sor hordozza, és a választó ezt a
   * azonosítót adja vissza.
   */
  customerId?: string;
  /**
   * ÁLLAPOT SZERINTI SZŰRÉS, a LEGUTOLSÓ verzió állapotára.
   *
   * A szerver ezt `DISTINCT ON`-nal oldja meg, tehát egy háromszor átírt, ma
   * már aláírt lap NEM jön fel „piszkozat" szűrőre. A telefonon ugyanez a
   * szabály áll, mert ugyanaz a végpont felel.
   */
  status?: WorksheetVersionStatus;
}

/**
 * AKIRE MUNKALAPOT LEHET ÍRNI, tehát akire szűrni is érdemes.
 *
 * Ugyanaz a végpont, amit a webes felvitel használ, és `service.view` jogot
 * kér -- a szerelőnek megvan. A lista SZŰKEBB, mint a partnerek listája: aki
 * nincs szerviz jelöléssel vagy nincs rövidítése, az ide nem kerül be, mert a
 * lapját nem lehetne lezárni.
 */
export interface WorksheetSelectablePartner {
  /** A munkalapé, nem a partneré: a szűrő ezt küldi. */
  customerId: string;
  name: string;
  partnerCode: string;
}

export function listSelectableWorksheetPartners() {
  return apiRequest<{ items: WorksheetSelectablePartner[] }>(
    `${BASE}/selectable-partners`,
  );
}

export function listWorksheets({
  page = 1,
  pageSize = 25,
  search = "",
  assigneeId,
  customerId,
  status,
}: WorksheetListParams = {}) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search.trim()) query.set("search", search.trim());
  if (assigneeId) query.set("assigneeId", assigneeId);
  if (customerId) query.set("customerId", customerId);
  if (status) query.set("status", status);
  return apiRequest<WorksheetListResponse>(`${BASE}?${query}`);
}

export function getWorksheet(id: string) {
  return apiRequest<WorksheetDetail>(`${BASE}/${encodeURIComponent(id)}`);
}

/**
 * A PARTNER HELYSZÍNEI (alegységei), a munkalap oldaláról nézve.
 *
 * NEM a `partners.ts` `listPartnerUnits` hívása: az a PARTNER azonosítójára
 * megy, a munkalap viszont `customerId` szerint gondolkodik, és a kettő nem
 * ugyanaz. A webes szerkesztő is ezt a végpontot hívja.
 *
 * A lista LAPOSAN jön vissza, a fát a `parentId` mezőből lehet felépíteni.
 */
export interface WorksheetDepartment {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
}

export function listWorksheetDepartments(customerId: string) {
  return apiRequest<{ items: WorksheetDepartment[] }>(
    `${BASE}/customers/${encodeURIComponent(customerId)}/departments`,
  );
}

export interface CreateWorksheetInput {
  customerId: string;
  departmentId: string;
  subject: string;
  description?: string;
  /**
   * A HELYSZINI ROGZITES IDEMPOTENCIA-KULCSA, a sor azonositoja.
   *
   * Elhagyhato: terero mellett a felvitel nem all sorba, tehat nincs mit
   * ujrakuldeni. A sorbol indulo kuldes viszont MINDIG viszi, mert ott a
   * halozati hiba utani ujraprobalas a normalis ut.
   */
  clientOperationId?: string;
}

/**
 * ÚJ MUNKALAP A HELYSZÍNRŐL.
 *
 * A válasz a teljes lap, ugyanaz az alak, amit a `getWorksheet` ad -- a
 * képernyő ebből lép tovább a lap adatlapjára, szerver-oldali azonosítóval.
 */
export function createWorksheet(input: CreateWorksheetInput) {
  return apiRequest<WorksheetDetail>(BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * FENYKEP A MUNKALAPHOZ.
 *
 * UGYANAZ AZ ALAK, MINT AZ ESZKOZNEL (`uploadAssetDocuments`): a torzset a
 * kozos `buildAssetDocumentUpload` allitja ossze, mert a szerver mindket
 * vegponton ugyanazt a mezonevet es ugyanazt a darabszam-hatart varja. Ket
 * kulon osszerako ket helyen romlana el.
 */
export async function uploadWorksheetDocuments(
  id: string,
  input: { files: readonly PickedFile[] },
): Promise<{ id: string; fileName: string }[]> {
  const built = buildAssetDocumentUpload({ type: "PHOTO", files: input.files });
  if (!built.ok) throw new Error(built.reason);

  return apiRequest<{ id: string; fileName: string }[]>(
    `${BASE}/${encodeURIComponent(id)}/documents`,
    { method: "POST", body: built.body },
  );
}

/**
 * EGY TETEL HOZZAADASA A PISZKOZATHOZ.
 *
 * SOR-SZINTU MUVELET, NEM TELJES CSERE, es ezt a szerver kommentje is
 * kimondja: egy lapnak TOBB felelose lehet, es a teljes tartalmat cserelo
 * mentes a masik szerelo sorait torolne -- nem versenyhelyzetkent, hanem
 * MINDEN mentesnel.
 *
 * A valasz a TELJES lap, tehat a keperno frissul, es nem kell kulon lekerdezni.
 */
export function addWorksheetLine(
  id: string,
  input: { id: string; description: string; quantity: number; unit: string },
) {
  return apiRequest<WorksheetDetail>(
    `${BASE}/${encodeURIComponent(id)}/lines`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/** Egy tetel torlese a piszkozatrol. A valasz szinten a teljes lap. */
export function removeWorksheetLine(id: string, lineId: string) {
  return apiRequest<WorksheetDetail>(
    `${BASE}/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`,
    { method: "DELETE" },
  );
}

/**
 * A LAP ALAIRASA A HELYSZINEN.
 *
 * A DONTES a `lib/worksheets/worksheet-signature.ts`-ben all (ki ir ala, mikor
 * all ott a gomb, mit kell megadni) -- ez a fuggveny csak elviszi.
 *
 * A valasz a TELJES lap, ugyanaz az alak, mint a `getWorksheet`-nel: a kepernyo
 * ebbol frissul, es nem kell kulon lekerdezni.
 *
 * A `signerName` ITT NEM opcionalis es nem is szamit ki magatol: a hivo adja
 * meg. Egy alapertelmezett ertek ("a bejelentkezett felhasznalo") ebben a
 * fuggvenyben azt jelentene, hogy a webes felulettel kozos szerzodes ket
 * kulonbozo dolgot jelent a ket oldalon.
 */
export function signWorksheet(
  id: string,
  input: {
    decision: "ACCEPTED" | "REJECTED";
    /** CSAK az "egyik sem" agon. Listarol valasztva a szerver adja a nevet. */
    signerName?: string;
    /** A valasztott munkatars. A szerver ebbol szamolja a forrast. */
    signerUserId?: string;
    note: string | null;
  },
) {
  return apiRequest<WorksheetDetail>(`${BASE}/${encodeURIComponent(id)}/sign`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * A MUNKALAP MUNKANAPLOJA.
 *
 * A `canEdit` es az `editRefusal` A SZERVERTOL JON, es a telefon NEM szamolja
 * ujra. A szabaly (a lap keszitoje vagy a jegy letrehozoja szerkeszthet)
 * jogosultsagi szabaly, tehat a szerver a KERESt is elutasitja; ha a telefon
 * kulon szamolna, ket masolat allna ugyanarra, es a ketto elcsuszhatna.
 */
export interface WorksheetEntry {
  id: string;
  body: string;
  /** `null`, ha a szerzo azota torolt kollega. A keperno KIMONDJA. */
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  editRefusal: string | null;
}

export function listWorksheetEntries(id: string) {
  return apiRequest<{ items: WorksheetEntry[] }>(
    `${BASE}/${encodeURIComponent(id)}/entries`,
  );
}

export function addWorksheetEntry(id: string, body: string) {
  return apiRequest<{ items: WorksheetEntry[] }>(
    `${BASE}/${encodeURIComponent(id)}/entries`,
    { method: "POST", body: JSON.stringify({ body }) },
  );
}

/**
 * A valasz a TELJES lista, nem az egy sor: a keperno igy egy korbol frissul, es
 * nem all elo az az allapot, amikor az atirt sor mar uj, a tobbi meg regi.
 */
export function updateWorksheetEntry(
  id: string,
  entryId: string,
  body: string,
) {
  return apiRequest<{ items: WorksheetEntry[] }>(
    `${BASE}/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}`,
    { method: "PATCH", body: JSON.stringify({ body }) },
  );
}

/**
 * AKI ALAIRHATJA EZT A LAPOT: a lap partnerenek nyilvantartott munkatarsai.
 *
 * Az `emptyReason` A SZERVERTOL JON, es nem dísz: ket kulonbozo ok van, es a
 * teendojuk MAS (nincs hozzakotott munkatars kontra a partner torzsadata
 * hianyzik). Egy nema ures lista mind a kettore raillik, es a szerelo egyiket
 * sem tudja megoldani a helyszinen.
 */
export interface WorksheetSignerCandidate {
  id: string;
  name: string;
}

export function listWorksheetSigners(id: string) {
  return apiRequest<{
    items: WorksheetSignerCandidate[];
    emptyReason: string | null;
  }>(`${BASE}/${encodeURIComponent(id)}/signers`);
}
