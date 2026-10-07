import type { NavigationFeature } from "@acropora/types";

import {
  enrichmentAvailabilityFor,
  pilotUserIds,
} from "../products/enrichment/enrichment-availability.js";

export const NAVIGATION_ENV = Symbol("NAVIGATION_ENV");

/**
 * THE SERVER SWITCHES THE MENU WAITS ON, for one user. Read here, on the
 * server only; the client learns the result from the menu it is served.
 *
 *   jev-product-enrichment   the JEV product check is available to this user:
 *                            `JEV_PRODUCT_ENRICHMENT` is not `off`, and in
 *                            `benchmark` / `review` the user is on
 *                            `JEV_PILOT_USER_IDS` (PD-013)
 *   quotes                   the quote module's menu (#1582 P1, decision 3):
 *                            `QUOTES_ENABLED` is `on` (everyone), or `pilot`
 *                            and the user is on `QUOTES_PILOT_USER_IDS` (an
 *                            empty list means nobody); anything else is off.
 *                            It hides the MENU only: the API is guarded by the
 *                            quotes.* permissions, not by this switch.
 */
export function navigationFeatures(
  env: NodeJS.ProcessEnv,
  userId: string,
): ReadonlySet<NavigationFeature> {
  const features = new Set<NavigationFeature>();
  if (enrichmentAvailabilityFor(env, userId) !== "off")
    features.add("jev-product-enrichment");
  if (quotesMenuOn(env, userId)) features.add("quotes");
  return features;
}

export function quotesMenuOn(env: NodeJS.ProcessEnv, userId: string): boolean {
  const mode = (env.QUOTES_ENABLED ?? "").trim().toLowerCase();
  if (mode === "on") return true;
  if (mode === "pilot")
    return pilotUserIds(env.QUOTES_PILOT_USER_IDS).has(userId);
  return false;
}
