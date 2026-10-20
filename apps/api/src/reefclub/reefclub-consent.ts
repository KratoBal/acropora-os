/**
 * THE CURRENT VERSION OF THE SHARING CONSENT TEXT (plan v6.1, 4.4; barracuda,
 * #1726 review b). A share is stored with the version the user accepted, and
 * the server accepts only its own current one: a client cannot claim a
 * version the user never saw, and a page that shows an outdated text is
 * refused, not recorded.
 *
 * A CONSTANT, NOT A SETTING: the text lives in the ReefClub web page (slice
 * 9), so a new text is a code change, and this value changes with it in the
 * same change. The page reads the value from GET /rc/v1/me/share-consent.
 *
 * The registration's privacy-notice version is still the client's word
 * (`ReefClubRegisterDto.consentVersion`); the same rule for it is open.
 */
export const REEFCLUB_SHARE_CONSENT_VERSION = "megosztas-2026-10-20";

/**
 * THE CURRENT VERSION OF THE PRIVACY NOTICE THE REGISTRATION ASKS TO ACCEPT
 * (plan v6.1, 1.1; card 33780bcb). The same rule as the sharing consent
 * above: the server accepts only ITS version, a client cannot claim a version
 * the user never saw, and the text lives in the web page
 * (`apps/reefclub/src/lib/consent.ts`), so a new text is a change of that
 * file and of this constant together. The page reads the value from
 * GET /rc/v1/auth/privacy-consent.
 *
 * "tervezet" (draft) IS PART OF THE VERSION ON PURPOSE: the real notice is
 * Balázs's and the lawyer's decision. Replacing the lines and this string is
 * the whole switch; an account created under a draft keeps the draft's
 * version, so the accounts that still need the real one are findable.
 */
export const REEFCLUB_PRIVACY_NOTICE_VERSION =
  "adatkezeles-tervezet-2026-10-20";

export const PRIVACY_VERSION_CHANGED =
  "Az adatkezelési tájékoztató szövege időközben megváltozott. Töltsd újra az oldalt, és olvasd el az új szöveget.";
