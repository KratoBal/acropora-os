import { Prisma } from "@acropora/database";

/**
 * Mit küldünk a Medusának egy Acropora OS árból, és mikor nem küldünk semmit.
 *
 * KÜLÖN MODUL, HÁLÓZAT NÉLKÜL MÉRHETŐ, ugyanúgy, ahogy a készlet
 * (`medusa-inventory.policy.ts`) és a publikáció (`medusa-publication.policy.ts`)
 * szabálya. A döntés itt lakik, a hívás máshol: így a szabály akkor is
 * mérhető, amikor a stage nem elérhető.
 *
 * A KÖR EGY MONDATBAN: az OS a BRUTTÓ árat tárolja (Balázs döntése,
 * 2026-08-29), a bolt pedig a forint árat ADÓVAL NÖVELTNEK veszi (mérve a
 * stage `price_preference` tábláján: a `huf` pénznemre és a forint régióra
 * `is_tax_inclusive` igaz). A két állítás EGYBEVÁG, ezért az összeg
 * VÁLTOZATLANUL megy át. Nincs átváltás, és nincs is rá szükség.
 *
 * AMI EBBŐL KÖVETKEZIK, ÉS AMIÉRT A SZOLGÁLTATÁS KÜLÖN ŐRZI: a helyesség egy
 * OLYAN BEÁLLÍTÁSON áll, ami nem a mi kódunkban van. Ha valaki a boltban
 * átállítja az `is_tax_inclusive` értéket hamisra, a mi bruttó árunk némán
 * nettóvá minősül át, és a vevő TÖBBET fizetne. Ezért a vetítés minden futás
 * előtt visszaolvassa ezt a beállítást, és megáll, ha nem az, amire a
 * helyességünk épül.
 */

/** Amit az Acropora OS tárol. A `ProductVariant` két mezője. */
export interface ProjectablePrice {
  sellingGrossPrice: Prisma.Decimal | null;
  sellingPriceCurrency: string | null;
}

/**
 * A KÖR EGYETLEN TÁMOGATOTT PÉNZNEME.
 *
 * A brief 4. pontja egy pénznemre szűkíti ezt a kört, a 17. pont pedig
 * kifejezetten kizárja a többpénznemű rendszert. A név ezért konstans és nem
 * beállítás: egy beállítható pénznem azt ígérné, hogy a többi is működik.
 */
export const SUPPORTED_CURRENCY = "HUF";

/**
 * Amit a Medusának küldünk. Kisbetűs, mert a Medusa így tárolja.
 *
 * MÉRVE, hogy a kis- és nagybetű NEM hibaforrás: a `normalizeCurrencyCode`
 * minden bejövő pénznem-kódot kisbetűsít, és az ár-egyezés kiszámítása
 * (`hashPrice`) is ezen megy át. Vagyis egy nagybetűs küldés sem hozna létre
 * második sort. Kisbetűsen küldjük, mert az az igaz alak, de erre az esetre
 * NEM írunk tesztet: az a teszt nem tudna elbukni.
 */
export const MEDUSA_CURRENCY_CODE = "huf";

/** Miért nem küldünk árat. Minden ok NEVESÍTETT, és a név adja a teendőt. */
export type PricingRefusal =
  /**
   * Nincs eltárolt ár.
   *
   * A brief 8. pontja szó szerint tiltja, hogy találomra nullát publikáljunk.
   * A hiányzó ár tehát HANGOS megállás, nem alapértelmezés.
   */
  | "price-missing"
  /**
   * Van összeg, de nincs pénznem.
   *
   * Az adatbázis `CHECK` feltétele ezt tiltja, tehát MA nem állhat elő. Azért
   * van mégis neve, mert ez a modul TISZTA FÜGGVÉNY: hívható olyan bemenettel
   * is, ami nem az adatbázisból jön (import közbeni ellenőrzés, teszt), és egy
   * ilyen hívásra a néma továbbengedés rosszabb lenne, mint a megállás.
   */
  | "currency-missing"
  /** A tárolt pénznem nem az, amit ez a kör támogat. */
  | "currency-not-supported"
  /**
   * Nulla forintos ár.
   *
   * MEGÁLLÁS, nem küldés, és ez ÁLLÍTÁS. Hogy egy nulla forintos termék
   * üzletileg mit jelent (ingyenes, vagy „még nincs beárazva"), az a brief 8.
   * pontja szerint is DÖNTÉST igényel, és a döntés nincs meg. A tárolást
   * ezért az adatbázis megengedi, a vetítés viszont nem csinál belőle csendben
   * ingyenes terméket. Ha megjön a döntés, ez egy ág.
   */
  | "price-zero-needs-decision"
  /**
   * Negatív ár.
   *
   * Az adatbázis `CHECK` feltétele ezt is tiltja, ugyanazzal az indoklással,
   * mint a hiányzó pénznemnél: a tiszta függvény akkor is helyesen kell hogy
   * viselkedjen, ha a bemenet nem onnan jön.
   */
  | "price-negative"
  /**
   * Tört forint.
   *
   * A tárolt oszlop `Decimal(19,4)`, tehát a tört rész FIZIKAILAG lehetséges.
   * A Medusa a forintot nulla tizedessel tartja (`decimal_digits: 0`).
   * Kerekíteni KELLENE, de a brief 9. pontja tiltja a rejtett kerekítést, a
   * 16. pont 6. kapuja pedig kimondja, hogy ha a kerekítés szabálya nem
   * egyértelmű, meg kell állni. Nincs ilyen szabály, tehát megállunk.
   *
   * EZ NEM ÖRÖKRE SZÓL: ha Balázs kimondja a szabályt, az ide kerül, egy
   * helyre, néven nevezve. Amíg nincs, egy hallgatólagos `Math.round` azt
   * jelentené, hogy a kerekítés szabályát a kód találta ki.
   */
  | "price-not-whole-forint";

export type PricingDecision =
  | {
      send: true;
      /** A Medusának küldött szám. Egész forint, átváltás nélkül. */
      amount: number;
      currencyCode: typeof MEDUSA_CURRENCY_CODE;
    }
  | { send: false; reason: PricingRefusal; details: string };

export function decidePricingProjection(
  price: ProjectablePrice,
): PricingDecision {
  const refuse = (
    reason: PricingRefusal,
    details: string,
  ): PricingDecision => ({ send: false, reason, details });

  if (price.sellingGrossPrice === null)
    return refuse(
      "price-missing",
      "nincs eltárolt bruttó eladási ár. NEM küldünk nullát: a hiányzó ár " +
        "nem ingyenes termék, hanem beáratlan termék.",
    );

  if (price.sellingPriceCurrency === null)
    return refuse(
      "currency-missing",
      "van eltárolt összeg, de nincs mellette pénznem. Ez az állapot az " +
        "adatbázisban tiltott, tehát ha mégis előáll, a bemenet nem onnan jött.",
    );

  if (price.sellingPriceCurrency !== SUPPORTED_CURRENCY)
    return refuse(
      "currency-not-supported",
      `a tárolt pénznem ${price.sellingPriceCurrency}, ez a kör viszont ` +
        `kizárólag ${SUPPORTED_CURRENCY} árat vetít. Nem számoljuk át: az ` +
        `árfolyam üzleti kérdés, nem vetítési részlet.`,
    );

  const amount = price.sellingGrossPrice;

  if (amount.isNegative())
    return refuse(
      "price-negative",
      `a tárolt ár negatív (${amount.toString()}). Ez adathiba, nem üzleti ` +
        `állapot, és az adatbázis is tiltja.`,
    );

  if (!amount.equals(amount.floor()))
    return refuse(
      "price-not-whole-forint",
      `a tárolt ár tört forintot tartalmaz (${amount.toString()}). A Medusa a ` +
        `forintot egész értékkel tartja, tehát kerekíteni kellene - de a ` +
        `kerekítés szabálya nincs kimondva, és nem a kód találja ki.`,
    );

  if (amount.isZero())
    return refuse(
      "price-zero-needs-decision",
      "a tárolt ár nulla forint. Hogy ez ingyenes terméket jelent-e vagy " +
        "beáratlant, üzleti döntés, és nincs meg. Nem publikálunk ingyenes " +
        "terméket egy hiányzó döntés alapján.",
    );

  const asNumber = amount.toNumber();

  /**
   * A JSON-szám határa, ugyanaz az őrző, mint a készlet-vetítésben.
   *
   * A `Decimal(19,4)` oszlop TÁGABB, mint a biztonságos egész tartomány, tehát
   * a némán elrontott érték fizikailag lehetséges. Egy néma ár-elírás rosszabb,
   * mint egy hangos megállás - és árnál rosszabb, mint készletnél.
   */
  if (!Number.isSafeInteger(asNumber))
    return refuse(
      "price-not-whole-forint",
      `a tárolt ár (${amount.toString()}) nem ábrázolható pontosan egész ` +
        `számként, ezért nem küldjük el. A Medusa admin API JSON-számot vár, ` +
        `és a pontosságvesztés némán rossz árat írna.`,
    );

  return { send: true, amount: asNumber, currencyCode: MEDUSA_CURRENCY_CODE };
}
