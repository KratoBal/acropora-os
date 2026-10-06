import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";

import { getNavigationCounters } from "@/lib/api/navigation-counters";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { NavigationCounters } from "@/lib/navigation/counters";

export const NAVIGATION_COUNTERS_KEY = ["navigation", "counters"] as const;

/**
 * THE TILE NUMBERS: asked when the home or modules screen opens, every
 * minute while it is open, and when the app comes back to the foreground.
 * There is no live stream for these, unlike the messages.
 */
export function useNavigationCounters(): NavigationCounters | undefined {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const enabled = status === "authenticated";
  const counters = useQuery({
    queryKey: NAVIGATION_COUNTERS_KEY,
    queryFn: getNavigationCounters,
    enabled,
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active")
        void queryClient.invalidateQueries({
          queryKey: NAVIGATION_COUNTERS_KEY,
        });
    });
    return () => subscription.remove();
  }, [enabled, queryClient]);
  return enabled ? counters.data : undefined;
}
