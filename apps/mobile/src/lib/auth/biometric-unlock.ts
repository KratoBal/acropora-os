import * as LocalAuthentication from "expo-local-authentication";

import { unlockOutcomeFromResult } from "./biometric-outcome";
import type { UnlockOutcome } from "./restore-session";

/**
 * The only place that reaches for `expo-local-authentication`, kept as
 * thin as `token-store.ts` is around SecureStore. It holds no decision:
 * which errors mean "nothing to try" lives in `biometric-outcome.ts`,
 * where a test can reach it.
 *
 * `disableDeviceFallback` is deliberately left at its default, so after
 * several failed attempts the system offers the device passcode. That
 * still confirms the owner, which is the whole question being asked here.
 */
export async function unlockWithBiometrics(): Promise<UnlockOutcome> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync())) {
      return "unavailable";
    }
    if (!(await LocalAuthentication.isEnrolledAsync())) {
      return "unavailable";
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Igazold, hogy te vagy",
      cancelLabel: "Belépés jelszóval",
    });

    return unlockOutcomeFromResult(result);
  } catch {
    // The native module itself failed. Nothing here can be retried into
    // working, so this is an absence rather than a rejection: send the
    // person to the password form instead of to a button that will fail
    // again. The session is not discarded either way.
    return "unavailable";
  }
}
