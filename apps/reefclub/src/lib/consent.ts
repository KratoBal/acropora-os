/**
 * THE PRIVACY NOTICE THE REGISTRATION ASKS TO ACCEPT (plan v6.1, 1.1: the
 * version is stored with the account).
 *
 * THIS IS A DRAFT, AND THE PAGE SAYS SO. The wording below only restates what
 * the plan says the app does; it is not an approved legal text. The version
 * string carries "tervezet" until the real notice replaces the lines (and the
 * version) in this one place. The server takes the version as the client's
 * word (`ReefClubRegisterDto.consentVersion`).
 */
export const PRIVACY_NOTICE_VERSION = "adatkezeles-tervezet-2026-10-20";

export const PRIVACY_NOTICE_LINES: readonly string[] = [
  "A fiókhoz az e-mail címedet és a jelszavad lenyomatát tároljuk, a jelszavadat nem.",
  "A saját akváriumaidat és a hozzájuk felvett méréseket csak te látod, amíg nem osztod meg őket a bolttal.",
  "Ha a boltban kapott kóddal összekötöd a fiókodat a bolti nyilvántartással, a bolti akváriumaid mérései megjelennek nálad, amint a bolt véglegesítette őket.",
  "A fiókodat bármikor törölheted. A törlés kérése után a fiók azonnal zárolt, az adataidat a törlés határidején belül töröljük; a bolti nyilvántartás megmarad.",
];

/**
 * THE SHARING CONSENT TEXT (plan v6.1, 4.4). The server accepts only ITS
 * current version (`REEFCLUB_SHARE_CONSENT_VERSION`, apps/api/src/reefclub/
 * reefclub-consent.ts) and says in that file that the text lives in this page:
 * a new text is a change of this file and of that constant together. The page
 * reads the server's version (GET /rc/v1/me/share-consent) and shares only if
 * it equals this one, so a consent is never recorded for a text the user did
 * not see.
 *
 * LIKE THE PRIVACY NOTICE, THIS IS A DRAFT and the page says so: it only
 * restates what the plan says the share does.
 */
export const SHARE_CONSENT_VERSION = "megosztas-2026-10-20";

export const SHARE_CONSENT_LINES: readonly string[] = [
  "A megosztással a bolt az akvárium adatait, a célsávjait és a mérési értékeit látja, pontosan azt, amit az alábbi előnézet mutat.",
  "A bolt az akváriumot csak olvashatja, nem módosíthatja, és nem látja az e-mail címedet, a többi akváriumodat és a bolti kapcsolataidat.",
  "A megosztást bármikor visszavonhatod; a visszavonás azonnal hat, a bolt a korábbi adatot sem látja tovább.",
];
