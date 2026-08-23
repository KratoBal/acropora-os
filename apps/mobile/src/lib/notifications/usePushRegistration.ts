import { useEffect, useRef } from "react";

import { registerDeviceToken } from "@/lib/api/notifications";

import { currentBundleId, obtainDeviceToken } from "./push-device";

/**
 * Registers this phone once per signed-in session.
 *
 * Nothing here reaches a screen. A colleague who declines notifications has
 * declined them; a simulator has no push at all; the server being briefly
 * unreachable is not this screen's problem. In every one of those cases the
 * app carries on exactly as before - the alternative is a home screen that
 * opens with an error about a feature nobody asked for yet.
 *
 * The guard is a ref rather than state on purpose: it must not cause a
 * re-render, and it must survive one. Asking Apple again on every render
 * would be a permission prompt in a loop.
 */
export function usePushRegistration(enabled: boolean): void {
  const attempted = useRef(false);

  useEffect(() => {
    if (!enabled || attempted.current) return;
    attempted.current = true;

    void (async () => {
      const outcome = await obtainDeviceToken();
      if (outcome.status !== "ready") return;

      const bundleId = currentBundleId();
      // Three app variants exist, and Apple refuses a notification sent under
      // the wrong one. A build that cannot name itself must not register a
      // token that could then be sent under a guess.
      if (!bundleId) return;

      try {
        await registerDeviceToken({ token: outcome.token, bundleId });
      } catch {
        // The next launch tries again. Nothing is lost by staying quiet, and
        // the person holding the phone did not ask for this to happen now.
      }
    })();
  }, [enabled]);
}
