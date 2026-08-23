/**
 * What the APNs sender needs from the environment, and what it does when a
 * piece is missing.
 *
 * Missing configuration is not an error here. Notifications are a courtesy on
 * top of the assignment, and a development machine has no signing key: the
 * sender simply reports that it is not configured, and the assignment carries
 * on. What is NOT allowed is a half-configured sender that looks ready and
 * fails on every send, so the pieces are read and judged together, as a set.
 */
export interface ApnsConfig {
  /** The `.p8` signing key, in PEM form, as Apple hands it over. */
  signingKey: string;
  /** The key's own id, from the Apple developer portal. */
  keyId: string;
  /** The team the key belongs to. */
  teamId: string;
  /**
   * Which Apple host to talk to.
   *
   * A token minted by a build signed for development only works against the
   * sandbox, and a TestFlight or App Store build only against production.
   * Getting this wrong answers `BadDeviceToken` on every send, and nothing
   * says which half was wrong - so the value is explicit, never guessed.
   */
  host: "api.push.apple.com" | "api.sandbox.push.apple.com";
}

export type ApnsConfigResult =
  | { configured: true; config: ApnsConfig }
  | { configured: false; missing: string[] };

const PRODUCTION_HOST = "api.push.apple.com";
const SANDBOX_HOST = "api.sandbox.push.apple.com";

/**
 * The signing key arrives as one environment variable, and a PEM has line
 * breaks. Docker and Coolify both make those easy to lose, so a key pasted
 * with literal `\n` sequences is accepted and put back together rather than
 * failing later with an unreadable crypto error.
 */
function normalizeKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function readApnsConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApnsConfigResult {
  const signingKey = environment.APNS_KEY?.trim();
  const keyId = environment.APNS_KEY_ID?.trim();
  const teamId = environment.APNS_TEAM_ID?.trim();
  const apnsEnvironment = environment.APNS_ENVIRONMENT?.trim();

  const missing: string[] = [];
  if (!signingKey) missing.push("APNS_KEY");
  if (!keyId) missing.push("APNS_KEY_ID");
  if (!teamId) missing.push("APNS_TEAM_ID");
  if (!apnsEnvironment) missing.push("APNS_ENVIRONMENT");
  if (missing.length > 0) return { configured: false, missing };

  // Anything other than the two known words is a misconfiguration, not a
  // reason to pick a default: silently choosing production for a typo would
  // send real notifications from a staging deployment.
  if (apnsEnvironment !== "production" && apnsEnvironment !== "sandbox")
    return { configured: false, missing: ["APNS_ENVIRONMENT"] };

  return {
    configured: true,
    config: {
      signingKey: normalizeKey(signingKey!),
      keyId: keyId!,
      teamId: teamId!,
      host: apnsEnvironment === "production" ? PRODUCTION_HOST : SANDBOX_HOST,
    },
  };
}
