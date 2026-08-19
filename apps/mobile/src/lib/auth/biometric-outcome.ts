import type { UnlockOutcome } from "./restore-session";

/**
 * The error strings `expo-local-authentication` reports when a prompt does
 * not succeed. Listed here rather than imported so this module stays free
 * of the Expo runtime and can be reached by a plain `node --test` - the
 * same arrangement the rest of the auth logic uses.
 */
export type BiometricError =
  | "not_enrolled"
  | "user_cancel"
  | "app_cancel"
  | "not_available"
  | "lockout"
  | "no_space"
  | "timeout"
  | "unable_to_process"
  | "unknown"
  | "system_cancel"
  | "user_fallback"
  | "invalid_context"
  | "passcode_not_set"
  | "authentication_failed";

/**
 * Errors that mean the device has nothing to offer, so there is nothing to
 * try again. Everything else is an attempt that ran and did not succeed -
 * a cancelled prompt, a face that did not match, a timeout - where another
 * attempt is exactly the right thing to offer.
 *
 * Both roads end at the password form, per the owner's decision. The
 * distinction is what the screen may offer, and offering "try Face ID
 * again" to a phone that has no Face ID is a button that cannot work.
 */
const NOTHING_TO_TRY: ReadonlySet<string> = new Set<BiometricError>([
  "not_available",
  "not_enrolled",
  "passcode_not_set",
  "no_space",
  "invalid_context",
]);

/**
 * Reads one biometric prompt result into the outcome `restoreSession`
 * understands. Pure, so the mapping - which decides whether a retry button
 * appears - is covered by tests rather than by holding a phone.
 */
export function unlockOutcomeFromResult(
  result: { success: true } | { success: false; error: string },
): UnlockOutcome {
  if (result.success) {
    return "unlocked";
  }

  return NOTHING_TO_TRY.has(result.error) ? "unavailable" : "rejected";
}
