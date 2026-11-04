/**
 * CÉGNEK ADÓSZÁM NÉLKÜL NEM ÁLLÍTUNK KI SZÁMLÁT (Balázs, 2026-11-04 11:43-11:46
 * UTC: „Az összes számlánk, ami az állatkertnek ment ki a rendszerből, adószám
 * nélkül ment ki", és „azt se értem, egy számlánál miért nem ellenőrizzük ezt le").
 *
 * A Számlázz.hu az adószám nélküli céges vevőt is elfogadja (az XML az
 * `<adoszam>`-ot csak akkor írja, ha van), tehát a hiány a kiállításig néma, és
 * utána a NAV-jelentésben magánszemélynek látszó cég áll. A kapu ezért a
 * kiállítás ELŐTT áll, minden úton, ami a vevő rekordjából számláz: a
 * bizonylat-kiállítás és -előnézet (`billing-document-issue.service.ts`,
 * `billing-document-preview.service.ts`) és a karbantartási számla
 * (`maintenance-invoice-draft.service.ts`). A magánszemély vevő (PERSON)
 * változatlanul adószám nélkül megy.
 *
 * A már elindított, beragadt kiállítás feloldása (`billing-issuing-resolution`)
 * SZÁNDÉKOSAN nem kapuz: ott a bizonylat a Számlázz.hu-n már létezhet, és a
 * feladat a rögzítése, nem egy új kiállítás.
 */
export function companyBuyerTaxNumberProblem(customer: {
  type: string;
  displayName: string;
  companyName?: string | null;
  taxNumber?: string | null;
  euTaxNumber?: string | null;
}): string | null {
  if (customer.type !== "COMPANY") return null;
  if (customer.taxNumber?.trim() || customer.euTaxNumber?.trim()) return null;
  const name = customer.companyName?.trim() || customer.displayName;
  return `A vevőnek nincs adószáma: ${name} cég, de sem magyar, sem közösségi adószám nincs megadva. Egészítsd ki a partnernél, cégnek adószám nélkül nem állítunk ki számlát.`;
}
