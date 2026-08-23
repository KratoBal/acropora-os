import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

import {
  registrationOutcome,
  type PushRegistrationOutcome,
} from "./push-registration";

/**
 * The only place that reaches for `expo-notifications`, kept as thin as
 * `biometric-unlock.ts` is around the local authentication module. It holds no
 * decision: what the answers mean lives in `push-registration.ts`, where a
 * test can reach it.
 */

/** The app variant this build is, which Apple needs named on every send. */
export function currentBundleId(): string | null {
  const ios = Constants.expoConfig?.ios?.bundleIdentifier;
  return typeof ios === "string" && ios.length > 0 ? ios : null;
}

export async function obtainDeviceToken(): Promise<PushRegistrationOutcome> {
  try {
    // A simulator has no push at all. Asking anyway throws, and the throw
    // would read like a fault rather than the ordinary state it is.
    if (!Device.isDevice)
      return registrationOutcome({
        supported: false,
        permission: { granted: false, canAskAgain: false },
        token: null,
      });

    const existing = await Notifications.getPermissionsAsync();
    const permission = existing.granted
      ? existing
      : existing.canAskAgain
        ? await Notifications.requestPermissionsAsync()
        : existing;

    if (!permission.granted)
      return registrationOutcome({
        supported: true,
        permission: {
          granted: false,
          canAskAgain: permission.canAskAgain ?? false,
        },
        token: null,
      });

    // `getDevicePushTokenAsync`, NOT `getExpoPushTokenAsync`. We talk to Apple
    // directly, and an Expo token would be accepted here and then never
    // arrive anywhere.
    const token = await Notifications.getDevicePushTokenAsync();

    return registrationOutcome({
      supported: true,
      permission: { granted: true, canAskAgain: true },
      token: typeof token.data === "string" ? token.data : null,
    });
  } catch (cause) {
    return {
      status: "failed",
      reason: cause instanceof Error ? cause.message : "unknown error",
    };
  }
}
