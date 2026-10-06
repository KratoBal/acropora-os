import {
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

/**
 * A FELADATAIM SZERVIZES TÉTELEINEK SZÖVEGEI (kártya 041a3dd5, tervrajz:
 * picasso-feladataim-2-allapot). Az állapot felirata és színe a meglévő
 * hibajegy- és munkalap-táblázatokból jön, hogy a szervizes ugyanazt a szót
 * lássa, mint a listákon.
 */

export const SERVICE_WORK_KIND_LABEL: Record<
  MyServiceWorkItem["kind"],
  string
> = {
  SERVICE_JOB: "Hibajegy",
  WORKSHEET: "Munkalap",
};

export function serviceWorkStatusLabel(item: MyServiceWorkItem): string {
  return item.kind === "SERVICE_JOB"
    ? serviceJobStatusLabel[item.status as ServiceJobStatusValue]
    : worksheetDisplayStatusLabel[item.status as WorksheetDisplayStatus];
}

export function serviceWorkStatusTone(item: MyServiceWorkItem): ServiceTone {
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
    ? `/szerviz/hibajegyek/${encodeURIComponent(item.id)}`
    : `/szerviz/munkalapok/${encodeURIComponent(item.id)}`;
}
