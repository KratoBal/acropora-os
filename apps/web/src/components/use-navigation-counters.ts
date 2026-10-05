"use client";

import type { NavigationCounters } from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { navigationCountersApi } from "@/lib/api/navigation-counters";

/** How often the numbers are asked again while the page stays open. */
export const NAVIGATION_COUNTERS_REFRESH_MS = 60_000;

/**
 * THE MENU NUMBERS FOR HIBAJEGYEK, MUNKALAPOK AND ANYAGIGÉNYEK.
 *
 * Unlike the messages, these have no live stream: the number is asked when
 * the shell mounts, when the browser tab comes back into view, and once a
 * minute while it is open. A failed call keeps the last number rather than
 * dropping it, so a passing network error does not make the badges flicker.
 */
export function useNavigationCounters(
  token: string,
  enabled: boolean,
): NavigationCounters | null {
  const [counters, setCounters] = useState<NavigationCounters | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setCounters(await navigationCountersApi.counters(token, signal));
      } catch {
        // keep the last numbers
      }
    },
    [token],
  );

  useEffect(() => {
    if (!enabled || !token) {
      setCounters(null);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    const interval = window.setInterval(
      () => void load(),
      NAVIGATION_COUNTERS_REFRESH_MS,
    );
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, token, load]);

  return counters;
}
