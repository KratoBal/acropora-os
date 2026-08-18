import { decideForegroundLock } from "./lock-policy";

/**
 * Watches the app leaving and re-entering the foreground, and closes the
 * gate when it has been away long enough.
 *
 * Deliberately free of any React Native import: the platform's AppState is
 * injected as `subscribe`, the same way `restore-session.ts` takes its
 * storage and network. The thin adapter that actually reaches for
 * `AppState` lives next door and holds no logic.
 */

/**
 * The subset of AppState's values this cares about. Anything that is not
 * "active" or "background" - iOS's transitional "inactive", chiefly - is
 * ignored: the app switcher, a pulled-down notification centre and the
 * system's own biometric prompt all pass through it, and treating those
 * as leaving would make the gate prompt for itself.
 */
export type AppStateLike = string;

export interface ForegroundWatcherDeps {
  /**
   * Registers `listener` for app state changes and returns the function
   * that unregisters it.
   */
  subscribe(listener: (state: AppStateLike) => void): () => void;
  /** Wall clock; injected so tests do not wait in real time. */
  now(): number;
  /** How long away is long enough. See `lock-policy.ts`. */
  thresholdMs: number;
  /** Called when returning to the foreground has to pass the gate again. */
  onLock(): void;
}

/**
 * Starts watching. Returns the function that stops it - hand it straight
 * to a React effect's cleanup.
 */
export function watchForegroundLock(deps: ForegroundWatcherDeps): () => void {
  let backgroundedAt: number | null = null;

  const unsubscribe = deps.subscribe((state) => {
    if (state === "background") {
      // Only the first transition counts: iOS can deliver "background"
      // more than once, and the clock should start when the app actually
      // left, not when the last duplicate arrived.
      backgroundedAt ??= deps.now();
      return;
    }

    if (state !== "active") {
      return;
    }

    // Coming to the foreground without having seen it leave is a cold
    // start, and `restoreSession` has already asked. Prompting here too
    // would mean two prompts for one launch.
    if (backgroundedAt === null) {
      return;
    }

    const decision = decideForegroundLock({
      backgroundedAt,
      now: deps.now(),
      thresholdMs: deps.thresholdMs,
    });

    backgroundedAt = null;

    if (decision === "lock") {
      deps.onLock();
    }
  });

  return unsubscribe;
}
