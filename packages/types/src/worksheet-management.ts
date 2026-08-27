import type { UserRole } from "./auth.js";

export type WorksheetVersionStatus =
  "DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED";

export type WorksheetSignatureDecision = "ACCEPTED" | "REJECTED";

/**
 * A partner rövidítése (`FANK`). A SZÁMBAN MÁR NINCS BENNE (lásd
 * `formatWorksheetNumber`), de a lezárás továbbra is megköveteli: a rövidítés
 * egyediségi kulcs két táblán, és a pótlása egyszeri lépés, amit egy már
 * megírt lap visszamenőleg tesz kétértelművé.
 *
 * Betűvel kezdődik és 2-8 karakter: emberi jelölés, a listákban és a
 * keresésben partnernek kell látszania.
 */
export const WORKSHEET_PARTNER_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/;

/** A részleg kódja (`BIO`): legfeljebb három betű. */
export const WORKSHEET_DEPARTMENT_CODE_PATTERN = /^[A-Z]{1,3}$/;

/**
 * A sorszám alapesetben három jegyű. 999 fölött NEM fordul át, hanem bővül
 * négy jegyre: egy sorozat sem áll meg egy szűk mező miatt.
 */
export const WORKSHEET_SEQUENCE_MIN_DIGITS = 3;

export function formatWorksheetSequence(sequence: number): string {
  return String(sequence).padStart(WORKSHEET_SEQUENCE_MIN_DIGITS, "0");
}

export interface WorksheetNumberParts {
  partnerCode: string;
  departmentCode: string;
  year: number;
  sequence: number;
}

/**
 * A SZÁM NEM HORDOZZA A PARTNER RÖVIDÍTÉSÉT (2026-08-25, tulajdonosi döntés):
 * a lap CÍME már azonosítja a partnert, tehát a számban ismétlés lenne.
 *
 * AMIT EZ AZ EGYEDISÉGRŐL JELENT: az egységek kódja csak PARTNEREN BELÜL
 * egyedi, tehát a szám egyediségét nem a kód adja, hanem a SOROZAT -- egy
 * számláló évenként, az egész cégre (`WorksheetYearSequence`). Ha a számláló
 * partnerenként futna, két partner `BIO` egysége ugyanabban az évben ugyanazt
 * a számot kapná.
 *
 * A KORÁBBI LAPOK SZÁMA VÁLTOZATLAN, tehát a sorozatban van egy pont, ahol az
 * alak megváltozik. Itt NEM kell jelölés, mint az eszközszámnál: a partner tag
 * ELTŰNÉSE maga a jel. Aki régi lapot keres, a régi alakot fogja látni, és a
 * két alak nem tud ütközni.
 */
export function formatWorksheetNumber(parts: WorksheetNumberParts): string {
  const { departmentCode, year, sequence } = parts;
  return `${departmentCode}-${year}-${formatWorksheetSequence(sequence)}`;
}

/**
 * A verzió a számhoz kötött külön tag, nem új szám: `BIO-2026-001/2`.
 * Az első verzió a szám maga, per-jel nélkül.
 */
export function formatWorksheetVersionLabel(
  worksheetNumber: string | null,
  version: number,
): string | null {
  if (!worksheetNumber) return null;
  return version <= 1 ? worksheetNumber : `${worksheetNumber}/${version}`;
}

export interface WorksheetCustomerSummary {
  id: string;
  customerNumber: string;
  displayName: string;
  /** `null`, amíg a partner-rövidítés nincs felvive - ilyen vevőhöz nem zárható le munkalap. */
  worksheetPartnerCode: string | null;
}

/**
 * A partner alegysége: ugyanaz az entitás adja a szám első tagját
 * (`code`) és a lapon megjelenő szöveget (`name`). Nem két fogalom.
 */
export interface WorksheetDepartmentSummary {
  id: string;
  /**
   * A FA SZULOJE, `null` a legfelso szinten.
   *
   * A helyszinek tobb szinten allhatnak (Fank > Biodom > Nagy fokamedence), es
   * a lista LAPOSAN jon vissza: a fat a hivo epiti fel ebbol a mezobol. Igy egy
   * uj szint nem valtoztat vegpontot, es a lista egyetlen kereskedesbol jon.
   */
  parentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
}

export interface WorksheetDepartmentListResponse {
  items: WorksheetDepartmentSummary[];
}

export interface CreateWorksheetDepartmentInput {
  /**
   * A szulo helyszin, ha van. Hianyzo ertek = a fa legfelso szintje.
   *
   * SZANDEKOSAN NEM KOTELEZO: a mezo bevezetese elott keszult urlapok
   * valtozatlanul atmennek, es a mai lapos lista a fa elso szintje marad.
   */
  parentId?: string;
  code: string;
  name: string;
}

/**
 * A munkalap felelőse: aki a munkát végzi. Nem azonos azzal, aki a lapot
 * felvette (`createdByName`) - az iroda nyit lapot a szerelőnek.
 */
export interface WorksheetAssignee {
  userId: string;
  /** A felületre szánt név: a becenév, ha van (lásd `personDisplayName`). */
  name: string;
  assignedAt: string;
}

/**
 * Aki felelősnek választható. A lista szűkebb, mint a felhasználók listája:
 * csak aktív kolléga kerülhet rá, és csak az, akinek a szerepköre engedi a
 * munkalap írását - felelőst rendelni valakihez, aki utána nem tudja
 * szerkeszteni a lapot, néma zsákutca.
 */
/**
 * A partner a munkalap választójában. A `customerId` az az azonosító, amit a
 * munkalap ténylegesen tárol: a szerviz partner munkalapjait egy saját vevő-sor
 * hordozza (lásd `Supplier.customerId`), és a lap, az alegység meg a szám is
 * arra épül. A választó tehát partnert MUTAT és vevő-azonosítót KÜLD.
 */
export interface WorksheetSelectablePartner {
  /** A munkalapé, nem a partneré: ezt küldi a felvitel. */
  customerId: string;
  name: string;
  /** A partner rövidítése, a választóban megjelenítve. A számban már nincs
   * benne, de kód nélküli partner ide nem kerül be: a nélküle megnyitott lapot
   * nem lehetne lezárni. */
  partnerCode: string;
}

export interface WorksheetSelectablePartnerListResponse {
  items: WorksheetSelectablePartner[];
}

export interface WorksheetAssignableUser {
  id: string;
  name: string;
  role: UserRole;
}

export interface WorksheetAssignableUserListResponse {
  items: WorksheetAssignableUser[];
}

/**
 * A felelősök teljes listája, nem egy hozzáadás: a beküldött lista a lap
 * felelősei, a hiányzók lekerülnek. Üres lista megengedett - egy tévesen
 * kiosztott lapot vissza kell tudni venni.
 */
export interface SetWorksheetAssigneesInput {
  userIds: string[];
}

export interface WorksheetLineDetail {
  id: string;
  position: number;
  description: string;
  /** Kiegészítő sor, ma jellemzően gépazonosító. */
  detail: string | null;
  assetId: string | null;
  assetNumber: string | null;
  quantity: string;
  unit: string;
  unitNet: string;
  vatRatePercent: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
}

export interface WorksheetLineInput {
  description: string;
  detail?: string | null;
  assetId?: string | null;
  quantity: number;
  unit: string;
  unitNet: number;
  vatRatePercent: number;
}

export interface WorksheetSignatureDetail {
  decision: WorksheetSignatureDecision;
  signerName: string;
  signedByName: string | null;
  signedAt: string;
  note: string | null;
}

export interface WorksheetVersionSummary {
  id: string;
  version: number;
  /** `BIO-2026-001/2`, illetve `null` amíg a lap piszkozat. */
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
  /**
   * Az alegység neve, ahogy ennek a verziónak a kiírásakor szólt. A
   * felvitelkor nem küldhető: a munkalap alegységéből másolódik, hogy egy
   * későbbi átnevezés ne írja át a már lezárt lapot.
   */
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
  numberYear: number | null;
  sequence: number | null;
  customer: WorksheetCustomerSummary;
  department: WorksheetDepartmentSummary;
  createdByName: string | null;
  /**
   * A lap felelősei. A munkalap azonosságához tartozik, nem a verzióhoz:
   * lezárt lapon is javítható, és nem jelenik meg a verzió-eltérésben.
   */
  assignees: WorksheetAssignee[];
  createdAt: string;
  updatedAt: string;
  /**
   * A lap, aminek ez a folytatása, és amit ebből folytattak.
   *
   * Egy aláírt munkalap végleges: a munka folytatása új lap. Mindkét irány
   * szerepel, mert egy lánc, aminek csak az egyik vége ismeri a másikat, a
   * másik végéről nézve nem lánc: aki a régi lapot nyitja meg, ugyanúgy tudni
   * akarja, hol folytatódott.
   */
  continues: WorksheetChainLink | null;
  continuedBy: WorksheetChainLink[];
  /** A legmagasabb sorszámú verzió: ez a lap mai állapota. */
  currentVersion: WorksheetVersionDetail;
  /** Minden verzió, a legújabbtól visszafelé. A lezártak változatlanok. */
  versions: WorksheetVersionSummary[];
}

export interface WorksheetListItem {
  id: string;
  number: string | null;
  label: string | null;
  customerName: string;
  departmentCode: string;
  subject: string;
  status: WorksheetVersionStatus;
  version: number;
  versionCount: number;
  grossAmount: string;
  /** A felelősök neve, ahogy a listán megjelenik. Üres, ha még nincs kiosztva. */
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

export interface WorksheetContentInput {
  subject: string;
  description?: string | null;
  issueDate?: string | null;
  fulfillmentDate?: string | null;
  dueDate?: string | null;
  lines: WorksheetLineInput[];
}

export interface CreateWorksheetInput extends WorksheetContentInput {
  customerId: string;
  departmentId: string;
}

export type UpdateWorksheetDraftInput = WorksheetContentInput;

/**
 * Lezárt munkalap módosítása. Nem írja felül a lezárt verziót, hanem újat
 * hoz létre; az indoklás ezért kötelező és nem lehet üres.
 */
export interface AmendWorksheetInput extends WorksheetContentInput {
  changeReason: string;
}

export interface SignWorksheetVersionInput {
  decision: WorksheetSignatureDecision;
  signerName: string;
  note?: string | null;
}

export interface WorksheetFieldChange {
  /** Gépi mezőnév (`subject`, `line.3.quantity`). */
  field: string;
  /** Magyar mezőnév a felületnek. */
  label: string;
  previous: string | null;
  current: string | null;
}

/** Két verzió mezőnkénti eltérése: ki, mikor, miért, és mi változott. */
export interface WorksheetVersionDiff {
  worksheetId: string;
  fromVersion: number;
  toVersion: number;
  changeReason: string | null;
  changedByName: string | null;
  changedAt: string | null;
  changes: WorksheetFieldChange[];
}
