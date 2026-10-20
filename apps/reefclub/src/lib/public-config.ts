/**
 * THE PUBLIC SETTINGS THE BROWSER NEEDS, read at RUNTIME from the web
 * container's environment (not baked in at build time, so the Coolify
 * resource can change them without a rebuild). Client ids are public
 * identifiers, not secrets: Google and Apple put them in every page that
 * shows their button. An absent one switches that sign-in method off, as on
 * the API side (an empty `REEFCLUB_GOOGLE_CLIENT_IDS` is "not switched on").
 *
 *   REEFCLUB_GOOGLE_CLIENT_ID    the Google OAuth client id of the web client
 *   REEFCLUB_APPLE_CLIENT_ID     the Apple Services ID (e.g. hu.acropora.reefclub.web)
 *   REEFCLUB_APPLE_REDIRECT_URI  the Return URL registered for that Services ID;
 *                                default: this site's own origin
 */
export interface PublicConfig {
  googleClientId: string | null;
  appleClientId: string | null;
  appleRedirectUri: string | null;
}

function setting(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function readPublicConfig(
  env: Record<string, string | undefined>,
): PublicConfig {
  return {
    googleClientId: setting(env.REEFCLUB_GOOGLE_CLIENT_ID),
    appleClientId: setting(env.REEFCLUB_APPLE_CLIENT_ID),
    appleRedirectUri: setting(env.REEFCLUB_APPLE_REDIRECT_URI),
  };
}

const NONE: PublicConfig = {
  googleClientId: null,
  appleClientId: null,
  appleRedirectUri: null,
};

/** The settings as the page reads them; a failure means "no external sign-in", not an error page. */
export async function fetchPublicConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<PublicConfig> {
  try {
    const response = await fetchImpl("/config.json", { cache: "no-store" });
    if (!response.ok) return NONE;
    const body = (await response.json()) as Partial<PublicConfig>;
    return {
      googleClientId:
        typeof body.googleClientId === "string" ? body.googleClientId : null,
      appleClientId:
        typeof body.appleClientId === "string" ? body.appleClientId : null,
      appleRedirectUri:
        typeof body.appleRedirectUri === "string"
          ? body.appleRedirectUri
          : null,
    };
  } catch {
    return NONE;
  }
}
