/**
 * A VEVŐ-SOR FIZETÉSI NAPJAI, HA A SOR MAGA ÜRES (kártya 7be4a85b).
 *
 * Mérve 2026-10-06 élesen: a Fővárosi Állat- és Növénykert KÉT vevő-soron áll.
 * A régi vevő-sor (VEVO-...-AE9D) napjai üresek, a szervizpartner tükre
 * (PARTNER-...-D7E3) a Partnerek oldalon beállított 30 napot viseli
 * (`syncWorksheetMirror`). A számlán a régi sort választották, és a
 * szerkesztő ezért a 8 napos alapértéket adta volna.
 *
 * A párosítás: azonos adószám-alap (az első nyolc számjegy), vagy ha valamelyik
 * oldalon nincs adószám, azonos név (kis- és nagybetű, írásjel és szóköz
 * nélkül). Ha több partner egyezik és más-más napot mondanak, nem döntünk.
 */
export interface PartnerPaymentTerms {
  name: string;
  taxNumber: string | null;
  paymentDueDays: number;
}

const taxBase = (value: string | null | undefined) =>
  (value ?? "").replace(/^HU/i, "").replace(/\D/g, "").slice(0, 8);

const nameKey = (value: string | null | undefined) =>
  (value ?? "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "");

export function partnerTermsFor(
  customer: {
    displayName: string;
    companyName: string | null;
    taxNumber: string | null;
  },
  partners: readonly PartnerPaymentTerms[],
): { paymentDueDays: number; partnerName: string } | null {
  const tax = taxBase(customer.taxNumber);
  const names = new Set(
    [customer.companyName, customer.displayName].map(nameKey).filter(Boolean),
  );
  const matches = partners.filter((partner) => {
    const partnerTax = taxBase(partner.taxNumber);
    if (tax.length === 8 && partnerTax.length === 8) return tax === partnerTax;
    return names.has(nameKey(partner.name));
  });
  const days = new Set(matches.map((partner) => partner.paymentDueDays));
  if (days.size !== 1) return null;
  return {
    paymentDueDays: matches[0]!.paymentDueDays,
    partnerName: matches[0]!.name,
  };
}
