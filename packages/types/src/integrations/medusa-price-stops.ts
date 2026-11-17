/**
 * A TÁROLT ÁR-MEGÁLLÁSOK LISTÁJA, ahogy az API kiadja (`GET health/medusa-price-stops`), és ahogy a felület megjeleníti (task
 * t-20261117-arstop-lista és -web; acrobot 55208).
 *
 * A vetítő ár-fele minden elbukott termékre eltárolja az okot (`recordPriceAttempt`), és a #2665 óta az EMBERI ADAT-ÁLLAPOT nem teszi
 * FAILED-dé a kört: ez a lista mondja meg, MELYIK termékről van szó. Csak olvasható nézet: a felület nem javít, nem ír vissza.
 */

/** Egy megállási fajta, és hogy EMBERnek kell-e cselekednie (a futási hiba magától újrapróbál). */
export interface MedusaPriceStopKindView {
  /** a szerver fajtaneve (`own-price-missing`, `price-not-whole-forint`, ...; `truncated`, ha a vágott ok fajtája nem olvasható) */
  kind: string;
  /** igaz az emberi adat-állapotra, hamis a futási hibára (az ismeretlen fajta futási hibának számít) */
  needsPerson: boolean;
}

export interface MedusaPriceStopView {
  productId: string;
  /** a termék változatainak cikkszámai (a cikkszám a változaton áll, nem a terméken); üres, ha a termék sora már nincs meg */
  skus: string[];
  /** null, ha a termék sora már nincs meg (a hivatkozás túlélte) */
  name: string | null;
  /** a megállás ideje, ISO */
  failedAt: string;
  kinds: MedusaPriceStopKindView[];
  /** a tárolt üzenetek egyenként (a rögzítés 300 karakternél vág) */
  reasons: string[];
  /** a tárolt ok elérte a vágást: az utolsó üzenet vége levágódhatott, és a fajtája ilyenkor `truncated` */
  reasonCut: boolean;
}

export interface MedusaPriceStopsView {
  /** az összes tárolt megállás, nem csak a mutatott oldal */
  total: number;
  /** ezek közül hány vár emberi döntésre */
  needingPerson: number;
  /** igaz, ha a lista vágott (az emberi munka elöl marad) */
  truncated: boolean;
  stops: MedusaPriceStopView[];
}
