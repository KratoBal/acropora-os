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
  /**
   * A TELJES UT, a gyokertol lefele -- CSAK az adatlapon toltjuk ki.
   *
   * A kod es a nev csak TESTVEREK kozott egyedi, tehat a level neve onmagaban
   * nem mondja meg, melyik agrol van szo. A LISTAKON ez nem all elo (ott a
   * valaszto epiti a fat a `parentId` mezobol), az ADATLAPON viszont egyetlen
   * sor all, es annak magaban kell megallnia.
   *
   * ELHAGYHATO, es ez szandekos: a mezot a meglevo hivok nem ismerik, es a
   * hianya nem hiba -- a felulet ilyenkor a rovid nevre esik vissza.
   */
  path?: string[];
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
 * Egy MEGLEVO alegyseg szerkesztese.
 *
 * SZANDEKOSAN CSAK KET MEZO, es ez a tulajdonos dontese (Balazs, 2026-09-02
 * 20:29, Discord): "csak a nevet lehessen atirni menjen az archivalassal".
 *
 * AMI KIMARAD, ES MIERT NEM FELEDEKENYSEG:
 * - a `code` a MUNKALAPSZAM ELSO TAGJA (`formatWorksheetNumber`). A mar kiadott
 *   szamok tarolva allnak a lapon, tehat egy kesobbi atiras NEM irna at oket --
 *   de ugyanaz az egyseg attol kezdve mas elotagu lapokat adna, es egy partner
 *   papirjain ket kod futna idoben.
 * - a `parentId` (athelyezes) visszamenoleg irna at, hol allt egy eszkoz, es
 *   elobb el kell donteni, mit mutassanak a regi munkalapok.
 *
 * Mindketto KULON kor, nem ennek a bovitese.
 */
export interface UpdateWorksheetDepartmentInput {
  /** Az uj nev. Hianyzo ertek = a nev valtozatlan. */
  name?: string;
  /**
   * Aktiv-e. `false` = archivalt.
   *
   * TORLES NINCS, ES NEM IS LESZ: a szulo- es a munkalap-relacion `Restrict`
   * all, tehat egy hasznalatban levo helyszin torlese az adatbazisban is
   * elhasalna. Az archivalas nem enyhebb valtozat, hanem az EGYETLEN alak.
   */
  isActive?: boolean;
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
  /**
   * AZ ÜGYFÉL SAJÁT ESZKÖZKÓDJA, ÉLŐ HIVATKOZÁSSAL.
   *
   * Nem másolat a soron: olvasáskor jön az eszközről, ugyanúgy, mint az
   * `assetNumber`. A kód a funkciót azonosítja, nem a darabot, tehát nem
   * változik; ahol viszont mégis (elgépelés javítása), ott a javítás
   * visszamenőleg a már aláírt lapokon is megjelenik. Ez tudatos: ugyanaz a
   * funkció mindenhol ugyanazzal a kóddal látszik.
   *
   * A verzió `unitName` mezője ezzel szemben MÁSOLAT saját oszlopban, mert az
   * alegység neve változik. A határvonal a mező változékonysága, nem az, hogy
   * a lap le van-e zárva.
   */
  inventoryNumber: string | null;
  quantity: string;
  unit: string;
  /** A tétel fajtája. Ez dönti el, beleszámít-e az összesített munkaórába. */
  kind: WorksheetLineKindValue;
  /** Hányan dolgoztak a tételen. A séma alapértelmezése és a hiány is 1. */
  workerCount: number;
  /**
   * A TÉTEL MUNKAÓRÁJA, MÁR KISZÁMOLVA: `quantity * workerCount`, de csak
   * `LABOR` fajtánál -- egyébként `"0"`.
   *
   * MIÉRT SZÁMOLVA MEGY, ÉS NEM A FELÜLETEN SZOROZZUK: két felület (web és
   * telefon) ugyanazt a szabályt két helyen mondaná ki, és a kettő elcsúszása
   * néma lenne -- a lapon két különböző összeg állna ugyanarra a munkára.
   */
  laborHours: string;
  /**
   * AZ ÁR ÉS A BELŐLE SZÁMOLT ÖSSZEGEK HIÁNYOZHATNAK.
   *
   * A szerelő a helyszínen azt rögzíti, mit csinált és mennyit; az árat az
   * iroda adja meg. A `null` itt NEM ugyanaz, mint a `"0"`: a nulla egy
   * elvégzett, ingyenes munka, a `null` az, hogy még nincs kitöltve. A kettő
   * összemosása azt a csendet hozná vissza, amit ez a megkülönböztetés
   * elkerül - egy nulla forintos tétel a lapon ÉRTÉKNEK látszik.
   *
   * AZ ÁR HIÁNYA 2026-09-17 ÓTA NEM AKADÁLY a lezárásnál: Balázs döntése
   * szerint a nettó, bruttó és áfa mezők sehol nem jelennek meg, és ezért a
   * lezárási feltétel is kikerült. Az adat megmarad, ár továbbra is
   * rendelhető -- csak a hiánya nem állít meg semmit.
   */
  unitNet: string | null;
  vatRatePercent: string | null;
  netAmount: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
}

/**
 * EGY MUNKALAP-TÉTEL FAJTÁJA.
 *
 * A `LABOR` az, ami beleszámít az összesített munkaórába -- NEM a `unit`
 * szövege, mert az szabad szöveg (db, óra, km, alkalom), és egy elgépelt "ora"
 * csendben kimaradna az összegből.
 *
 * MIÉRT ÁLL ITT LITERÁL-UNIÓ ÉS NEM A PRISMA-ENUM: ez a csomag szándékosan nem
 * függ az adatbázistól, tehát a két oldal ugyanazt a halmazt KÜLÖN mondja ki.
 * A szerver oldalán a `WORKSHEET_LINE_KINDS` lista `satisfies
 * Record<WorksheetLineKind, true>` alakban a sémához van kötve, tehát ha a séma
 * bővül, OTT fordítási hiba lesz -- ez a sor az, ami utána átvezetésre vár.
 */
export type WorksheetLineKindValue = "LABOR" | "OTHER";

export interface WorksheetLineInput {
  description: string;
  detail?: string | null;
  assetId?: string | null;
  quantity: number;
  unit: string;
  /**
   * A TÉTEL FAJTÁJA, ELHAGYHATÓ. A hiánya `OTHER` -- ugyanaz, mint a séma
   * alapértelmezése --, tehát a mai hívók változatlanul küldhetnek tételt.
   */
  kind?: WorksheetLineKindValue;
  /** Hányan dolgoztak rajta. Elhagyható, a hiánya 1. Legalább 1. */
  workerCount?: number;
  /**
   * AZ ÁR ELHAGYHATÓ: a helyszínen rögzített tétel ár nélkül keletkezik, és az
   * irodában egészül ki. A hiány a `undefined`, NEM a nulla - egy nulla
   * forintos tétel a lapon értéknek látszik, nem hiánynak.
   *
   * AZ ÁR HIÁNYA 2026-09-17 ÓTA NEM AKADÁLY a lezárásnál: Balázs döntése
   * szerint a nettó, bruttó és áfa mezők sehol nem jelennek meg, és ezért a
   * lezárási feltétel is kikerült. Az adat megmarad, ár továbbra is
   * rendelhető -- csak a hiánya nem állít meg semmit.
   */
  unitNet?: number;
  vatRatePercent?: number;
}

export interface WorksheetSignatureDetail {
  decision: WorksheetSignatureDecision;
  /**
   * AZ ALAIRO NEVE. 2026-09-04 ota az UGYFEL embere, mindket feluleten.
   *
   * Korabban a mobil a SZERELO nevet kuldte ide, a web az ugyfelet -- ugyanaz a
   * mezo, ket jelentes. A `signerNotice` valasztja szet oket.
   */
  signerName: string;
  /** KI ROGZITETTE (a telefont kezelo kollega). Nem az alairo. */
  signedByName: string | null;
  signedAt: string;
  note: string | null;
  /**
   * MIT MOND A LAP AZ ALAIRASROL -- `null`, ha nincs mit mondani.
   *
   * HAROM ALLAPOT, es a harmadik a fontos: listarol valasztott alairo (nincs
   * mondat), a szerelo altal BEIRT nev (a lap kimondja, hogy nem a partner
   * munkatarsa), es a 2026-09-04 ELOTTI sorok (azokrol nem allitunk semmit,
   * mert nem eldontheto).
   *
   * A MONDAT A SZERVERTOL JON, es nem a kepernyoktol: ket felulet olvassa, a
   * mobil nem tudja importalni a munkater csomagjait, es ket masolat epp a
   * JELZESNEL csuszna el.
   */
  signerNotice: string | null;
}

/**
 * AKI ALAIRHATJA A LAPOT: a lap partnerenek egy nyilvantartott munkatarsa.
 *
 * A halmaz forrasa a `User.customerId` -- azok a fiokok, amiket a lap vevojehez
 * kotottek (a felhasznalo adatlapjan, "Vevő nevében lép be").
 */
export interface WorksheetSignerCandidate {
  id: string;
  name: string;
}

export interface WorksheetSignerListResponse {
  items: WorksheetSignerCandidate[];
  /**
   * MIERT URES A LISTA -- `null`, ha nem ures.
   *
   * KET KULONBOZO OK VAN, ES A TEENDOJUK MAS: nincs hozzakotott munkatars
   * (vigyenek fel egyet), vagy a lap partnere nem valaszthato szervizpartner
   * (torzsadat-hiany). Egy nema ures lista mind a kettore raillik, es a szerelo
   * EGYIKET SEM tudja megoldani a helyszinen.
   */
  emptyReason: string | null;
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
  /**
   * A LAP ÖSSZESÍTETT MUNKAÓRÁJA: a LABOR fajtájú tételek `quantity *
   * workerCount` értékeinek összege, soronként kerekítve.
   *
   * Balázs kérése és egyben a mérce (2026-09-17): "ha egy tétel 0,5 óra de
   * ketten dolgoztak rajta akkor az 1 óra és ha három ilyen tétel van akkor
   * összesen 3 óra".
   */
  laborHours: string;
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

/**
 * EGY BEJEGYZES A MUNKALAP MUNKANAPLOJABAN.
 *
 * Balazs kerese, 2026-09-03: a szerelo szabadszavasan beirja, mit csinalt, es a
 * rendszer eltarolja, KI irta es MIKOR.
 *
 * A `canEdit` A SZERVERTOL JON, ES NEM KENYELEM. A szabaly (a lap keszitoje
 * vagy a jegy letrehozoja szerkeszthet) JOGOSULTSAGI szabaly, tehat a szerver
 * elutasitja az irast is. Ha a felulet ujraszamolna, ket masolat allna
 * ugyanarra, es a mobil amugy sem tudna importalni a kozos fuggvenyt (az Expo
 * app szandekosan nem huzza be a munkater csomagjait). Igy a szabaly EGY
 * helyen all, es a valasz megmondja az eredmenyet.
 */
export interface WorksheetEntryDetail {
  id: string;
  body: string;
  /**
   * A SZERZO NEVE, vagy `null`, ha ismeretlen (azota torolt kollega).
   *
   * A `null` NEM hianyzo adat, hanem allapot: a bejegyzes megmarad, a szerzo
   * neve nelkul. A felulet ezt KIMONDJA, nem rejti el a sort.
   */
  authorName: string | null;
  createdAt: string;
  /**
   * MIKOR IRTAK AT UTOLJARA. A keletkezessel EGYENLO, amig nem szerkesztettek:
   * a ketto osszevetesebol latszik, hogy a bejegyzes eredeti-e.
   */
  updatedAt: string;
  /** Szerkesztheti-e EZ a kero. A szabaly a szerveren all. */
  canEdit: boolean;
  /**
   * MIERT NEM, ha nem szerkesztheti. `null`, ha szerkesztheti.
   *
   * Ket kulon eset van, es a teendojuk MAS: van kit megkerni, vagy senki nem
   * szerkesztheti (a lap keszitoje es a jegy nyitoja is ismeretlen). Egy
   * magyarazat nelkul hianyzo gomb ugy nez ki, mint hiba a programban.
   */
  editRefusal: string | null;
}

export interface WorksheetEntryListResponse {
  items: WorksheetEntryDetail[];
}

/**
 * EGY ESZKOZ, AMIROL A MUNKALAP SZOL.
 *
 * ALAKRA AZONOS A `ServiceJobAssetLink`-KEL, es ez nem veletlen egyezes: a
 * hibajegy es a munkalap ugyanannak a munkanak a ket oldala, a csatolt eszkoz
 * pedig ugyanaz a fogalom. KULON TIPUS megis, ugyanabbol az okbol, amiert a ket
 * felelos-tipus is kulon all: a ketto KULON VALASZBAN utazik, es egy kozos
 * tipus a ket vegpontot egymashoz kotne -- egy munkalap-oldali mezo-bovites a
 * jegy valaszat is elmozditana, anelkul hogy barki kerte volna.
 */
export interface WorksheetAssetLink {
  id: string;
  assetId: string;
  assetNumber: string;
  assetName: string;
  attachedAt: string;
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
   * A HIBAJEGY, AMI MÖGÖTT EZ A LAP ÁLL. `null`, amíg nincs.
   *
   * NEM HIÁNY, HANEM AZ EGYIK RENDES ÚT: a lap keletkezhet hibajegy nélkül
   * (karbantartás közben derül ki, hogy valami elromlott), és a jegy utólag
   * születik meg. A részletlapnak ezért mindkét állapotot ki kell tudnia
   * mondani - és a SZÁM is kell hozzá, nem csak az azonosító: egy azonosító
   * nem mond semmit annak, aki nézi.
   */
  serviceJob: { id: string; jobNumber: string } | null;
  /**
   * A lap felelősei. A munkalap azonosságához tartozik, nem a verzióhoz:
   * lezárt lapon is javítható, és nem jelenik meg a verzió-eltérésben.
   */
  assignees: WorksheetAssignee[];
  /**
   * AZ ESZKOZOK, AMIKROL A LAP SZOL.
   *
   * UGYANOTT AL, AHOL A FELELOSOK: a MUNKALAP azonossagahoz tartozik, nem a
   * verziohoz. A kapcsolotabla (`WorksheetAsset`) a lapra mutat, nem a
   * verziora, tehat lezart lapon is javithato, es a verzio-eltéresben nem
   * jelenik meg.
   *
   * MIERT KERULT BE (merve 2026-09-16): a sorokat 2026-09-15 ota IRJUK, es
   * SEMMI nem olvasta vissza -- se a reszletlap, se a felulet. Aki felvitelkor
   * eszkozt csatolt, azt sehol nem latta viszont.
   *
   * URES TOMB ERVENYES VALASZ, nem hiba: a lap keletkezhet eszkoz megnevezese
   * nelkul.
   */
  assets: WorksheetAssetLink[];
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
  /**
   * A HELYSZIN TELJES UTJA A LISTAN IS, a gyokertol lefele.
   *
   * EZ A MEZO EGY SAJAT KORABBI ALLITASOMAT VONJA VISSZA. A `path` mezo mellett
   * (adatlap) ez all: "A LISTAKON ez nem all elo (ott a valaszto epiti a fat a
   * `parentId` mezobol)". Igaz volt a VALASZTORA, de a munkalap-lista nem
   * valaszto: ott egyetlen sor all a partner alatt, es annak ugyanugy magaban
   * kell megallnia, mint az adatlapon. Balazs 2026-09-16-an fotozta le, hogy
   * ott `NMD` all magaban.
   *
   * `null`, ha az utat nem tudjuk felepiteni. URES TOMB SOHA: az azt allitana,
   * hogy az ut ismert es nulla hosszu. A felulet ilyenkor a kodra esik vissza.
   */
  departmentPath: string[] | null;
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
  /**
   * ALLAPOTONKENTI DARABSZAM, A LISTA SAJAT VALASZAN.
   *
   * Az allapot a LEGUTOLSO VERZIOE, ugyanugy, mint a lista soraiban -- tehat a
   * csempek es a sorok ugyanazt a szabalyt kovetik. Ket kulon hivasbol a ketto
   * elcsuszhatna, es a felulet a talalatok folott mas szamot mutatna.
   *
   * MINDEN ALLAPOT SZEREPEL, A NULLAS IS: egy hianyzo kulcs a kliensen
   * pontosan ugy nez ki, mint a nulla, csak eppen nem az.
   */
  counts: Record<WorksheetVersionStatus, number>;
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
  /**
   * A lap felelősei, MÁR A FELVITELKOR.
   *
   * Elhagyható: a kiosztás a részletek oldalon később is elvégezhető, és egy
   * lapot attól még fel kell tudni vinni, hogy még nem dőlt el, ki megy ki.
   * Ha viszont meg van adva, a felvitellel EGY tranzakcióban íródik: egy
   * létrejött, de kiosztatlanul maradt lap némán elveszne a szerelő listájáról,
   * és a felvivő azt hinné, kiosztotta.
   */
  assigneeIds?: string[];
  /**
   * A LAP ALTAL ERINTETT ESZKOZOK, MAR A FELVITELKOR.
   *
   * Balazs kerese (2026-09-15): a hibajegynel kivalasztott eszkozok jelenjenek
   * meg a belole nyitott lapon is. A jegybol nyitott lap ezekkel INDUL --
   * ELOTOLTESKENT, nem kotesként: a lapon levehetok es tovabbiak felvehetok.
   *
   * Elhagyhato: a lap keletkezhet eszkoz megnevezese nelkul. Ha meg van adva, a
   * felvitellel EGY tranzakcioban irodik -- ugyanaz az indok, mint a
   * feleloskenel: egy kulon hivas elbukhatna, es epp az a lap keletkezne,
   * amirol a szerelo azt hinne, hogy tudja, mit kell megneznie.
   *
   * A SZERVER A HELYSZINRE ELLENORIZ (`assets-in-department.ts`): a megnevezett
   * eszkozoknek a lap helyszinenek RESZFAJA alatt kell allniuk, kulonben a
   * felvitel 400-zal all meg.
   */
  assetIds?: string[];
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
  /**
   * A BEIRT NEV -- CSAK az "egyik sem" agon.
   *
   * ELHAGYHATOVA VALT 2026-09-04-en: ha van `signerUserId`, a nevet a SZERVER
   * veszi a valasztott sorbol, es ezt a mezot figyelmen kivul hagyja. Ha mind a
   * ketto ott allna, a szerver ket kulonbozo allitast kapna arrol, ki irta ala.
   */
  signerName?: string;
  /**
   * A VALASZTOTT MUNKATARS a lap partnerenek nyilvantartott emberei kozul.
   *
   * A JELENLETE DONTI EL a szerveren, melyik agon ment az alairas: a
   * `signerSource` erteket a szerver ebbol szamolja, nem a klienstol kerdezi.
   * Egy klienstol jovo "forras" mezo ellentmondhatna a valasztott szemelynek,
   * es akkor a lapon egy HAMIS jelzes allna.
   */
  signerUserId?: string;
  /**
   * AZ ALAIROKOD, amit az UGYFEL ir be. CSAK a listarol valasztott agon kell.
   *
   * Az "egyik sem" agon nincs, es ez NEM kiskapu: ott a lap MAGA MONDJA KI,
   * hogy nem a partner nyilvantartott munkatarsa irta ala.
   */
  signatureCode?: string;
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

/**
 * EGY LAP, AMI HIBAJEGY ALA TEHETO.
 *
 * A `number` `null`, amig a lap piszkozat - es a valaszto epp ettol nem hagyja
 * ki: a meg szamozatlan, helyszinen felvett lap az, amiert ez a lista letezik.
 */
export interface WorksheetAttachableItem {
  id: string;
  number: string | null;
  subject: string;
  status: WorksheetVersionStatus | null;
  customerName: string;
  createdAt: string;
  handedOverAt: string | null;
}

export interface WorksheetAttachableListResponse {
  items: WorksheetAttachableItem[];
}

/**
 * A MUNKALAP CSATOLMÁNYÁNAK FAJTÁJA.
 *
 * A szerver alapértelmezése a `PHOTO`: a helyszínről érkező kép az, ami a lapra
 * kerül. A többi az irodából jön.
 */
export type WorksheetDocumentType =
  "PHOTO" | "INVOICE" | "WARRANTY" | "MANUAL" | "OTHER";

/**
 * EGY CSATOLMÁNY A MUNKALAPON -- a leíró adat, a bájtok nélkül.
 *
 * A `contentType` LITERÁL UNIÓ, és ez nem szűkítés: a tárolt érték a
 * `canonicalMimetypeFor` kimenete (`uploaded-file-type.ts`), tehát a szerver
 * MINDIG ezek egyikét írja be, függetlenül attól, mit jelentett be a kliens.
 * Ugyanaz az alak, mint a `ServiceJobDocumentSummary`-n, és ugyanabból az okból.
 */
export interface WorksheetDocumentSummary {
  id: string;
  type: WorksheetDocumentType;
  fileName: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  sha256: string;
  /**
   * A CSATOLMÁNY FELIRATA -- MIT LÁTUNK A KÉPEN. `null`, ha nincs.
   *
   * A hiány EGYFÉLE alakban áll (`null`, nem üres string), ugyanúgy, mint a
   * hibajegynél: különben a „nincs felirat" és a „szándékosan üres felirat"
   * megkülönböztethetetlen lenne.
   */
  caption: string | null;
  createdAt: string;
}

export interface WorksheetDocumentListResponse {
  items: WorksheetDocumentSummary[];
}
