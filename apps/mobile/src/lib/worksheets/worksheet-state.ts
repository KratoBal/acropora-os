// RELATÍV ÚT, NEM `@/` (a teszt-fordító nem ismeri az aliast, lásd a `tsconfig.test.json` fejlécét)
import {
  commonStateOf,
  commonStateText,
  type CommonState,
} from "../service-jobs/common-status";
import type { StatusTone } from "../theme/label-styles";
import {
  worksheetDisplayLabel,
  worksheetDisplayStatus,
  worksheetStatusLabel,
  worksheetStatusTone,
  type WorksheetDisplayStatus,
  type WorksheetStatus,
} from "./worksheet-presentation";

/**
 * A MUNKALAP ÁLLAPOTA A TELEFONON A KÖZÖS SZAVAKKAL (kártya 7f23785c, acrobot 62402; a hibajegyé `common-status.ts`, #2981).
 *
 * A lap lista-sora és adatlapja hozza a közös állapotot és az okát (`commonStatus`, `commonReason`; API #2983): azt rajzoljuk ki, az okkal
 * együtt („Elkészült · aláírásra vár", „Folyamatban · elutasítva"). Ahol a válasz nem hozza (régi szerver, a hibajegy alatti lapok sora, az
 * üzenetek kártyája), a megjelenített állapotból (`worksheetDisplayStatus`: a változat-állapot és a tételszám) áll elő ugyanaz a közös állapot
 * az alábbi tábla szerint: a levezetés a mezőkből veszteségmentes, és a közös szótár `commonWorksheetStatus` függvényével ŐRZŐ veti össze
 * (`mobile-common-status-mirror.spec.ts`). Tételszám nélkül (a 2026-10-01 előtti szerver) a mai összevont név áll, nem találgatás.
 */
export const WORKSHEET_DISPLAY_COMMON: Record<
  WorksheetDisplayStatus,
  CommonState
> = {
  NEW: { status: "NEW", reason: null },
  IN_PROGRESS: { status: "IN_PROGRESS", reason: null },
  COMPLETED: { status: "DONE", reason: "AWAITING_SIGNATURE" },
  CLOSED: { status: "CLOSED", reason: null },
  REJECTED: { status: "IN_PROGRESS", reason: "REJECTED" },
};

interface WorksheetStateInput {
  status: string;
  lineCount?: number;
  commonStatus?: string | null;
  commonReason?: string | null;
}

/** A közös állapot: a válasz saját mezői, ennek hiányában a megjelenített állapotból; `null`, ha egyik sem áll rendelkezésre. */
export function worksheetCommonState(
  item: WorksheetStateInput,
): CommonState | null {
  const fromServer = commonStateOf(item);
  if (fromServer) return fromServer;
  if (item.lineCount === undefined) return null;
  if (!Object.hasOwn(worksheetStatusLabel, item.status)) return null;
  return WORKSHEET_DISPLAY_COMMON[
    worksheetDisplayStatus(item.status as WorksheetStatus, item.lineCount)
  ];
}

/** A jelvény szövege: a közös állapot az okkal; közös állapot nélkül a mai felirat (az összevont név, ismeretlen állapotnál a nyers kód). */
export function worksheetStateText(item: WorksheetStateInput): string {
  const common = worksheetCommonState(item);
  if (common) return commonStateText(common);
  return Object.hasOwn(worksheetStatusLabel, item.status)
    ? worksheetDisplayLabel(item.status as WorksheetStatus, item.lineCount)
    : item.status;
}

/**
 * A JELVÉNY SZÍNE a mobil négy tokenjén (a `worksheetStatusTone` indoklása szerint a paletta önálló döntés): az elutasított piros, az Elkészült a
 * pozitív hang (zöld a weben), a Lezárt semleges, a várakozás borostyán, a többi semleges. Közös állapot nélkül a mai szín.
 */
export function worksheetStateTone(item: WorksheetStateInput): StatusTone {
  const common = worksheetCommonState(item);
  if (!common) {
    return Object.hasOwn(worksheetStatusLabel, item.status)
      ? worksheetStatusTone(item.status as WorksheetStatus)
      : "neutral";
  }
  if (common.reason === "REJECTED") return "danger";
  if (common.status === "DONE") return "accent";
  if (common.status === "WAITING") return "warning";
  return "neutral";
}

/** A változat-állapot felirata a telefon belső helyein (`worksheet-presentation.ts`): az aláírt változat „Lezárt". */
export { worksheetVersionLabel } from "./worksheet-presentation";
