/// Az EU hivatalos VIES (VAT Information Exchange System) REST
/// szolgáltatásának ellenőrzési eredménye, a saját Partnerek/Beszerzés
/// űrlapjainkhoz szükséges mezőkre egyszerűsítve.
export interface ViesVatLookupResult {
  /**
   * true/false, ha sikerült elvégezni az ellenőrzést és a VIES egyértelmű
   * választ adott; `undefined`, ha ez nem állapítható meg (pl. a formátum
   * nem EU-s közösségi adószám, vagy a szolgáltatás nem érhető el) - ilyenkor
   * a `message` mező tartalmazza a felhasználónak mutatandó magyarázatot.
   */
  valid?: boolean;
  /** A VIES-ben nyilvántartott cégnév, ha a tagállam visszaadja (sok tagállam nem). */
  name?: string;
  /** A VIES-ben nyilvántartott székhelycím, ha a tagállam visszaadja. */
  address?: string;
  message?: string;
}
