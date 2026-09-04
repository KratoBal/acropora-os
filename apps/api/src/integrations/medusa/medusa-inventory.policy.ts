import { Prisma } from "@acropora/database";

import {
  availableToSell,
  type StockRowForSale,
} from "../../inventory/available-to-sell.js";

/**
 * Mennyi készletet lát a webshop egy Acropora OS készletsorból, és milyen
 * rendelhetőséggel.
 *
 * KÜLÖN MODUL, HÁLÓZAT NÉLKÜL MÉRHETŐ - a brief 4. pontjának kikötése. A
 * publikációs szabály (`medusa-publication.policy.ts`) ugyanígy áll, és ez a
 * kettő SZÁNDÉKOSAN nem tud egymásról: a brief 4. pontja szerint a publikáció
 * és a készlet külön felelősség, tehát a nulla készlet nem tesz drafttá egy
 * terméket, és a készlet-vetítés nem nyúl sales channelhez.
 *
 * A KÉPLETET NEM ITT ÍRJUK LE: az `availableToSell` az egyetlen helye, és ez a
 * modul csak azt mondja meg, mit kezd a cél oldal az eredménnyel.
 */

/**
 * A rendelhetőség, amit a vetítés BEÁLLÍT - és ez a kör legfontosabb sora.
 *
 * Balázs döntése (2026-08-27 16:02, Discord, szó szerint): „a pozitív készletű
 * termékek kapjanak Raktáron kijelzést akár darabszámmal. A 0 darabszámú
 * termékeknél a Rendelhető kijelzést kapják".
 *
 * A MECHANIZMUS a `ProductVariant.allow_backorder` mező, és az ALAPÉRTELMEZÉSE
 * `false` (mérve a telepített 2.19.0 forrásából: `product-variant.js:17`,
 * illetve az admin validátor `booleanString().optional().default(false)`
 * alakja). Ha igaz, a kosár készlet-ellenőrzése teljesen kimarad
 * (`core-flows/cart/steps/confirm-inventory.js:31`); ha hamis, a hiányra
 * `INSUFFICIENT_INVENTORY` hibát dob.
 *
 * VAGYIS AZ ALAPÉRTELMEZÉS A DÖNTÉS ELLENTÉTE. Ha a vetítés csak a mennyiséget
 * állítaná be, a bolt CSENDBEN az ellenkezőjét csinálná annak, amit a tulajdonos
 * eldöntött - és nem hibaüzenettel, hanem úgy, hogy a terméket egyszerűen nem
 * lehet megvenni. Ezért állítjuk be kifejezetten, minden futásnál, és ezért van
 * rá saját teszt, ami akkor piros, ha a mechanizmus hiányzik.
 *
 * EZ NEM „preorder/backorder feature" (a brief tiltja): nem írunk új mezőt és
 * nem írunk új folyamatot, egy MEGLÉVŐ logikai mező értékét adjuk meg.
 */
export const PROJECTED_ALLOW_BACKORDER = true;

export interface InventoryProjectionDecision {
  /** `onHand - reserved`, ELŐJELESEN. Ez megy a jelentésbe, nem a boltba. */
  availableToSell: Prisma.Decimal;
  /** Amit a Medusának küldünk: nem negatív, egész. */
  medusaQuantity: number;
  /** Igaz, ha az értékesíthető készlet negatív volt, és nullára vágtuk. */
  clamped: boolean;
  /**
   * Igaz, ha az értékesíthető készletnek TÖRT RÉSZE volt, és lefelé vágtuk.
   *
   * Nem üzleti szabály, hanem a cél oldal viselkedésének követése: a Medusa a
   * saját elérhetőség-számításában `Math.floor` műveletet végez
   * (`utils/product/get-variant-availability.js`), tehát 2,7 darabból úgyis 2
   * lenne eladható. Ha nem vágnánk, a jelentés 2,7-et állítana, a bolt pedig
   * 2-t adna el - és a különbség sehol nem látszana.
   */
  fractionDropped: boolean;
  /**
   * Amit a bolt `allow_backorder` mezojebe irunk.
   *
   * ALAPERTELMEZESBEN `true` (lasd `PROJECTED_ALLOW_BACKORDER`), de a hivo
   * felulirhatja: a WYSIWYG termekeknel `false`. A ket eset SZANDEKOSAN ket
   * kulon dontes -- a keszlet-szabaly nem tud a kategoriakrol.
   */
  allowBackorder: boolean;
}

/**
 * A vetítés nem tud továbbmenni, és megmondjuk, miért.
 *
 * Egyetlen ok van ebben a modulban: olyan nagy szám, amit a JSON-számmá
 * alakítás már nem ad vissza pontosan. Az adatbázis `Decimal(19,6)` mezője
 * ennél tágabb, mint a biztonságos egész tartomány, tehát a némán elrontott
 * érték FIZIKAILAG lehetséges - és egy néma készlet-elírás rosszabb, mint egy
 * hangos megállás.
 */
export class MedusaInventoryQuantityError extends Error {}

export function decideInventoryProjection(
  stock: StockRowForSale,
  /**
   * A RENDELHETOSEG, PARAMETERKENT -- es az alapertelmezes a MAI viselkedes.
   *
   * Balazs dontese (2026-09-04): a WYSIWYG termekeknel a rendelhetoseg legyen
   * KIKAPCSOLVA, es a jelolest a KATEGORIA adja. A szabaly a
   * `medusa-wysiwyg.policy.ts` modulban all, mert a KATEGORIA-FA bejarasa
   * onallo dontes, es kulon allitasokkal merheto.
   *
   * MIERT PARAMETER, ES NEM ITT SZAMOLJUK KI: ez a modul egy KESZLETSORT lat,
   * es a kategoriakat nem. Ha a fat ide hoznank, a keszlet-szabaly es a
   * kategoria-szabaly egyetlen fuggvenybe olvadna -- es egy rontas utan nem
   * lehetne megmondani, MELYIK romlott el.
   */
  allowBackorder: boolean = PROJECTED_ALLOW_BACKORDER,
): InventoryProjectionDecision {
  const available = availableToSell(stock);
  const floored = available.floor();
  const clamped = floored.isNegative();
  const quantity = clamped ? new Prisma.Decimal(0) : floored;
  const asNumber = quantity.toNumber();

  if (!Number.isSafeInteger(asNumber))
    throw new MedusaInventoryQuantityError(
      `Az értékesíthető készlet (${available.toString()}) nem ábrázolható ` +
        `pontosan egész számként, ezért nem küldjük el. A Medusa admin API ` +
        `JSON-számot vár, és a pontosságvesztés némán rossz készletet írna.`,
    );

  return {
    availableToSell: available,
    medusaQuantity: asNumber,
    clamped,
    /**
     * A vágás és a törtrész KÉT KÜLÖN sor, mert a teendő is más: a negatív a
     * leltárig szándékolt állapot, a törtrész viszont azt jelenti, hogy a bolt
     * kevesebbet ad el, mint amennyi a nyilvántartásban áll.
     */
    fractionDropped: !clamped && !available.equals(floored),
    allowBackorder,
  };
}
