/**
 * MIND AZ OT CIMKE/SZIN-SZOTAR ATKOLTOZOTT A `@acropora/types`-ba
 * (2026-09-24), a `worksheetStatusLabel`/`partnerStatusTone` mintajara --
 * lasd ott a teljes indoklast. Ez a fajl re-exportalja oket, hogy a meglevo
 * `./asset-labels`-re hivatkozo webes importok valtozatlanul maradjanak.
 */
export {
  assetKindLabel,
  assetStatusLabel,
  assetStatusTone,
  assetCriticalityLabel,
  assetEventLabel,
} from "@acropora/types";

import { assetStatusTone, type AssetStatus } from "@acropora/types";
import type { PilotBadgeVariant } from "@/components/pilot/pilot-ui";

/**
 * A KANONIKUS `assetStatusTone` LEKÉPEZÉSE A PILOT BADGE PALETTÁJÁRA.
 *
 * A pilot rétegnek csak négy színcsaládja van (aqua/grey/amber/blue), az
 * `assetStatusTone` viszont egy TÁGABB, megosztott `ServiceTone` uniót
 * használ (a `red`/`purple` más entitásokon -- pl. munkalap -- fordul elő).
 * A `red` 2026-09-30 óta VALÓDI ág: az `OUT_OF_SERVICE` („Üzemen kívül")
 * piros. A pilot-red token azóta létezik (`danger`, a munkalap `REJECTED`
 * állapota is ezt kapja), és a partner-portál `pilotBadgeVariantForTone`-ja
 * is `danger`-re képezi a pirosat -- a két felület így ugyanazt mutatja. A
 * `purple` ma sem fordul elő eszköz-állapoton, a `default` marad.
 */
const TONE_TO_PILOT_VARIANT: Record<
  "neutral" | "purple" | "green" | "amber" | "red" | "blue",
  PilotBadgeVariant
> = {
  green: "teal",
  amber: "amber",
  blue: "blue",
  neutral: "grey",
  red: "danger",
  purple: "default",
};

export function assetStatusPilotVariant(
  status: AssetStatus,
): PilotBadgeVariant {
  return TONE_TO_PILOT_VARIANT[assetStatusTone[status]];
}
