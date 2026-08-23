// Relative on purpose, unlike the `@/` alias used elsewhere: this module
// is compiled by tsconfig.test.json and run under plain `node --test`,
// which resolves what TypeScript emits. TypeScript rewrites nothing, so an
// alias here would survive compilation and then fail to resolve at run
// time.
import { parseLockThresholdSeconds } from "../lib/auth/lock-policy";

type AppEnvironment = "development" | "preview" | "production";

export interface AppConfig {
  appEnvironment: AppEnvironment;
  apiUrl: string;
  /**
   * How long the app may sit in the background before coming back to the
   * front has to pass the biometric gate again. Configuration rather than
   * a constant, so changing the owner's mind about the number is not a
   * code change.
   */
  foregroundLockThresholdMs: number;
}

/**
 * Reading the configuration either produced a usable one, or a list of
 * what is wrong with it - in the app's own language, because these lines
 * are shown to whoever is holding the phone.
 *
 * It is a returned value rather than a thrown error on purpose. This runs
 * at import time, before any screen exists, so a throw here takes the app
 * down with no message at all: the launch failure a bad API address
 * already caused once. A phone that says what is wrong can be fixed on
 * site; one that dies silently sends someone looking in the wrong place.
 */
export type EnvOutcome =
  { ok: true; config: AppConfig } | { ok: false; problems: string[] };

export type EnvSource = Record<string, string | undefined>;

function readAppEnvironment(
  value: string | undefined,
  problems: string[],
): AppEnvironment {
  const resolved = value ?? "development";
  if (
    resolved === "development" ||
    resolved === "preview" ||
    resolved === "production"
  ) {
    return resolved;
  }

  problems.push(
    `Az EXPO_PUBLIC_APP_ENV értéke "${resolved}", ami nem értelmezhető. Elfogadott: development, preview vagy production.`,
  );
  return "development";
}

function readApiUrl(value: string | undefined, problems: string[]): string {
  if (!value) {
    problems.push(
      "Hiányzik az EXPO_PUBLIC_API_URL, tehát az alkalmazás nem tudja, melyik szervert kell hívnia.",
    );
    return "";
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    problems.push(
      `Az EXPO_PUBLIC_API_URL értéke ("${value}") nem érvényes webcím. Teljes címet kell megadni, például http://192.168.1.50:3001 alakban.`,
    );
    return "";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    problems.push(
      `Az EXPO_PUBLIC_API_URL értéke ("${value}") nem http vagy https címre mutat.`,
    );
    return "";
  }

  return parsed.toString().replace(/\/$/, "");
}

/**
 * Pure: everything it reads comes from `source`, so a test can hand it a
 * broken configuration without touching the process environment.
 *
 * Collects every problem instead of stopping at the first, so fixing one
 * does not simply reveal the next on the following launch.
 */
export function readEnvironment(source: EnvSource): EnvOutcome {
  const problems: string[] = [];

  const config: AppConfig = {
    appEnvironment: readAppEnvironment(source.EXPO_PUBLIC_APP_ENV, problems),
    apiUrl: readApiUrl(source.EXPO_PUBLIC_API_URL, problems),
    // Adds nothing to `problems` by design: an unreadable threshold falls
    // back to the owner's fifteen minutes, so it is never a reason to
    // refuse to start. A missing server address is - there is no usable
    // default for that one. See lock-policy.ts.
    foregroundLockThresholdMs: parseLockThresholdSeconds(
      source.EXPO_PUBLIC_LOCK_THRESHOLD_SECONDS,
    ),
  };

  return problems.length > 0 ? { ok: false, problems } : { ok: true, config };
}

/**
 * The app's own configuration, read once. Never throws - check `ok`
 * before reading `config`. `src/app/_layout.tsx` does exactly that, and
 * shows the problems instead of the app when there are any.
 *
 * EVERY VARIABLE IS NAMED HERE, ONE BY ONE, AND THAT IS A REQUIREMENT, NOT A
 * STYLE. `EXPO_PUBLIC_*` values do not arrive at run time in a release build:
 * `babel-preset-expo` replaces each `process.env.EXPO_PUBLIC_X` with its
 * value while compiling, and its plugin only recognises that exact shape -
 * a member expression whose object is `process.env` (see
 * `babel-preset-expo/build/plugins/inline-env-vars.js`). Handing the whole
 * object over as `readEnvironment(process.env)` matches nothing, so nothing
 * is substituted, and in the finished binary every field is `undefined`.
 *
 * That is what happened: a TestFlight build stopped on launch with "Hiányzik
 * az EXPO_PUBLIC_API_URL", while the value was correctly set in EAS all
 * along. Under Metro there IS a real process environment, so the same code
 * works in development and only fails once shipped - twice now.
 *
 * The function keeps its parameter on purpose: a test hands it a broken
 * configuration without touching the process environment. Only the CALL is
 * spelled out.
 */
export const environment = readEnvironment({
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_LOCK_THRESHOLD_SECONDS:
    process.env.EXPO_PUBLIC_LOCK_THRESHOLD_SECONDS,
});
