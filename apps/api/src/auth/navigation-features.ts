import type { NavigationFeature } from "@acropora/types";

import { productEnrichmentAvailability } from "../products/product-enrichment-availability.js";

export const NAVIGATION_ENV = Symbol("NAVIGATION_ENV");

/**
 * THE SERVER SWITCHES THE MENU WAITS ON, from the environment. Read here, on
 * the server only; the client learns the result from the menu it is served.
 *
 *   jev-product-enrichment   `JEV_PRODUCT_ENRICHMENT` is not `off`
 */
export function navigationFeatures(
  env: NodeJS.ProcessEnv,
): ReadonlySet<NavigationFeature> {
  const features = new Set<NavigationFeature>();
  if (productEnrichmentAvailability(env.JEV_PRODUCT_ENRICHMENT) !== "off")
    features.add("jev-product-enrichment");
  return features;
}
