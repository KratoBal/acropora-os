/**
 * EGY LEKERDEZESI PARAMETER BOOLEAN ALAKJA -- ES A ROSSZ MEGOLDAS NEMA.
 *
 * A lekerdezesi sorban MINDEN ertek szoveg. A kezenfekvo alak
 * (`@Type(() => Boolean)`) ezen a szovegen `Boolean(...)`-t hiv, ami MINDEN nem
 * ures szovegre igaz -- tehat a `?flag=false` es a `?flag=0` egyarant IGAZAT ad,
 * es a validacio hibatlannak latja. Merve a sajat DTO-mon, 2026-09-16:
 *
 *     "true"  -> true    0 hiba
 *     "false" -> true    0 hiba     <- EZ a csapda
 *     "0"     -> true    0 hiba
 *     ""      -> false   0 hiba
 *
 * A kar iranya a rosszabbik: a hivo azt keri, hogy NE, es a valasz megis a
 * bovebb halmazt adja. Egy "ne mutasd a kivezetetteket" keres utan a kezelo a
 * kivezetetteket is latna -- es semmi nem szolna rola.
 *
 * ES EZ A FUGGVENY NEM UJ MINTA: betu szerint ez allt a
 * `product-list-query.dto.ts` belsejeben, sajat peldanykent. Egy masodik
 * peldany kulon romlana el, ezert az a DTO mostantol EZT hivja.
 */
export function optionalQueryBoolean(value: unknown): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  /**
   * AMI NEM A KET ISMERT SZOVEG, AZ VALTOZATLANUL MEGY TOVABB, es ez szandekos:
   * a `@IsBoolean()` dolga megmondani, hogy rossz. Ha itt esnenk vissza
   * `false`-ra, egy elgepelt `?flag=ture` CSENDBEN "nem"-et jelentene, ahelyett
   * hogy 400-at adna.
   */
  return value;
}
