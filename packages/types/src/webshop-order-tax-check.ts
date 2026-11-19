/**
 * A RENDELÉS ADÓSZÁMÁNAK NAV-ELLENŐRZÉSE (kártya c977aed2, P2): a kirakat pénztára a céges vásárlás adószámát a számlázási cím
 * `metadata.tax_id` kulcsán adja át; az OS a számla kiállítása előtt a NAV-nál nézi meg, létezik-e.
 *
 *   NONE         a rendelésen nincs adószám (magánszemély), vagy közösségi alakú (VIES, nem a NAV-é): nincs mit kérdezni a NAV-tól
 *   MALFORMED    van adószám, de sem érvényes magyar (11 számjegy, ÁFA-kód 1-5, ellenőrző számjegy), sem közösségi alakú: a számla
 *                nem állítható ki. A kirakat pénztára ezt a formát őrzi, de a Medusa kosár-API nyilvános, és a számla az OS-ből megy ki
 *                (barracuda, commerce #805)
 *   VALID        a NAV ismeri; `navName` a NAV szerinti név, `nameMatches` hogy a rendelés cégneve ezzel egyezik-e (null, ha
 *                a rendelésen nincs cégnév vagy a NAV nem adott nevet)
 *   INVALID      a NAV szerint nincs ilyen adószám: a számla nem állítható ki, amíg a rendelés adószámát ki nem javítják
 *   UNAVAILABLE  a NAV most nem válaszolt (kikapcsolt kapcsolat, kiesés): ez NEM mondja, hogy az adószám rossz, és nem is állít meg
 */
export type WebshopOrderTaxCheckState =
  "NONE" | "MALFORMED" | "VALID" | "INVALID" | "UNAVAILABLE";

export interface WebshopOrderTaxCheck {
  state: WebshopOrderTaxCheckState;
  /** Az ellenőrzött adószám, egységesítve ("12345678-1-23"), vagy null. */
  taxNumber: string | null;
  /** A NAV szerinti név, ha VALID és a NAV adott nevet. */
  navName: string | null;
  /** A rendelés cégneve egyezik-e a NAV szerinti névvel; null, ha nem összevethető. */
  nameMatches: boolean | null;
}
