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

/**
 * A NÉVVEL EGYEZŐ PARTNER ADÓSZÁMA, HA A VEVŐ-SORNAK NINCS (kártya aaf4f09d; Luca,
 * 2026-11-04 13:53 UTC). Ugyanaz az eset, mint fent: a számlán a régi vevő-sort
 * választják (a tükör a Vevők listáján nem szerepel), a sor adószám nélkül áll, a
 * partnerénél pedig megvan. A párosítás itt CSAK név szerint megy (a vevőnek nincs
 * adószáma, amihez mérni lehetne); ha több partner egyezik és más-más adószám-alapot
 * mondanak, nem döntünk. Csak tipp a kapu okához: az adatot semmi nem írja át.
 */
export function partnerTaxNumberFor(
  customer: { displayName: string; companyName: string | null },
  partners: readonly { name: string; taxNumber: string | null }[],
): { partnerName: string; taxNumber: string } | null {
  const names = new Set(
    [customer.companyName, customer.displayName].map(nameKey).filter(Boolean),
  );
  const matches = partners.filter(
    (partner) =>
      Boolean(partner.taxNumber?.trim()) && names.has(nameKey(partner.name)),
  );
  const bases = new Set(matches.map((partner) => taxBase(partner.taxNumber)));
  if (matches.length === 0 || bases.size !== 1) return null;
  return {
    partnerName: matches[0]!.name,
    taxNumber: matches[0]!.taxNumber!.trim(),
  };
}

/**
 * A KÖTÖTT PARTNER ADÓSZÁMA MINT TIPP (40332480, barracuda #2228): ha a vevő-sor egy élő partnerhez van kötve
 * (`Supplier.customerId`) és a partnernek van adószáma, az a tipp, a nevek egyezése nélkül is. A névalapú keresés
 * (`partnerTaxNumberFor`) csak akkor fut, ha nincs ilyen kötés. Ugyanaz a kötés, amelyen a keresés adószám-ága is
 * megy (`searchCustomerIds`), hogy amit a keresés megtalál, annak a részlete is megadja a számot.
 */
export function linkedPartnerTaxHint(
  partner: {
    deletedAt?: Date | null;
    name: string;
    taxNumber: string | null;
  } | null,
): { partnerName: string; taxNumber: string } | null {
  if (!partner || partner.deletedAt || !partner.taxNumber?.trim()) return null;
  return { partnerName: partner.name, taxNumber: partner.taxNumber.trim() };
}
