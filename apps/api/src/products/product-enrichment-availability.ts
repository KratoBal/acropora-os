import type { ProductEnrichmentAvailability } from "@acropora/types";

/**
 * `JEV_PRODUCT_ENRICHMENT`, parsed. Anything unknown, blank or missing is
 * `off`. Pure, and read on the server only: by the product review endpoint
 * and by the menu (`navigationFeatures`), so both follow one switch.
 */
const AVAILABLE = ["benchmark", "review", "production-review"] as const;

export function productEnrichmentAvailability(
  raw: string | undefined,
): ProductEnrichmentAvailability {
  const value = raw?.trim();
  return (AVAILABLE as readonly string[]).includes(value ?? "")
    ? (value as ProductEnrichmentAvailability)
    : "off";
}
