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
 * A masik repoban allo lista NEM oszthato meg konstanskent. A szerzodest ezert
 * ki kell MONDANI: ha ez a harom nev valaha valtozik, a kirakat oldalan is
 * valtozik, es a ket helyet EGYUTT kell atirni.
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
