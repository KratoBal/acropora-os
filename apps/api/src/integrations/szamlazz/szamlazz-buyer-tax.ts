/**
 * A VEVŐ ADÓSZÁM-SZABÁLYA (kártya aaf4f09d): a szabály a `@acropora/types`
 * `buyer-tax-number` moduljában áll, hogy a felület és az API ugyanazt mondja. Itt
 * csak az XML-építő hibája él, és az onnan átvett nevek, hogy a Számlázz.hu-oldal
 * egy helyről importáljon.
 */
export {
  buyerNeedsTaxNumber,
  buyerTaxNumberProblem,
  looksLikeOrganization,
  ORGANIZATION_NAME_MARKERS,
  type BuyerTaxSubject,
} from "@acropora/types";

/** Az XML-építő hibája: a végső kapu, ha egy hívó korábban nem állt meg. */
export class SzamlazzBuyerTaxNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SzamlazzBuyerTaxNumberError";
  }
}
