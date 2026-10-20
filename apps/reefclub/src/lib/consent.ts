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
