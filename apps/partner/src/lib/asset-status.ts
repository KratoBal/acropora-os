import type { AssetStatus } from "@acropora/types";
import type { BadgeProps } from "@acropora/ui";

/**
 * AZ ESZKÖZÁLLAPOT SZÍNE A `Badge` MEGLÉVŐ VARIÁNSAIVAL.
 *
 * A belső felület saját `ServiceTone`/`serviceToneClass` rendszert használ
 * (`apps/web/src/components/service/service-theme.ts`), ami SZÁNDÉKOSAN nem
 * él a `packages/ui`-ban -- a fájl saját fejléce kimondja: a szerviz-redesign
 * még nem az egész alkalmazásé, és a közös csomagba emelt változat azonnal
 * felkínálná az összes, ehhez a körhöz nem tartozó lapnak. A portál emellett
 * SOSEM hivatkozhat `apps/web`-re (`visual-base.spec.ts`). Ez a kis szótár
 * ezért a MÁR KÖZÖS `Badge` öt variánsára képez, nem a `ServiceTone`-ra --
 * közelítés, nem másolat.
 */
export const assetStatusVariant: Record<
  AssetStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  ACTIVE: "success",
  IN_REPAIR: "warning",
  WARM_STANDBY: "info",
  COLD_STANDBY: "info",
  RETIRED: "neutral",
};
