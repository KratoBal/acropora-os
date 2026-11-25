import type {
  ServiceJobKind,
  ServiceJobPartnerStatus,
  ServiceJobStatusValue,
} from "./service-job-management.js";
import type { WorksheetVersionStatus } from "./worksheet-management.js";

/**
 * A KÖZÖS ÁLLAPOT-LISTA A HIBAJEGYRE ÉS A MUNKALAPRA (kártya 7f23785c).
 *
 * Balázs döntése, 2026-11-25 18:08:02 UTC (Eldöntendő szál, msg
 * 1575211476678082741): „1 legyen kozos". Öt állapot: Új, Folyamatban, Vár
 * valamire, Elkészült, Lezárt. A jelentés (emlék 890, 2026-08-26): Elkészült =
 * a munka kész, aláírásra vagy átadásra vár; Lezárt = aláírva és átadva. A
 * meghiúsult ügy is Lezárt, „meghiúsult" okkal.
 *
 * LEVEZETETT NÉZET, NEM TÁROLT ÉRTÉK. Az adatbázis enumja (`ServiceJobStatus`,
 * `WorksheetVersionStatus`) és a `ServiceJobEvent` előzmény érintetlen: a régi
 * mobil buildek a nyolc értéket kézzel másolva hordják, és OTA-t nem kapnak.
 * A közös állapot a tárolt értékből és a munkalapok tényeiből számolódik, ezen
 * a fájlon, minden felületnek ugyanígy. Terv:
 * `agents/nautilus/meresek/kozos-allapot-terv-2026-11-25.md` (barracuda APPROVE).
 */
export type CommonServiceStatus =
  "NEW" | "IN_PROGRESS" | "WAITING" | "DONE" | "CLOSED";

/**
 * AZ OK, AMI A JELVÉNY MELLETT ÁLL (picasso felületi átnézése, terv 9. pont):
 * a Vár valamire, az Elkészült és a Lezárt nem áll egyedül.
 *
 *   PARTS, CUSTOMER      Vár valamire: kin vagy min múlik (a tárolt WAITING_*)
 *   AWAITING_SIGNATURE   Elkészült: van aláíratlan lap
 *   AWAITING_HANDOVER    Elkészült: minden lap aláírva, az átadás nincs rögzítve
 *   READY_TO_CLOSE       Elkészült: a lezárás kapuja teljesül, a lépés hiányzik
 *   CANCELLED            Lezárt: meghiúsult
 *   REJECTED             Folyamatban: a munkalapot elutasították, a javítás nálunk
 *
 * A sima Új, Folyamatban és a teljesített Lezárt oka `null`.
 */
export type CommonServiceStatusReason =
  | "PARTS"
  | "CUSTOMER"
  | "AWAITING_SIGNATURE"
  | "AWAITING_HANDOVER"
  | "READY_TO_CLOSE"
  | "CANCELLED"
  | "REJECTED";

export interface CommonServiceState {
  status: CommonServiceStatus;
  reason: CommonServiceStatusReason | null;
}

/**
 * Egy munkalap annyi ténye, amennyi a hibajegy Elkészült levezetéséhez kell.
 *
 * SZÁNDÉKOSAN UGYANAZ AZ ALAK, mint a lezárás kapujáé
 * (`apps/api/src/common/worksheet-signature-gate.ts`,
 * `TicketWorksheetSignatureState`): a levezetett Elkészült és a kapu ugyanabból
 * a tényből dolgozik, és a hívó ugyanazt az olvasást adja át mindkettőnek. A
 * rejtett lap itt sem mentesül, ahogy a kapunál sem: a hívó a jegy ÖSSZES
 * lapját adja.
 */
export interface CommonJobWorksheetFacts {
  /** A legutolsó verzió állapota; `null`, ha a lapnak még nincs verziója. */
  currentVersionStatus: WorksheetVersionStatus | null;
  /** Rögzítette-e valaki az átadást (`handedOverAt`). */
  handedOver: boolean;
}

/**
 * A HIBAJEGY KÖZÖS ÁLLAPOTA.
 *
 * Az ELKÉSZÜLT CSAK AZ `IN_PROGRESS`-RE VEZETŐDIK LE (terv 3. és 8/a-b pont):
 * van munkalapja, és mindegyiknek a legutolsó verziója AWAITING_SIGNATURE vagy
 * SIGNED. Egy WAITING_* jegy kész lapokkal is Vár valamire marad (a várakozás
 * oka erősebb jel), és egy NEW jegy sem lesz Elkészült: a lezárt lap csatolása
 * a 2. szeletben IN_PROGRESS-be lépteti a jegyet, tehát a tárolt állapot közel
 * marad a látott felirathoz, és NEW alól nem kínálunk Lezárást, amit az
 * átmenet-tábla nem enged.
 *
 * A TRIAGED és a SCHEDULED Folyamatban: a Felmérve lépés kivezetve, az időpont
 * a `scheduledAt` sora, nem állapot.
 */
export function commonJobStatus(
  status: ServiceJobStatusValue,
  worksheets: readonly CommonJobWorksheetFacts[],
  kind: ServiceJobKind = "REPAIR",
): CommonServiceState {
  if (kind === "MAINTENANCE") return commonMaintenanceStatus(worksheets);
  switch (status) {
    case "NEW":
      return { status: "NEW", reason: null };
    case "TRIAGED":
    case "SCHEDULED":
      return { status: "IN_PROGRESS", reason: null };
    case "IN_PROGRESS":
      return (
        doneFromWorksheets(worksheets) ?? {
          status: "IN_PROGRESS",
          reason: null,
        }
      );
    case "WAITING_FOR_PARTS":
      return { status: "WAITING", reason: "PARTS" };
    case "WAITING_FOR_CUSTOMER":
      return { status: "WAITING", reason: "CUSTOMER" };
    case "COMPLETED":
      return { status: "CLOSED", reason: null };
    case "CANCELLED":
      return { status: "CLOSED", reason: "CANCELLED" };
  }
}

/**
 * A KARBANTARTÁSI LAP KÖZÖS ÁLLAPOTA (terv 3. pont): a karbantartás marad
 * állapotgép nélkül, és a mai „Kész / Folyamatban" jelvény szabálya szól a
 * közös szavakkal (`MAINTENANCE_DONE`, Balázs 2026-11-18): Lezárt, ha van
 * munkalapja, és mindegyiknek a legutolsó verziója aláírt; minden más
 * Folyamatban. A tárolt állapotot NEM nézi, ahogy a jelvény sem; Új, Vár
 * valamire és Elkészült nincs. Az átadás itt nem feltétel, mert a jelvényé sem.
 *
 * MIÉRT KÜLÖN ÁG (stage-mérés, 2026-11-25, acrobot 61921): a hibajegy szabálya
 * a karbantartásra 9 Elkészültet és 3 Újat adott ott, ahol a lap ma Kész vagy
 * Folyamatban.
 */
function commonMaintenanceStatus(
  worksheets: readonly CommonJobWorksheetFacts[],
): CommonServiceState {
  const signed =
    worksheets.length > 0 &&
    worksheets.every((sheet) => sheet.currentVersionStatus === "SIGNED");
  return { status: signed ? "CLOSED" : "IN_PROGRESS", reason: null };
}

/**
 * Az IN_PROGRESS jegy Elkészültje, vagy semmi. Munkalap nélkül, illetve ha
 * bármelyik lap piszkozat, elutasított vagy verzió nélküli, a jegy Folyamatban
 * marad.
 *
 * AZ OK SORRENDJE a hátralévő lépésé: amíg van aláíratlan lap, az aláírás a
 * következő teendő; ha mind aláírva, az átadás; ha az is megvan, a jegy
 * lezárható, csak a lépés hiányzik.
 */
function doneFromWorksheets(
  worksheets: readonly CommonJobWorksheetFacts[],
): CommonServiceState | null {
  if (worksheets.length === 0) return null;
  const finished = worksheets.every(
    (sheet) =>
      sheet.currentVersionStatus === "AWAITING_SIGNATURE" ||
      sheet.currentVersionStatus === "SIGNED",
  );
  if (!finished) return null;
  if (worksheets.some((sheet) => sheet.currentVersionStatus !== "SIGNED"))
    return { status: "DONE", reason: "AWAITING_SIGNATURE" };
  if (worksheets.some((sheet) => !sheet.handedOver))
    return { status: "DONE", reason: "AWAITING_HANDOVER" };
  return { status: "DONE", reason: "READY_TO_CLOSE" };
}

/**
 * A MUNKALAP KÖZÖS ÁLLAPOTA (terv 3. pont). A `worksheetDisplayStatus` öt
 * értékét követi, egy különbséggel: az Elutasított nem külön állapot, hanem
 * Folyamatban, „elutasítva" okkal, mert a javítás nálunk van
 * (`worksheet-amendment.ts`). A munkalapnak nincs Vár valamire állapota:
 * aláírásra várni az Elkészült maga.
 */
export function commonWorksheetStatus(
  versionStatus: WorksheetVersionStatus,
  lineCount: number,
): CommonServiceState {
  switch (versionStatus) {
    case "DRAFT":
      return { status: lineCount > 0 ? "IN_PROGRESS" : "NEW", reason: null };
    case "REJECTED":
      return { status: "IN_PROGRESS", reason: "REJECTED" };
    case "AWAITING_SIGNATURE":
      return { status: "DONE", reason: "AWAITING_SIGNATURE" };
    case "SIGNED":
      return { status: "CLOSED", reason: null };
  }
}

/** Az öt állapot neve. A kulcsok sorrendje a folyamat sorrendje (fülek, csempék). */
export const commonServiceStatusLabel: Record<CommonServiceStatus, string> = {
  NEW: "Új",
  IN_PROGRESS: "Folyamatban",
  WAITING: "Vár valamire",
  DONE: "Elkészült",
  CLOSED: "Lezárt",
};

/** Az öt állapot, a folyamat sorrendjében, a feliratok kulcsaiból. */
export const COMMON_SERVICE_STATUSES = Object.keys(
  commonServiceStatusLabel,
) as CommonServiceStatus[];

/** Az ok felirata, kis betűvel: a jelvényben az állapot neve után áll. */
export const commonServiceReasonLabel: Record<
  CommonServiceStatusReason,
  string
> = {
  PARTS: "alkatrészre",
  CUSTOMER: "ügyfélre",
  AWAITING_SIGNATURE: "aláírásra vár",
  AWAITING_HANDOVER: "átadásra vár",
  READY_TO_CLOSE: "lezárható",
  CANCELLED: "meghiúsult",
  REJECTED: "elutasítva",
};

/** A jelvény teljes szövege: „Vár valamire · alkatrészre", „Lezárt · meghiúsult". */
export function commonServiceStateText(state: CommonServiceState): string {
  const label = commonServiceStatusLabel[state.status];
  return state.reason === null
    ? label
    : `${label} · ${commonServiceReasonLabel[state.reason]}`;
}

/**
 * A JELVÉNY SZÍNE. A típus szó szerint kiírva, nem `ServiceTone` importálva:
 * ez a csomag nem függhet a `@acropora/ui`-tól.
 *
 * Az alap a partner-portál mai négy színe (`partnerStatusTone`), mert a
 * partner a közösből rövidít, és így egy jegy a két felületen ugyanolyan
 * színű: Új kék, Folyamatban lila, Elkészült zöld, Lezárt semleges. A Vár
 * valamire a belső lista mai várakozó színe (borostyán). Az ok csak egy
 * esetben színez: az elutasított munkalap piros, ahogy ma is.
 */
export type CommonServiceTone =
  "neutral" | "purple" | "green" | "amber" | "red" | "blue";

const COMMON_SERVICE_STATUS_TONE: Record<
  CommonServiceStatus,
  CommonServiceTone
> = {
  NEW: "blue",
  IN_PROGRESS: "purple",
  WAITING: "amber",
  DONE: "green",
  CLOSED: "neutral",
};

export function commonServiceStateTone(
  state: CommonServiceState,
): CommonServiceTone {
  if (state.reason === "REJECTED") return "red";
  return COMMON_SERVICE_STATUS_TONE[state.status];
}

/**
 * A PARTNER RÖVIDEBB LISTÁJA, A KÖZÖSBŐL (terv 3. és 10. pont). A négy felirat
 * Balázs 2026-08-26-i partner-szava marad (`PARTNER_STATUS_LABELS`); a Vár
 * valamire a partnernek Feldolgozás alatt (az „ügyfélre vár" a teendő-listáján
 * él tovább), a meghiúsult ügy Lezárva.
 *
 * KÉT SZÁNDÉKOS ELTÉRÉS a mai `partnerVisibleStatus`-tól, név szerint a
 * tesztben: a COMPLETED jegy Lezárva lesz (ma Elkészült), és a kész lapú
 * IN_PROGRESS jegy Elkészült (ma Feldolgozás alatt). Ezt a 4. szelet köti be.
 *
 * A MEGHIÚSULT OK NEM VÉSZ EL (acrobot döntése, 2026-11-25, 61894, barracuda
 * észrevétele nyomán, 61891): ma a partner a COMPLETED és a CANCELLED jegyet
 * meg tudja különböztetni, a közösből rövidítve mindkettő Lezárva. A felirat
 * marad Lezárva, de a `closedReason` kimondja, ha a munka nem teljesült, és a
 * partner adatlapja és lista-kártyája ezt második sorként rajzolja.
 */
const PARTNER_FROM_COMMON: Record<
  CommonServiceStatus,
  ServiceJobPartnerStatus
> = {
  NEW: "NEW",
  IN_PROGRESS: "IN_PROGRESS",
  WAITING: "IN_PROGRESS",
  DONE: "COMPLETED",
  CLOSED: "CLOSED",
};

/** Lezárt jegynél a kimenetel a partnernek; ma egy értéke van. */
export type PartnerClosedReason = "CANCELLED";

/** A második sor szövege a partner lapján. */
export const partnerClosedReasonLabel: Record<PartnerClosedReason, string> = {
  CANCELLED: "Nem teljesült",
};

export interface PartnerCommonState {
  status: ServiceJobPartnerStatus;
  /** `CANCELLED`, ha a lezárt jegy meghiúsult; minden más esetben `null`. */
  closedReason: PartnerClosedReason | null;
}

export function partnerStatusFromCommon(
  state: CommonServiceState,
): PartnerCommonState {
  return {
    status: PARTNER_FROM_COMMON[state.status],
    closedReason:
      state.status === "CLOSED" && state.reason === "CANCELLED"
        ? "CANCELLED"
        : null,
  };
}
