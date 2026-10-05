import type { NavigationCounters } from "@/lib/navigation/counters";

import { apiRequest } from "./client";

/** The menu numbers (`GET /navigation/counters`). */
export function getNavigationCounters() {
  return apiRequest<NavigationCounters>("/navigation/counters");
}
