import type { WorksheetVersionStatus } from "@acropora/types";

/**
 * AZ ÁLLAPOT-FELIRATOK A `@acropora/types`-BÓL JÖNNEK, ÉS ITT CSAK ÁTMENNEK.
 *
 * 2026-09-21-ig ennek a fájlnak a törzsében álltak. A partnerportál ugyanezt a
 * négy állapotot írja ki, és az `apps/web` forrását nem éri el -- addig a
 * NYERS enum-érték látszott nála (`SIGNED`, `DRAFT`).
 *
 * A re-export marad, mert a modul többi címkéje (szín, összegformázás)
 * webes, tehát a hívóknak amúgy is innen kell importálniuk.
 */
import { worksheetStatusLabel as sharedWorksheetStatusLabel } from "@acropora/types";

/**
 * A VÁLTOZAT-ÁLLAPOT FELIRATA A BELSŐ WEBEN: a közös csomag szótára (a partnerportál és a telefon is azt olvassa), egy eltéréssel: az aláírt
 * változat „Lezárt", mint a közös szótárban (kártya 7f23785c, acrobot 62402), hogy a fül, a csempe és a verziótörténet ugyanazt a szót
 * mondja, mint a sor jelvénye. A partner portál saját szava a „Lezárva" marad, a csomag szótárát ez nem írja át. A fülek a változat-állapot
 * szerint szűrnek (az Elutasítva külön fül): a szűrő neve marad, a sor jelvénye pedig „Folyamatban · elutasítva".
 */
export const worksheetStatusLabel: Record<WorksheetVersionStatus, string> = {
  ...sharedWorksheetStatusLabel,
  SIGNED: "Lezárt",
};

/**
 * AZ ALLAPOT MEGITELESE: jo, rossz, varakozo vagy semleges. EGY helyen.
 *
 * TABLAZAT, NEM FELTETEL-LANC, ES EZ A LENYEGE. A korabbi alak harom `if`-bol
 * allt es egy `return "neutral"`-lal zart -- vagyis egy UJ allapot CSENDBEN
 * semlegesnek latszott volna, es semmi nem szolt volna rola. Nem elmeleti
 * kockazat: a szerver DTO-ja maga mondja ki, hogy "amig a vitatott (ala nem
 * irt) lap sorsa nyitott, a lekepezes sem rogzitheto" -- tehat egy otodik
 * ertekkel SZAMOLUNK.
 *
 * `Record<WorksheetVersionStatus, ...>` alakban a fordito kenyszeriti ki a
 * teljesseget: egy uj allapot nem a felulten jelenik meg szurken, hanem a
 * forditasnal, nev szerint. A masik ket szerviz-szotar (`assetStatusTone`,
 * `JOB_STATUS_TONE`) mar igy all; ez a harmadik volt hatra.
 */
const WORKSHEET_STATUS_VARIANT: Record<
  WorksheetVersionStatus,
  "success" | "warning" | "danger" | "neutral"
> = {
  DRAFT: "neutral",
  AWAITING_SIGNATURE: "warning",
  SIGNED: "success",
  REJECTED: "danger",
};

export function worksheetStatusVariant(status: WorksheetVersionStatus) {
  return WORKSHEET_STATUS_VARIANT[status];
}

/**
 * A piszkozatnak nincs száma: a sorszám a lezáráskor keletkezik. A listán
 * ezért nem üres cella áll, hanem kimondjuk, hogy még nincs - üres helyre a
 * felhasználó hibát képzel, nem szabályt.
 */
export function worksheetLabelOrDraft(label: string | null): string {
  return label ?? "Még nincs száma";
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

/**
 * A NAP, AHOGY BUDAPESTEN TELT (kártya a785e580): egy időbélyeg napja a budapesti naptári nap, nem az ISO-szöveg első tíz
 * betűje (az UTC szerinti nap volna: a 00:30-kor megnyitott lap az előző napra esne, a "Megnyitva" szűrővel ellentétben).
 */
export function formatDay(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("hu-HU", {
    timeZone: "Europe/Budapest",
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * A MUNKALAP-ALLAPOT SZINE ATKOLTOZOTT A `@acropora/types`-ba (2026-09-24,
 * a munkalap-lapok partneri paritasa) -- lasd ott a teljes indoklast. A
 * `worksheetStatusVariant` HELYBEN MARAD: csak ez a fuggveny hasznalja,
 * apps/web-fuggese nincs, athelyezese semmit nem nyerne.
 */
export { worksheetStatusTone } from "@acropora/types";

import { worksheetStatusTone } from "@acropora/types";
import type { PilotBadgeVariant } from "@/components/pilot/pilot-ui";

/**
 * A KANONIKUS `worksheetStatusTone` LEKÉPEZÉSE A PILOT BADGE PALETTÁJÁRA.
 *
 * Ugyanaz a minta, mint `assetStatusPilotVariant`
 * (`apps/web/src/components/service-assets/asset-labels.ts`) -- lásd ott a
 * teljes indoklást a `red`/`purple` ágak biztonságos visszaesésére.
 */
const TONE_TO_PILOT_VARIANT: Record<
  "neutral" | "purple" | "green" | "amber" | "red" | "blue",
  PilotBadgeVariant
> = {
  green: "teal",
  amber: "amber",
  blue: "blue",
  red: "danger",
  neutral: "grey",
  purple: "default",
};

export function worksheetStatusPilotVariant(
  status: WorksheetVersionStatus,
): PilotBadgeVariant {
  return TONE_TO_PILOT_VARIANT[worksheetStatusTone(status)];
}

/**
 * A MUNKALAP ÁLLAPOTA A KÖZÖS SZÓTÁRBÓL (kártya 7f23785c, acrobot 62402): Új, Folyamatban, Elkészült, Lezárt; az elutasított lap Folyamatban,
 * „elutasítva" okkal (a javítás nálunk van). 2026-11-26 előtt a webes munkalap a saját négy-öt szavát mondta (Lezárva, Elutasítva, más
 * színek), amit mérve eltért a hibajegyétől; ma a két lap ugyanazt a szót és színt kapja.
 *
 * A LAP-VÁLASZ IS HOZZA (`commonStatus`, `commonReason` a lista-soron és az adatlapon, a telefonnak), de a webnek a mezői megvannak, és a
 * munkalapnál ez tiszta levezetés: ha a válasz hozza, az áll, ha nem (régi válasz, fixtúra), a közös szótár ugyanazzal a függvénnyel
 * (`commonWorksheetStatus`) számolja a változat-állapotból és a tételszámból. A fülek és a csempék a szerver változat-állapot szerinti számait mutatják (ott a DRAFT „Új és
 * folyamatban"), azokhoz ez nem nyúl.
 */
export { worksheetDisplayStatus } from "@acropora/types";

import {
  commonServiceReasonLabel,
  commonServiceStateText,
  commonServiceStateTone,
  commonServiceStatusLabel,
  commonWorksheetStatus,
  type CommonServiceState,
  type CommonServiceStatus,
  type CommonServiceStatusReason,
  type WorksheetDisplayStatus,
} from "@acropora/types";

import { commonPilotVariant } from "@/components/service-jobs/common-status-view";

export function worksheetCommonState(item: {
  status: WorksheetVersionStatus;
  lineCount?: number | null;
  commonStatus?: CommonServiceStatus | null;
  commonReason?: CommonServiceStatusReason | null;
}): CommonServiceState {
  return item.commonStatus
    ? { status: item.commonStatus, reason: item.commonReason ?? null }
    : commonWorksheetStatus(item.status, item.lineCount ?? 0);
}

/**
 * A SZERVER MEGJELENÍTETT ÁLLAPOTÁBÓL (Feladataim, az üzenetek kapcsolt lap kártyája: ott a válasz a `WorksheetDisplayStatus` kulcsát hozza,
 * nem a változat-állapotot) A KÖZÖS ÁLLAPOT: a megjelenített állapot ugyanabból a két bemenetből áll, ezért a leképezés veszteségmentes, és
 * a közös szótár ugyanazzal a függvénnyel mondja (`commonWorksheetStatus`). Ismeretlen kulcsra `null` (a hívó a mai tartalékot adja).
 */
const DISPLAY_TO_VERSION: Record<
  WorksheetDisplayStatus,
  [WorksheetVersionStatus, number]
> = {
  NEW: ["DRAFT", 0],
  IN_PROGRESS: ["DRAFT", 1],
  COMPLETED: ["AWAITING_SIGNATURE", 1],
  CLOSED: ["SIGNED", 1],
  REJECTED: ["REJECTED", 1],
};

export function commonStateOfDisplayStatus(
  status: string,
): CommonServiceState | null {
  if (!Object.hasOwn(DISPLAY_TO_VERSION, status)) return null;
  const [version, lines] = DISPLAY_TO_VERSION[status as WorksheetDisplayStatus];
  return commonWorksheetStatus(version, lines);
}

/** Az ok szövege a jelvény mellé („aláírásra vár", „elutasítva"), vagy `null`: a sima Új, Folyamatban és a Lezárt nem kap okot. */
export function worksheetReasonText(state: CommonServiceState): string | null {
  return state.reason === null ? null : commonServiceReasonLabel[state.reason];
}

export function worksheetDisplayLabel(
  status: WorksheetVersionStatus,
  lineCount: number,
): string {
  return commonServiceStatusLabel[
    commonWorksheetStatus(status, lineCount).status
  ];
}

export function worksheetDisplayTone(
  status: WorksheetVersionStatus,
  lineCount: number,
) {
  return commonServiceStateTone(commonWorksheetStatus(status, lineCount));
}

export function worksheetDisplayPilotVariant(
  status: WorksheetVersionStatus,
  lineCount: number,
): PilotBadgeVariant {
  return commonPilotVariant(commonWorksheetStatus(status, lineCount));
}

/**
 * A VÁLTOZAT-ÁLLAPOT SZÖVEGE, AHOL A TÉTELSZÁM NEM ISMERT (a hibajegy alatti lap-kártya, a csatolható lapok listája, a verziótörténet): a
 * piszkozat a mai „Új és folyamatban" (a két megjelenített állapotot fedi, mint a fülek), minden más a közös szó AZ OKKAL: „Elkészült ·
 * aláírásra vár", „Lezárt", „Folyamatban · elutasítva". Az ok nem hagyható el: a hibajegyen ebből látszik, hogy az elutasított lapnál a javítás
 * nálunk van, és cselekedni kell (barracuda, #2984).
 */
export function worksheetVersionText(status: WorksheetVersionStatus): string {
  return status === "DRAFT"
    ? worksheetStatusLabel.DRAFT
    : commonServiceStateText(commonWorksheetStatus(status, 1));
}

/**
 * LABOUR HOURS AS PEOPLE READ THEM: the API's decimal string ("2.5", "4")
 * in Hungarian form ("2,5", "4"), at most two decimals. Used wherever a
 * sheet's hours are shown next to it (the job's worksheet card, the list).
 */
export function formatLaborHours(hours: string): string {
  const value = Number(hours);
  if (!Number.isFinite(value)) return hours;
  return value.toLocaleString("hu-HU", { maximumFractionDigits: 2 });
}
