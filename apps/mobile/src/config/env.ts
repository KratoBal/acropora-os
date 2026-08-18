import { parseLockThresholdSeconds } from "@/lib/auth/lock-policy";

type AppEnvironment = "development" | "preview" | "production";

function parseAppEnvironment(value: string | undefined): AppEnvironment {
  const resolved = value ?? "development";
  if (
    resolved === "development" ||
    resolved === "preview" ||
    resolved === "production"
  ) {
    return resolved;
  }

  throw new Error(
    `Invalid EXPO_PUBLIC_APP_ENV "${resolved}". Expected development, preview or production.`,
  );
}

function parseApiUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(
      "EXPO_PUBLIC_API_URL is missing. Copy apps/mobile/.env.example to apps/mobile/.env.local.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `EXPO_PUBLIC_API_URL is not a valid absolute URL: "${value}".`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("EXPO_PUBLIC_API_URL must use http or https.");
  }

  return parsed.toString().replace(/\/$/, "");
}

export const env = Object.freeze({
  appEnvironment: parseAppEnvironment(process.env.EXPO_PUBLIC_APP_ENV),
  apiUrl: parseApiUrl(process.env.EXPO_PUBLIC_API_URL),
  /**
   * How long the app may sit in the background before coming back to the
   * front has to pass the biometric gate again. Configuration rather than
   * a constant, so changing the owner's mind about the number is not a
   * code change.
   */
  foregroundLockThresholdMs: parseLockThresholdSeconds(
    process.env.EXPO_PUBLIC_LOCK_THRESHOLD_SECONDS,
  ),
});
