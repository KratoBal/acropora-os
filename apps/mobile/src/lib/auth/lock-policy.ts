/**
 * When coming back to the app from the background, should the biometric
 * gate run again?
 *
 * Cold start is not this module's business: a launch always goes through
 * `restoreSession`, which always asks. This decides the other case - the
 * app was already running and the person brought it back to the front.
 *
 * The rule the owner settled on: a short trip out of the app is normal
 * field behaviour (an incoming call, a photo from the gallery, a
 * notification), so it should not cost a Face ID prompt. A phone left on
 * a table for longer should. The line between the two is a threshold,
 * and it is configuration, not a constant baked into the code.
 */

/** Two minutes, per the owner's decision on 2026-08-18. */
export const DEFAULT_FOREGROUND_LOCK_THRESHOLD_MS = 120_000;

/**
 * Upper bound on a threshold we are willing to honour: 24 hours. Anything
 * beyond this is a misconfiguration - a threshold measured in days is
 * indistinguishable from having no gate at all - and we refuse it rather
 * than quietly running with it.
 */
const MAX_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export type ForegroundDecision = "lock" | "allow";

export interface ForegroundLockInput {
  /**
   * Wall-clock reading from when the app went to the background, or null
   * if we never saw it go (first foreground event, or a listener that
   * missed the transition).
   */
  backgroundedAt: number | null;
  /** Wall-clock reading now. */
  now: number;
  /** Threshold in milliseconds; see `parseLockThresholdSeconds`. */
  thresholdMs: number;
}

/**
 * Reads the threshold from an environment string, in seconds.
 *
 * Falls back to the default when unset. Refuses a value that is not a
 * positive, finite number of seconds within the accepted range: a typo in
 * an env file must not silently widen the window in which a found phone
 * hands over customer names, addresses and prices.
 */
export function parseLockThresholdSeconds(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_FOREGROUND_LOCK_THRESHOLD_MS;
  }

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(
      `Invalid EXPO_PUBLIC_LOCK_THRESHOLD_SECONDS "${value}". Expected a positive number of seconds.`,
    );
  }

  const ms = Math.round(seconds * 1000);
  if (ms > MAX_THRESHOLD_MS) {
    throw new Error(
      `EXPO_PUBLIC_LOCK_THRESHOLD_SECONDS "${value}" is longer than the 24 hour maximum.`,
    );
  }

  return ms;
}

/**
 * Decides whether returning to the foreground has to pass the gate again.
 *
 * Every uncertain case resolves to "lock". There is no monotonic clock
 * available without a native module, so this arithmetic runs on the wall
 * clock, which a person can change - by hand, or by crossing a timezone.
 * A tampered or nonsensical reading therefore fails shut: at worst
 * somebody is asked for Face ID they did not need, which costs a second.
 * Failing open would hand an unlocked app to whoever moved the clock.
 */
export function decideForegroundLock({
  backgroundedAt,
  now,
  thresholdMs,
}: ForegroundLockInput): ForegroundDecision {
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    return "lock";
  }

  // We never saw it leave, so we cannot claim the trip was short.
  if (backgroundedAt === null) {
    return "lock";
  }

  if (!Number.isFinite(backgroundedAt) || !Number.isFinite(now)) {
    return "lock";
  }

  const elapsed = now - backgroundedAt;

  // The clock moved backwards: either it was changed, or the stored
  // reading is from a different clock than this one. Not evidence of a
  // short absence.
  if (elapsed < 0) {
    return "lock";
  }

  return elapsed >= thresholdMs ? "lock" : "allow";
}
