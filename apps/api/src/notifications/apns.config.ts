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
  | {
      configured: false;
      /** Beállítatlan változók, a nevükön, ahogy a Coolify felületén állnak. */
      missing: string[];
      /** Beállított, de értelmezhetetlen értékek. Ez már hiba, nem hiány. */
      invalid: string[];
    };

const PRODUCTION_HOST = "api.push.apple.com";
const SANDBOX_HOST = "api.sandbox.push.apple.com";

const PEM_HEADER = "-----BEGIN";

/**
 * A PEM has line breaks, and both Docker and Coolify make those easy to lose.
 * A key pasted with literal `\n` sequences is put back together rather than
 * failing later with an unreadable crypto error.
 */
function restoreLineBreaks(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/**
 * A kulcs alakját FELISMERJÜK, nem feltételezzük.
 *
 * A változó neve ma azt állítja, hogy base64 (`APNS_PRIVATE_KEY_BASE64`), de a
 * név egy állítás, a tartalom a tény - és a kettő ma már egyszer eltért
 * egymástól ugyanezen a beállításon. Ha a névre építenénk és valaki egyszer
 * PEM-et illeszt be, a base64-dekódolás szemetet adna a crypto alá, és a hiba
 * nem az lenne, hogy "rossz a beállítás", hanem egy értelmezhetetlen
 * kriptográfiai üzenet.
 *
 * Ezért: ha PEM, akkor PEM. Ha nem, base64-ként dekódoljuk, és a dekódolt
 * értéknek kell PEM-nek lennie. Ha az sem, az konfigurációs hiba, névvel.
 *
 * AZ ÉRTÉKET SEHOL NEM NAPLÓZZUK, és a hibaüzenetbe sem kerül bele.
 */
export function readSigningKey(raw: string): string | null {
  const value = restoreLineBreaks(raw.trim());
  if (value.startsWith(PEM_HEADER)) return value;

  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64").toString("utf8").trim();
  } catch {
    return null;
  }

  return decoded.startsWith(PEM_HEADER) ? decoded : null;
}

export function readApnsConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApnsConfigResult {
  const rawKey = environment.APNS_PRIVATE_KEY_BASE64?.trim();
  const keyId = environment.APNS_KEY_ID?.trim();
  const teamId = environment.APNS_TEAM_ID?.trim();
  const apnsEnvironment = environment.APNS_ENVIRONMENT?.trim();

  const missing: string[] = [];
  if (!rawKey) missing.push("APNS_PRIVATE_KEY_BASE64");
  if (!keyId) missing.push("APNS_KEY_ID");
  if (!teamId) missing.push("APNS_TEAM_ID");
  if (!apnsEnvironment) missing.push("APNS_ENVIRONMENT");
  if (missing.length > 0) return { configured: false, missing, invalid: [] };

  // Anything other than the two known words is a misconfiguration, not a
  // reason to pick a default: silently choosing production for a typo would
  // send real notifications from a staging deployment.
  if (apnsEnvironment !== "production" && apnsEnvironment !== "sandbox")
    return { configured: false, missing: [], invalid: ["APNS_ENVIRONMENT"] };

  const signingKey = readSigningKey(rawKey!);
  if (!signingKey)
    return {
      configured: false,
      missing: [],
      invalid: ["APNS_PRIVATE_KEY_BASE64"],
    };

  return {
    configured: true,
    config: {
      signingKey,
      keyId: keyId!,
      teamId: teamId!,
      host: apnsEnvironment === "production" ? PRODUCTION_HOST : SANDBOX_HOST,
    },
  };
}
