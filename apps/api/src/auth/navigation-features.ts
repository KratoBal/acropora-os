import type { NavigationFeature } from "@acropora/types";

import { enrichmentAvailabilityFor } from "../products/enrichment/enrichment-availability.js";

export const NAVIGATION_ENV = Symbol("NAVIGATION_ENV");

/**
 * THE SERVER SWITCHES THE MENU WAITS ON, for one user. Read here, on the
 * server only; the client learns the result from the menu it is served.
 *
 *   jev-product-enrichment   the JEV product check is available to this user:
 *                            `JEV_PRODUCT_ENRICHMENT` is not `off`, and in
 *                            `benchmark` / `review` the user is on
 *                            `JEV_PILOT_USER_IDS` (PD-013)
 */
export function navigationFeatures(
  env: NodeJS.ProcessEnv,
  userId: string,
): ReadonlySet<NavigationFeature> {
  const features = new Set<NavigationFeature>();
  if (enrichmentAvailabilityFor(env, userId) !== "off")
    features.add("jev-product-enrichment");
  return features;
}
