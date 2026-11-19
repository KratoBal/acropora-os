/// A NAV Online Számla queryTaxpayer válaszának, a mi vevőfelvételi
/// űrlapunkhoz szükséges mezőkre leegyszerűsített vetülete. A NAV nyers
/// válasza (taxpayerName, taxNumberDetail, taxpayerAddressList, stb.) nem
/// kerül ki a frontendre változatlanul - csak azok a mezők, amik a Customer
/// létrehozó űrlap kitöltéséhez kellenek.
export interface NavTaxpayerAddress {
  postalCode: string;
  city: string;
  /** Utca/közterület neve, jellege és házszám összefűzve, pl. "Záhony utca 7." */
  line1: string;
  country: string;
}

export interface NavTaxpayerLookupResult {
  /** false: az adószám nem érvényes/nem létezik NAV szerint - nincs data. */
  valid: boolean;
  /**
   * A NAV válasza nem mondta ki egyértelműen, hogy az adószám érvényes vagy sem (a `taxpayerValidity` elem hiányzott vagy más
   * értéket hordozott). `valid` ilyenkor false, de ez NEM "nincs ilyen adószám": aki a létezésre épít (a rendelés számla-kapuja),
   * ezt "nem tudjuk"-nak veszi.
   */
  validityUnknown?: boolean;
  data: {
    name: string;
    /** Teljes formátumú adószám, pl. "12345678-1-42", ha a NAV visszaadta a vatCode/countyCode részleteket is. */
    taxNumber: string;
    /** A székhely (HQ) cím, ha szerepel a NAV válaszban. */
    address: NavTaxpayerAddress | null;
  } | null;
}
