/**
 * RELATÍV UT, NEM `@/` ALIAS: ez a modul spec-ből is behúzódik (lásd a `tsconfig.test.json` fejlécét).
 */
import type { ServiceJobListItem } from "./types";

/**
 * A MENTETT MÁSOLAT HIBAJEGYEI (acrobot 56224, c pont): a másolat egy tábla (`cached_service_jobs`), a karbantartási lapok soraival együtt, mert a Karbantartás lista és a helyszín-letöltő is ide ír. A Hibajegyek lista térerő nélkül ebből
 * csak a hibajegyeket mutatja. A fajta nélküli régi mentett sor hibajegy, ugyanúgy, mint a `jobWords`-nél.
 */
export function repairRowsOf(
  items: readonly ServiceJobListItem[],
): ServiceJobListItem[] {
  return items.filter((item) => item.kind !== "MAINTENANCE");
}
