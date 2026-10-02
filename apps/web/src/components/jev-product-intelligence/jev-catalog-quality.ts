import type { NavigationFeature } from "@acropora/types";

/**
 * WHAT THE CATALOGUE QUEUE CAN HONESTLY SAY TODAY. There is no stored run and
 * no queue endpoint, so both states are "not available"; they differ in why.
 *
 *   unavailable    the server's JEV switch is off (or no menu was served)
 *   no-stored-run  the switch is on, but nothing has been checked and stored
 *
 * When a queue endpoint exists, its answer (rows, error) joins here; an API
 * failure must then be its own state, never an empty table.
 */
export type CatalogQueueState = "unavailable" | "no-stored-run";

export const CATALOG_QUEUE_MESSAGE: Record<CatalogQueueState, string> = {
  unavailable: "A katalógus adatminőség-ellenőrzése jelenleg nem elérhető.",
  "no-stored-run":
    "Az ellenőrzési sor még nem elérhető: nincs tárolt JEV ellenőrzés.",
};

export function catalogQueueState(
  features: ReadonlySet<NavigationFeature>,
): CatalogQueueState {
  return features.has("jev-product-enrichment")
    ? "no-stored-run"
    : "unavailable";
}
