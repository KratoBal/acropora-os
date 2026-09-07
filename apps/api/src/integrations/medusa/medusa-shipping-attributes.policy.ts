/**
 * A SZALLITASI JELLEMZOK ATVITELE: MI MEGY AT, ES MI NEM.
 *
 * === MIERT LETEZIK EZ AZ UT ===
 *
 * A bolt oldalan a kosar szallitasi osztalya (PICKUP_ONLY, HEAVY, NO_FOXPOST,
 * NORMAL) NEGY KIMONDOTT ZASZLOBOL dol el, termekenkent. A zaszlok helye ott
 * megvan (`shipping_attribute` modul, admin vegponttal), az ertekek helye itt
 * (`ProductShippingProfile`), es a kettot MA SEMMI nem koti ossze -- a Commerce
 * modell sajat megjegyzese ki is mondja: "Acropora OS synchronizes by product
 * id", holott az OS-ben nulla talalat van a `shipping-attribute` alakra.
 *
 * Ez a modul a leképezes, tiszta fuggvenyben.
 *
 * === A NEV-ELTERES SZANDEKOS, ES NEM VELETLEN ===
 *
 * Az OS `camelCase`, a Medusa `snake_case` konvenciot hasznal. A leképezes
 * ezert EGY helyen all: ha ket helyen allna, egy elgepeles az egyiken csendben
 * hamis erteket vinne at, es a hiba a SZALLITASI MODOK kozott jelenne meg,
 * nem itt.
 */

/** Amit az OS oldalan tarolunk. A negy mezo KOTELEZO: nincs alapertelmezes. */
export interface OsShippingProfile {
  pickupOnly: boolean;
  foxpostForbidden: boolean;
  isHeavy: boolean;
  isFrozen: boolean;
}

/** Amit a bolt admin vegpontja var. */
export interface MedusaShippingFlags {
  pickup_only: boolean;
  foxpost_forbidden: boolean;
  is_heavy: boolean;
  is_frozen: boolean;
}

export function shippingFlagsFromProfile(
  profile: OsShippingProfile,
): MedusaShippingFlags {
  return {
    pickup_only: profile.pickupOnly,
    foxpost_forbidden: profile.foxpostForbidden,
    is_heavy: profile.isHeavy,
    is_frozen: profile.isFrozen,
  };
}

/**
 * VALTOZIK-E BARMI, HA KIKULDJUK.
 *
 * === MIERT KELL, HOLOTT AZ IRAS AMUGY IS IDEMPOTENS ===
 *
 * Nem a spórolas miatt. A parancs KIMENETE csak akkor bizonyit, ha meg tudja
 * mondani, mi TORTENT -- "mar igy allt" kontra "most allitottuk be". A WYSIWYG
 * szabalynal ezt megmertuk: ott az EREDMENY onmagaban semmit nem bizonyitott,
 * mert a Medusa alapertelmezese ugyanaz volt, mint a szandekunk. A ket sor
 * KULONBSEGE volt a bizonyitek.
 */
export function shippingFlagsDiffer(
  current: MedusaShippingFlags | null,
  wanted: MedusaShippingFlags,
): boolean {
  if (!current) return true;
  return (
    current.pickup_only !== wanted.pickup_only ||
    current.foxpost_forbidden !== wanted.foxpost_forbidden ||
    current.is_heavy !== wanted.is_heavy ||
    current.is_frozen !== wanted.is_frozen
  );
}

/**
 * EMBERI ALAK A JELENTESHEZ: melyik zaszlo all igazra.
 *
 * Ures halmaznal SZOVEGET ad ("nincs korlatozas"), nem ures sztringet: egy ures
 * sor a jelentesben ugy nez ki, mintha a meres maradt volna el.
 */
export function describeShippingFlags(flags: MedusaShippingFlags): string {
  const igazak = [
    flags.pickup_only ? "csak bolti átvétel" : null,
    flags.foxpost_forbidden ? "Foxpost tiltva" : null,
    flags.is_heavy ? "nehéz áru" : null,
    flags.is_frozen ? "fagyasztott" : null,
  ].filter((x): x is string => x !== null);
  return igazak.length ? igazak.join(", ") : "nincs korlátozás";
}
