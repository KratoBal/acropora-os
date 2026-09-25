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
 * `AssetStatus` MA egyik státusza sem térképeződik `red`-re vagy
 * `purple`-re (lásd `assetStatusTone` a `packages/types`-ban), ezért ez a
 * két ág gyakorlatban nem fut le -- ha egy JÖVŐBELI állapot mégis ide
 * kerülne, a `default` (szürke) a biztonságos, nem-riasztó visszaesés,
 * amíg valaki nem dönt egy valódi pilot-red/pilot-purple tokenről.
 */
const TONE_TO_PILOT_VARIANT: Record<
  "neutral" | "purple" | "green" | "amber" | "red" | "blue",
  PilotBadgeVariant
> = {
  green: "teal",
  amber: "amber",
  blue: "blue",
  neutral: "grey",
  red: "default",
  purple: "default",
};

export function assetStatusPilotVariant(
  status: AssetStatus,
): PilotBadgeVariant {
  return TONE_TO_PILOT_VARIANT[assetStatusTone[status]];
}
