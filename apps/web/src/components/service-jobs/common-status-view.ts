import type { PilotBadgeVariant } from "@acropora/ui";
import {
  commonServiceReasonLabel,
  commonServiceStateTone,
  commonServiceStatusLabel,
  type CommonServiceState,
  type CommonServiceStatus,
  type CommonServiceStatusReason,
  type CommonServiceTone,
  type ServiceJobStatusValue,
  type ServiceJobWorksheetLink,
} from "@acropora/types";

import { serviceJobStatusLabel } from "./service-job-labels";

/**
 * A KÖZÖS ÁLLAPOT A BELSŐ WEBEN (kártya 7f23785c, 3. szelet; terv 9. pont).
 *
 * A szerver számolja (`commonStatus`, `commonReason` a lista-elemen és az
 * adatlapon), a web CSAK KIRAJZOLJA: a tárolt `status`-ból itt semmi nem
 * vezetődik le újra, mert a levezetett Elkészült egy állítmány, és három
 * helyen kell ugyanúgy állnia (sor, számláló, fül-szűrő; terv 8/c).
 */

/** A szerver két mezője közös állapottá, vagy `null`, ha a válasz nem hozza (a mező a típusban opcionális). */
export function commonStateOf(item: {
  commonStatus?: CommonServiceStatus;
  commonReason?: CommonServiceStatusReason | null;
}): CommonServiceState | null {
  return item.commonStatus === undefined
    ? null
    : { status: item.commonStatus, reason: item.commonReason ?? null };
}

/**
 * A KÖZÖS TÓNUS A PILOT JELVÉNYRE, KIVÉTEL A `pilotBadgeVariantForTone`
 * ALAPSZABÁLYA ALÓL (`packages/ui/src/pilot-badge-tone.ts`), ugyanazzal az
 * indokkal, mint a `partnerStatusBadgeVariant`: az alapszabály a lilát kékre,
 * a zöldet aquára képezi, és így az Új és a Folyamatban, illetve a Folyamatban
 * és az Elkészült ugyanazt a színt kapná, holott a közös készlet mind az ötöt
 * megkülönbözteti. Ezért: a Folyamatban aqua (a futó jegy eddig is az volt,
 * `STATUS_BADGE_VARIANT`), az Elkészült a `success` zöld (picasso 7. pont; az
 * adatlap karbantartás-jelvénye eddig is ezt használta), a Lezárt szürke.
 */
const PILOT_VARIANT: Record<CommonServiceTone, PilotBadgeVariant> = {
  blue: "blue",
  purple: "teal",
  amber: "amber",
  green: "success",
  neutral: "grey",
  red: "danger",
};

export function commonPilotVariant(
  state: CommonServiceState,
): PilotBadgeVariant {
  return PILOT_VARIANT[commonServiceStateTone(state)];
}

/** A jelvény szava: az állapot neve. Az ok külön sorban vagy mellette áll (`commonReasonText`). */
export function commonLabel(state: CommonServiceState): string {
  return commonServiceStatusLabel[state.status];
}

/**
 * AZ OK SZÖVEGE A JELVÉNY MELLÉ (picasso 1. pont: az Elkészült és a Lezárt nem
 * áll egyedül). A karbantartás Lezártjának nincs szerver-oka, mert egy szabálya
 * van: minden munkalap aláírva (picasso 9. pont); ezt mondja ki a sor, hogy a
 * „Lezárt" ne azt sugallja, hogy valaki lezárta.
 */
export function commonReasonText(
  state: CommonServiceState,
  kind: "REPAIR" | "MAINTENANCE" = "REPAIR",
): string | null {
  if (state.reason !== null) return commonServiceReasonLabel[state.reason];
  if (kind === "MAINTENANCE" && state.status === "CLOSED")
    return "minden munkalap aláírva";
  return null;
}

/**
 * A LÉPÉS-GOMB FELIRATA IGE, NEM ÁLLAPOTNÉV (picasso 3. pont, terv 9. pont):
 * „Lezárás", „Meghiúsultnak jelölés", „Várakoztatás: alkatrészre", „Folytatás".
 * A gomb a szerver `allowedSteps`-éből rajzolódik; a felirat csak a célt és
 * azt nézi, honnan indul (várakozásból a munka folytatódik, újból kezdődik).
 * A TRIAGED és a SCHEDULED 2026-11-25 óta nem cél (#2898); ha mégis jönne, a
 * tárolt neve áll, nem egy kitalált ige.
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
      return serviceJobStatusLabel[to];
  }
}

/**
 * MIÉRT NEM ZÁRHATÓ LE MÉG A JEGY, EGY MONDATBAN, A HALVÁNY GOMB ALATT (terv 9.
 * pont, picasso 2. pont és a 19:43-as helyesbítés).
 *
 * A KAPU A SZERVEREN ÁLL (`worksheet-signature-gate.ts`: minden lap aláírva és
 * átadva), és a lépést az utasítja el, a lapokat név szerint megnevezve. Itt
 * CSAK OTT halványul a gomb, ahol a közös állapotból BIZTOS, hogy a kapu nem
 * enged: Elkészült aláírásra vagy átadásra várva, illetve Folyamatban látható
 * munkalappal (akkor van befejezetlen lap). Munkalap nélküli Folyamatban jegyet
 * a kapu átenged, ezért ott a gomb él (`null`): a kliens nem szigorít a
 * szerveren túl. A szám a LÁTHATÓ lapoké; ha csak rejtett lap tart vissza, a
 * mondat szám nélkül áll, a rejtett lapot a szerver hibaüzenete nevezi meg.
 */
export function closeBlockedSentence(
  state: CommonServiceState,
  worksheets: readonly Pick<
    ServiceJobWorksheetLink,
    "status" | "handedOverAt"
  >[],
): string | null {
  const count = (n: number, what: string, fallback: string) =>
    `Még nem zárható le: ${n > 0 ? `${n} munkalap ${what}` : fallback}.`;
  if (state.status === "DONE" && state.reason === "AWAITING_SIGNATURE")
    return count(
      worksheets.filter((sheet) => sheet.status !== "SIGNED").length,
      "nincs aláírva",
      "van aláíratlan munkalap",
    );
  if (state.status === "DONE" && state.reason === "AWAITING_HANDOVER")
    return count(
      worksheets.filter((sheet) => sheet.handedOverAt === null).length,
      "átadása nincs rögzítve",
      "van munkalap rögzítetlen átadással",
    );
  if (state.status === "IN_PROGRESS" && worksheets.length > 0)
    return count(
      worksheets.filter(
        (sheet) => sheet.status === "DRAFT" || sheet.status === "REJECTED",
      ).length,
      "még nincs kész",
      "van befejezetlen munkalap",
    );
  return null;
}
