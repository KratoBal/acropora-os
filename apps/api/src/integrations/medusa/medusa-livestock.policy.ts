import {
  subtreeIdsByNames,
  type WysiwygCategoryNode,
} from "./medusa-wysiwyg.policy.js";

/**
 * AZ ELO ALLAT SZALLITASI KORLATJA: SZARMAZTATOTT ERTEK, NEM KEZI JELOLES.
 *
 * === BALAZS SZABALYA, ES AMIERT NEM KEZZEL JELOLJUK ===
 *
 * Ha a kosarban elo allat van, az EGESZ rendelest a boltban adjuk at
 * (2026-08-31). A jelolest a KATEGORIA adja, nem egy nevsor: a harom elo allat
 * gyoker ala eso minden termek `pickupOnly`.
 *
 * Kezi jelolessel ez ma 206 termek egyenkenti megjelolese lenne, es egy
 * elfelejtett jeloles NEM HANGOS: a termek postara kerul, es egy allat pusztul
 * el. A szarmaztatott ertek nem tud elfelejtodni. (acrobot dontese,
 * 2026-09-07, ugyanazzal az indokkal, amivel a LIVESTOCK termek-tipust
 * elvetettuk: ne legyen negyedik igazsag-forras.)
 *
 * === ES AMI KEZI MARAD, ES HELYESEN ===
 *
 * Az `isHeavy` es az `isFrozen` NEM vezetheto le a kategoriabol, es a hianyuk
 * sem eletveszelyes: egy nehez csomag rossz szallitasi modja kellemetlenseg,
 * nem allatpusztulas. Azok maradnak a kezzel kitoltott profil-soron.
 *
 * === EGY FORRAS, HAROM FOGYASZTO ===
 *
 * Ugyanezt a jelet nezi a kirakat sotet-vilagos valtoja (`vilag-valto.ts`,
 * masik repoban) es -- masik neven -- a WYSIWYG szabaly. A NEVEK itt allnak
 * egy helyen; a bejaras a `subtreeIdsByNames` fuggvenyben, kozosen.
 *
 *
 * === HOL LAKIK MEG UGYANEZ A KERDES: NEGY HELY, KET REPO ===
 *
 * Az "elo allat-e ez a termek" (es a rokona, az "egyedi darab-e") kerdesre MA
 * NEGY kulonbozo szabaly valaszol, ket kulon repoban. Kozos konstanst nem lehet
 * megosztani kozottuk, ezert a szerzodes CSAK KIMONDVA letezik:
 *
 *   acropora-os / medusa-wysiwyg.policy.ts
 *       a "WYSIWYG" kategoria RESZFAJA -> egyedi darab (rendelhetoseg, jelzo)
 *
 *   acropora-os / medusa-livestock.policy.ts
 *       a HAROM ELO ALLAT GYOKER (Korallok, Halak, Gerinctelenek)
 *       -> bolti atvetel (pickup_only)
 *
 *   acropora-commerce / modules/products/components/lap-vaz/vilag-valto.ts
 *       UGYANAZ A HAROM NEV -> a kirakat sotet-vilagos valtoja
 *
 *   acropora-commerce / workflows/utils/livestock.ts
 *       termek-TIPUS azonositok egy kornyezeti valtozobol (MA URES)
 *       -> a szallitasi osztaly livestock-aga
 *
 * A KETTO, AMI EGYUTT MOZOG: a masodik es a harmadik UGYANAZT a harom nevet
 * tartalmazza, ket kulon repoban. Ha az egyik valtozik, a masikat AT KELL
 * NEZNI -- kulonben az egyik oldal mar elo allatnak tart valamit, amit a masik
 * nem, es a kulonbseg sehol nem hasal el.
 *
 * (acrobot kerese, 2026-09-07: "ma senki nem tudja, hogy harom van". Negy van.)
 */
export const LIVE_ANIMAL_ROOT_NAMES = [
  "Korallok",
  "Halak",
  "Gerinctelenek",
] as const;

/** A harom elo allat gyoker teljes reszfaja. */
export function liveAnimalSubtreeIds(
  categories: readonly WysiwygCategoryNode[],
): Set<string> {
  return subtreeIdsByNames(categories, LIVE_ANIMAL_ROOT_NAMES);
}

/**
 * KOTELEZO-E A BOLTI ATVETEL EZ ALAPJAN.
 *
 * MINDEN BESOROLAS SZAMIT, az elsodleges es az alternativ egyarant -- ugyanaz a
 * mérce, mint a WYSIWYG szabalynal, es ugyanabbol az okbol: ott a hat termekbol
 * NEGYNEL csak alternativ besorolaskent allt a kategoria.
 */
export function derivePickupOnly(
  productCategoryIds: readonly string[],
  liveAnimalIds: ReadonlySet<string>,
): boolean {
  return productCategoryIds.some((id) => liveAnimalIds.has(id));
}
