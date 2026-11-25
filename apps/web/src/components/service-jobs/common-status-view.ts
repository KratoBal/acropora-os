import type { PilotBadgeVariant } from "@acropora/ui";
import {
  commonServiceReasonLabel,
  commonServiceStateTone,
  commonServiceStatusLabel,
  type CommonServiceState,
  type CommonServiceStatus,
  type CommonServiceStatusReason,
  type CommonServiceTone,
} from "@acropora/types";

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
