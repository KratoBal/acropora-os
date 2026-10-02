import type {
  NavigationFeature,
  ProductQualityQueuePage,
  ProductQualityQueueRow,
} from "@acropora/types";

/**
 * WHAT THE CATALOGUE QUEUE SAYS, AND WHY (PD-013: the queue is real now).
 *
 *   unavailable    the switch is off for this user: not served in the menu,
 *                  or the server answers "off" (not on the pilot list)
 *   loading        the page is being read
 *   error          the request failed: said in words, never an empty table
 *   no-stored-run  available, but no product has a stored check yet
 *   empty-filter   checks exist, but this filter holds nothing
 *   rows           the rows of the page
 *
 * Only "rows" draws a table; every other state is a sentence.
 */
export type CatalogQueueState =
  | "unavailable"
  | "loading"
  | "error"
  | "no-stored-run"
  | "empty-filter"
  | "rows";

export const CATALOG_QUEUE_MESSAGE: Record<
  Exclude<CatalogQueueState, "rows" | "loading">,
  string
> = {
  unavailable: "A katalógus adatminőség-ellenőrzése jelenleg nem elérhető.",
  error: "Az adatok jelenleg nem frissíthetők.",
  "no-stored-run":
    "Az ellenőrzési sor még nem elérhető: nincs tárolt JEV ellenőrzés.",
  "empty-filter": "Ebben a szűrőben nincs tétel.",
};

export type QueueLoad =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; page: ProductQualityQueuePage };

export function catalogQueueState(
  features: ReadonlySet<NavigationFeature>,
  load?: QueueLoad,
): CatalogQueueState {
  if (!features.has("jev-product-enrichment")) return "unavailable";
  if (!load || load.kind === "loading") return "loading";
  if (load.kind === "error") return "error";
  if (load.page.availability === "off") return "unavailable";
  if (load.page.checkedProducts === 0) return "no-stored-run";
  return load.page.rows.length === 0 ? "empty-filter" : "rows";
}

/** Where a row leads: a conflict to its own view, the rest to the review. */
export function queueRowHref(row: ProductQualityQueueRow): string {
  const base = `/products/${encodeURIComponent(row.productId)}/adatellenorzes`;
  return row.status === "CONFLICTING_SOURCES"
    ? `${base}/${encodeURIComponent(row.field)}`
    : base;
}
