import { AppState } from "react-native";

import type { AppStateLike } from "./foreground-watcher";

/**
 * The one place that reaches for React Native's AppState, kept as thin as
 * `token-store.ts` is around SecureStore: it holds no decision, only the
 * platform call and the shape conversion. Everything that could be got
 * wrong lives in `foreground-watcher.ts`, where a test can reach it.
 */
export function subscribeToAppState(
  listener: (state: AppStateLike) => void,
): () => void {
  const subscription = AppState.addEventListener("change", listener);
  return () => subscription.remove();
}
