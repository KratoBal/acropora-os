/**
 * THE CURRENT VERSION OF THE SHARING CONSENT TEXT (plan v6.1, 4.4; barracuda,
 * #1726 review b). A share is stored with the version the user accepted, and
 * the server accepts only its own current one: a client cannot claim a
 * version the user never saw, and a page that shows an outdated text is
 * refused, not recorded.
 *
 * A CONSTANT, NOT A SETTING: the text lives in the ReefClub web page (slice
 * 9), so a new text is a code change, and this value changes with it in the
 * same change. The page reads the value from GET /rc/v1/share-consent.
 *
 * The registration's privacy-notice version is still the client's word
 * (`ReefClubRegisterDto.consentVersion`); the same rule for it is open.
 */
export const REEFCLUB_SHARE_CONSENT_VERSION = "megosztas-2026-10-20";
