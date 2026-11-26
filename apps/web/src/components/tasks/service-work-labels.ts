import {
  commonServiceStateText,
  commonServiceStateTone,
  type CommonServiceState,
  type MyServiceWorkItem,
  type ServiceJobStatusValue,
  type WorksheetDisplayStatus,
  worksheetDisplayStatusLabel,
  worksheetDisplayStatusTone,
} from "@acropora/types";

import type { ServiceTone } from "@/components/service/service-theme";
import {
  serviceJobStatusLabel,
  serviceJobStatusTone,
} from "@/components/service-jobs/service-job-labels";
import { serviceJobRef } from "@/components/worksheets/service-job-ref";
import { commonStateOfDisplayStatus } from "@/components/worksheets/worksheet-labels";

/**
 * A FELADATAIM SZERVIZES TÉTELEINEK SZÖVEGEI (kártya 041a3dd5, tervrajz:
 * picasso-feladataim-2-allapot). Az állapot felirata és színe a meglévő
 * hibajegy- és munkalap-táblázatokból jön, hogy a szervizes ugyanazt a szót
 * lássa, mint a listákon.
 */

/**
 * A TÉTEL JELÖLÉSE: munkalap, hibajegy vagy karbantartási lap. A rám osztott karbantartási lap is `SERVICE_JOB` tételként jön, de nem
 * hibajegy (Balázs, 2026-11-18 11:31 UTC; acrobot 56109): a jelölése és a linkje a jegy fajtájából jön (`serviceJobRef`, ugyanaz, mint a
 * munkalap hivatkozása).
 */
export function serviceWorkKindLabel(item: MyServiceWorkItem): string {
  return item.kind === "SERVICE_JOB"
    ? serviceJobRef({ id: item.id, kind: item.jobKind }).label
    : "Munkalap";
}

/**
 * A JEGY KÖZÖS ÁLLAPOTA (kártya 7f23785c), ha a szerver küldi: ugyanaz a szó és szín, mint a hibajegy-listán („Elkészült · aláírásra
 * vár"). A tárolt állapotból itt nem vezetünk le semmit; régi válasznál a tárolt állapot neve áll.
 */
function jobCommonState(item: MyServiceWorkItem): CommonServiceState | null {
  return item.kind === "SERVICE_JOB" && item.commonStatus
    ? { status: item.commonStatus, reason: item.commonReason ?? null }
    : null;
}

/**
 * A MUNKALAP-TÉTEL KÖZÖS ÁLLAPOTA (kártya 7f23785c, acrobot 62402): a válasz a megjelenített állapot kulcsát hozza, a közös szótár ugyanazt a
 * négy-öt állapotot mondja a hibajegyével azonos szavakkal és színnel („Elkészült · aláírásra vár", „Lezárt").
 */
function worksheetCommonState(
  item: MyServiceWorkItem,
): CommonServiceState | null {
  return item.kind === "WORKSHEET"
    ? commonStateOfDisplayStatus(item.status)
    : null;
}

export function serviceWorkStatusLabel(item: MyServiceWorkItem): string {
  const common = jobCommonState(item) ?? worksheetCommonState(item);
  if (common) return commonServiceStateText(common);
  return item.kind === "SERVICE_JOB"
    ? serviceJobStatusLabel[item.status as ServiceJobStatusValue]
    : worksheetDisplayStatusLabel[item.status as WorksheetDisplayStatus];
}

export function serviceWorkStatusTone(item: MyServiceWorkItem): ServiceTone {
  const common = jobCommonState(item) ?? worksheetCommonState(item);
  if (common) return commonServiceStateTone(common);
  return item.kind === "SERVICE_JOB"
    ? serviceJobStatusTone(item.status as ServiceJobStatusValue)
    : worksheetDisplayStatusTone(item.status as WorksheetDisplayStatus);
}

const dayFormat = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  month: "2-digit",
  day: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** „Lejárt: 08. 31.” -- a piros sor a tétel saját helyén. */
export function serviceWorkOverdueText(item: MyServiceWorkItem): string | null {
  return item.overdueSince
    ? `Lejárt: ${dayFormat.format(new Date(item.overdueSince))}`
    : null;
}

/**
 * A KÖVETKEZŐ LÉPÉS egy rövid mondatban: mit kell tenni, vagy mire vár. Ez
 * mondja meg a tervrajz második sorában, miért áll a tétel abban a csoportban.
 */
export function serviceWorkNextStep(item: MyServiceWorkItem): string {
  if (item.kind === "WORKSHEET") {
    switch (item.status as WorksheetDisplayStatus) {
      case "NEW":
      case "IN_PROGRESS":
        return "befejezés és lezárás";
      case "COMPLETED":
        return item.sentForSignature
          ? "aláírásra vár a vevőnél"
          : "aláírás rögzítése";
      case "REJECTED":
        return "javítás az elutasítás után";
      case "CLOSED":
        return "aláírva";
    }
  }
  switch (item.status as ServiceJobStatusValue) {
    case "NEW":
      return "felmérés";
    case "TRIAGED":
      return "időpont adása";
    case "SCHEDULED":
      return item.scheduledAt
        ? `${dateFormat.format(new Date(item.scheduledAt))} napra ütemezve`
        : "időpont adása";
    case "IN_PROGRESS":
      return "a munka folytatása";
    case "WAITING_FOR_PARTS":
      return "alkatrész beérkezésére vár";
    case "WAITING_FOR_CUSTOMER":
      return "az ügyfél válaszára vár";
    case "COMPLETED":
      return "elkészült";
    case "CANCELLED":
      return "meghiúsult";
  }
}

/** Az adatlap címe a tétel fajtája szerint. */
export function serviceWorkHref(item: MyServiceWorkItem): string {
  return item.kind === "SERVICE_JOB"
    ? serviceJobRef({ id: encodeURIComponent(item.id), kind: item.jobKind })
        .href
    : `/szerviz/munkalapok/${encodeURIComponent(item.id)}`;
}
