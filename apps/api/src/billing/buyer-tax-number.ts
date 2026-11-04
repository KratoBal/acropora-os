import { buyerTaxNumberProblem } from "../integrations/szamlazz/szamlazz-buyer-tax.js";

/**
 * A VEVŐ ADÓSZÁM-KAPUJA A SZOLGÁLTATÁSOKBAN (kártya aaf4f09d): a bizonylat-kiállítás
 * és -előnézet (`billing-document-issue.service.ts`, `billing-document-preview.service.ts`)
 * és a karbantartási számla (`maintenance-invoice-draft.service.ts`) ezzel áll meg a
 * foglalás és a Számlázz.hu-hívás ELŐTT, érthető hibával. A szabály egy helyen áll
 * (`integrations/szamlazz/szamlazz-buyer-tax.ts`), és az XML-építő ugyanazzal a végső
 * kapu, ha egy út itt nem állna meg.
 *
 * A már elindított, beragadt kiállítás feloldása (`billing-issuing-resolution`)
 * SZÁNDÉKOSAN nem kapuz: ott a bizonylat a Számlázz.hu-n már létezhet, és a
 * feladat a rögzítése, nem egy új kiállítás.
 */
export function customerTaxNumberProblem(customer: {
  type?: string | null;
  displayName: string;
  companyName?: string | null;
  taxNumber?: string | null;
  euTaxNumber?: string | null;
  /** a partner, akinek ez a vevő-tükre (`Supplier.customerId`), vagy `null` */
  partner?: { id: string } | null;
}): string | null {
  return buyerTaxNumberProblem({
    name: customer.companyName?.trim() || customer.displayName,
    type: customer.type,
    partnerMirror: Boolean(customer.partner),
    taxNumber: customer.taxNumber,
    euTaxNumber: customer.euTaxNumber,
  });
}
