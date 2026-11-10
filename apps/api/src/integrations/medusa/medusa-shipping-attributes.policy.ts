import type { LivestockKind } from "./medusa-livestock.policy.js";

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
  /**
   * Csomagautomatába nem fér (a82ed229, PR 3 C3). OPCIONÁLIS, mert a UNAS nem
   * ismeri: a UNAS-ból számolt profilban nincs, és a hiánya nem korlátozás.
   */
  lockerUnsuitable?: boolean;
}

/** Amit a bolt admin vegpontja var. */
export interface MedusaShippingFlags {
  pickup_only: boolean;
  foxpost_forbidden: boolean;
  is_heavy: boolean;
  is_frozen: boolean;
  /** commerce #677 óta; egy régebbi bolt nem adja vissza, és ott a hiánya hamis */
  locker_unsuitable?: boolean;
  /**
   * Az elo allat fajtaja (commerce V2.6): a kategoria-fabol szarmaztatott, a
   * profil-sor nem tarolja. Egy regebbi bolt nem adja vissza, es ott a hianya
   * NEM "nincs fajta", csak azt jelenti, hogy a bolt meg nem ismeri.
   */
  livestock_kind?: LivestockKind | null;
}

export function shippingFlagsFromProfile(
  profile: OsShippingProfile,
  livestockKind: LivestockKind | null = null,
): MedusaShippingFlags {
  return {
    pickup_only: profile.pickupOnly,
    foxpost_forbidden: profile.foxpostForbidden,
    is_heavy: profile.isHeavy,
    is_frozen: profile.isFrozen,
    locker_unsuitable: profile.lockerUnsuitable ?? false,
    livestock_kind: livestockKind,
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
    current.is_frozen !== wanted.is_frozen ||
    (current.locker_unsuitable ?? false) !==
      (wanted.locker_unsuitable ?? false) ||
    (current.livestock_kind ?? null) !== (wanted.livestock_kind ?? null)
  );
}

const LIVESTOCK_KIND_LABEL: Record<LivestockKind, string> = {
  FISH: "hal",
  INVERTEBRATE: "gerinctelen",
  CORAL: "korall",
};

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
    flags.locker_unsuitable ? "csomagautomatába nem fér" : null,
    flags.livestock_kind
      ? `élő állat: ${LIVESTOCK_KIND_LABEL[flags.livestock_kind]}`
      : null,
  ].filter((x): x is string => x !== null);
  return igazak.length ? igazak.join(", ") : "nincs korlátozás";
}

/**
 * A BOLTBAN MARADT ELO ALLAT FAJTA (V2.6 S1b koveto, kartya 4b30b373).
 *
 * Egy termek, ami kikerult a harom elo allat kategoriabol, es nincs szallitasi-jellemzo sora, nem celpontja a
 * parancsnak (a celok a profil-sorok es az elo allat besorolasok), ezert a boltban a regi `livestock_kind` marad, es
 * a vevoi level rossz akklimatizacios utmutatot adna. A bolt sora, amin fajta all, ezzel a szuressel jelolt.
 */
export function rowsCarryingKind<
  T extends { livestock_kind?: LivestockKind | null },
>(rows: readonly T[]): T[] {
  return rows.filter((row) => (row.livestock_kind ?? null) !== null);
}

/**
 * A bolti sor zaszloi VALTOZATLANUL, csak a fajta nelkul. A tobbi zaszlo nem az OS dontese ezen a termeken (nincs
 * profil-sora), tehat nem nyulunk hozzajuk: a kikuldes az ELTAROLT ertekeket kuldi vissza.
 */
export function flagsWithoutKind(
  row: MedusaShippingFlags,
): MedusaShippingFlags {
  return {
    pickup_only: row.pickup_only,
    foxpost_forbidden: row.foxpost_forbidden,
    is_heavy: row.is_heavy,
    is_frozen: row.is_frozen,
    locker_unsuitable: row.locker_unsuitable ?? false,
    livestock_kind: null,
  };
}
