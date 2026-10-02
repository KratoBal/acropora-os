import type { ProductEnrichmentAvailability } from "@acropora/types";

import { productEnrichmentAvailability } from "../product-enrichment-availability.js";

/**
 * WHO SEES THE JEV PRODUCT CHECK (PD-013 item 6).
 *
 *   off                  nobody
 *   benchmark, review    only the users on `JEV_PILOT_USER_IDS` (a comma-
 *                        separated list of user ids, the same shape as the
 *                        Sutyerák pilot list); an empty list means nobody
 *   production-review    everyone who may view products
 *
 * Everyone else gets "off": the review and the queue say "nem elérhető", and
 * the menu does not serve the entry. Read on the server only.
 */
export function pilotUserIds(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function enrichmentAvailabilityFor(
  env: NodeJS.ProcessEnv,
  userId: string,
): ProductEnrichmentAvailability {
  const mode = productEnrichmentAvailability(env.JEV_PRODUCT_ENRICHMENT);
  if (mode === "off" || mode === "production-review") return mode;
  return pilotUserIds(env.JEV_PILOT_USER_IDS).has(userId) ? mode : "off";
}
