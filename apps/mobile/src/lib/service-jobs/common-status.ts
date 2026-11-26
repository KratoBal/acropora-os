/**
 * RELATIV UT, NEM `@/` ALIAS (a `tsconfig.test.json` fejlece koveteli meg, mint a testver-moduloknal).
 */
import { serviceJobStatusLabel } from "./service-job-status";
import { jobWords } from "./job-words";
import type { ServiceJobStatusValue } from "./types";

/**
 * A KÖZÖS ÁLLAPOT A TELEFONON (kártya 7f23785c, 5. szelet; terv 5. és 9. pont, acrobot 62389).
 *
 * A SZERVER SZÁMOLJA (`commonStatus`, `commonReason` a lista-soron és az adatlapon), a telefon CSAK KIRAJZOLJA: a tárolt nyolc állapotból itt
 * semmi nem vezetődik le újra, mert a levezetett Elkészült egy állítmány (a munkalapok tényeiből), amit a telefon nem lát. A feliratok
 * KÉZZEL KARBANTARTOTT TÜKÖR (az Expo app nem húzza be a munkatér csomagjait); a tükröt EGY ŐRZŐ veti össze a közös csomaggal
 * (`apps/api/src/mobile/mobile-common-status-mirror.spec.ts`): itt a szó a közös lista maga, egy elcsúszott felirat azt mondaná a
 * szerelőnek, amit az irodás már nem.
 *
 * A RÉGI BUILD A RÉGI FELIRATOKAT MUTATJA (elfogadott, acrobot 62389): ez a fájl OTA-val megy, a régi telefon a nyolc régi szót.
 * ISMERETLEN ÉRTÉKRE A MAI TARTALÉK ÁLL: a válaszból hiányzó vagy ismeretlen állapot esetén a tárolt állapot neve (`serviceJobStatusLabel`),
 * nem üres szöveg és nem kitalált szó. Egy ismeretlen OK csak az okot hagyja el (az állapot neve marad).
 */
export type CommonStatus =
  "NEW" | "IN_PROGRESS" | "WAITING" | "DONE" | "CLOSED";

export type CommonReason =
  | "PARTS"
  | "CUSTOMER"
  | "AWAITING_SIGNATURE"
  | "AWAITING_HANDOVER"
  | "READY_TO_CLOSE"
  | "CANCELLED"
  | "REJECTED";

export interface CommonState {
  status: CommonStatus;
  reason: CommonReason | null;
}

/** Az öt állapot neve (a közös csomag `commonServiceStatusLabel` tükre). */
export const COMMON_STATUS_LABELS: Record<CommonStatus, string> = {
  NEW: "Új",
  IN_PROGRESS: "Folyamatban",
  WAITING: "Vár valamire",
  DONE: "Elkészült",
  CLOSED: "Lezárt",
};

/** Az ok felirata, kis betűvel: az állapot neve után áll (a közös csomag `commonServiceReasonLabel` tükre). */
export const COMMON_REASON_LABELS: Record<CommonReason, string> = {
  PARTS: "alkatrészre",
  CUSTOMER: "ügyfélre",
  AWAITING_SIGNATURE: "aláírásra vár",
  AWAITING_HANDOVER: "átadásra vár",
  READY_TO_CLOSE: "lezárható",
  CANCELLED: "meghiúsult",
  REJECTED: "elutasítva",
};

interface CommonFields {
  commonStatus?: string | null;
  commonReason?: string | null;
}

/** A szerver két mezője közös állapottá, vagy `null`, ha a válasz nem hozza vagy az állapotot nem ismerjük (régi válasz, mentett másolat, újabb szerver). */
export function commonStateOf(item: CommonFields): CommonState | null {
  const status = item.commonStatus;
  if (!status || !(status in COMMON_STATUS_LABELS)) return null;
  const reason = item.commonReason;
  return {
    status: status as CommonStatus,
    reason:
      reason && reason in COMMON_REASON_LABELS
        ? (reason as CommonReason)
        : null,
  };
}

/** A jelvény teljes szövege: „Vár valamire · alkatrészre", „Elkészült · aláírásra vár", „Lezárt · meghiúsult". */
export function commonStateText(state: CommonState): string {
  const label = COMMON_STATUS_LABELS[state.status];
  return state.reason === null
    ? label
    : `${label} · ${COMMON_REASON_LABELS[state.reason]}`;
}

/**
 * A HIBAJEGY ÁLLAPOTÁNAK FELIRATA A SOR VAGY AZ ADATLAP SZERINT: a közös állapot az okkal együtt; ha a válasz nem hozza, a tárolt állapot
 * mai neve. A partner-alak (a partner a sajat szavait kapja) nem ezen megy.
 */
export function serviceJobStateText(
  item: CommonFields & { status: string },
): string {
  const common = commonStateOf(item);
  return common ? commonStateText(common) : serviceJobStatusLabel(item.status);
}

/**
 * A KARBANTARTÁSI LAP JELVÉNYE A LISTÁN (terv 3. pont): a közös szavak (Lezárt / Folyamatban); közös állapot nélkül a mai „Kész" /
 * „Folyamatban" (`maintenanceDone`), és ha az sincs, nincs jelvény (hiány = ismeretlen, nem „Folyamatban").
 */
export function maintenanceBadgeText(
  item: CommonFields & { maintenanceDone?: boolean },
): string | null {
  const common = commonStateOf(item);
  if (common) return COMMON_STATUS_LABELS[common.status];
  if (item.maintenanceDone === undefined) return null;
  return item.maintenanceDone ? "Kész" : "Folyamatban";
}

/**
 * A LÉPÉS-GOMB FELIRATA IGE, NEM ÁLLAPOTNÉV (picasso 3. pont, terv 9. pont; a webes `serviceJobStepLabel` tükre): „Lezárás",
 * „Meghiúsultnak jelölés", „Várakoztatás: alkatrészre", „Folytatás". A gomb a szerver `allowedSteps`-éből rajzolódik; a felirat csak a
 * célt és azt nézi, honnan indul. A TRIAGED és a SCHEDULED nem cél; ha mégis jönne, a tárolt neve áll.
 */
export function serviceJobStepLabel(
  from: ServiceJobStatusValue,
  to: ServiceJobStatusValue,
): string {
  switch (to) {
    case "IN_PROGRESS":
      return from === "WAITING_FOR_PARTS" || from === "WAITING_FOR_CUSTOMER"
        ? "Folytatás"
        : "Munka megkezdése";
    case "WAITING_FOR_PARTS":
      return "Várakoztatás: alkatrészre";
    case "WAITING_FOR_CUSTOMER":
      return "Várakoztatás: ügyfélre";
    case "COMPLETED":
      return "Lezárás";
    case "CANCELLED":
      return "Meghiúsultnak jelölés";
    default:
      return serviceJobStatusLabel(to);
  }
}

/**
 * A KÉT VÉGÁLLAPOT ELÉ MEGERŐSÍTÉS KELL (terv 9. pont: a COMPLETED és a CANCELLED végállapot, belőlük nincs átmenet; a mobilon ugyanez az
 * 5. szeletben). Minden más lépés visszafordítható, ott nincs ablak.
 */
export interface StepConfirmation {
  title: string;
  message: string;
  confirmLabel: string;
}

export function stepConfirmation(
  to: ServiceJobStatusValue,
  jobNumber: string,
  kind: string | null | undefined,
): StepConfirmation | null {
  const noun = jobWords(kind).noun;
  // a tárgyeset kiírva (gépi ragozás nincs, lásd `job-words.ts`): „hibajegyet", de „karbantartási lapot"
  const acc = kind === "MAINTENANCE" ? "karbantartási lapot" : "hibajegyet";
  if (to === "COMPLETED")
    return {
      title: `Lezárod a ${acc}?`,
      message: `A ${jobNumber} ${noun} lezárul, és nem nyitható újra. A partner is lezártként látja. Ez nem vonható vissza.`,
      confirmLabel: "Lezárás",
    };
  if (to === "CANCELLED")
    return {
      title: `Meghiúsultnak jelölöd a ${acc}?`,
      message: `A ${jobNumber} ${noun} meghiúsultként lezárul, és nem nyitható újra. A partner lezártként látja. Ez nem vonható vissza.`,
      confirmLabel: "Meghiúsultnak jelölés",
    };
  return null;
}
