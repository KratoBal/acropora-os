/**
 * What to do with what the system answered, kept away from the native module
 * so a test can reach it.
 *
 * Every branch here ends the same way for the person holding the phone:
 * nothing on screen. A colleague who declines notifications has declined them,
 * and an app that argues about it is worse than one that stays quiet. The
 * outcomes exist so the caller can log the difference, not so it can nag.
 */
export type PushRegistrationOutcome =
  /** A token was obtained and can be sent to the server. */
  | { status: "ready"; token: string }
  /** The person said no, or has not been asked and cannot be. */
  | { status: "declined" }
  /** No push on this device at all: a simulator, or a build without the entitlement. */
  | { status: "unavailable" }
  /** Something answered wrongly. Worth a log line, not a screen. */
  | { status: "failed"; reason: string };

export interface PermissionAnswer {
  granted: boolean;
  canAskAgain: boolean;
}

/**
 * A token from Apple is 32 bytes, written as 64 hexadecimal characters.
 *
 * This is checked on the phone as well as on the server, and not out of
 * distrust: `expo-notifications` can hand back an Expo token
 * (`ExponentPushToken[...]`) from the neighbouring call, and a build that
 * asked for the wrong one would register happily and then never receive
 * anything. The failure would surface months later, in production, as
 * "notifications do not work" with nothing to point at.
 */
export function isNativeDeviceToken(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

export function registrationOutcome(input: {
  supported: boolean;
  permission: PermissionAnswer;
  token: string | null;
}): PushRegistrationOutcome {
  if (!input.supported) return { status: "unavailable" };
  if (!input.permission.granted) return { status: "declined" };
  if (!input.token) return { status: "failed", reason: "missing token" };
  if (!isNativeDeviceToken(input.token))
    return {
      status: "failed",
      // Named precisely, because this is the one mistake that looks like
      // success everywhere else.
      reason: "not a native APNs token",
    };
  return { status: "ready", token: input.token.toLowerCase() };
}
