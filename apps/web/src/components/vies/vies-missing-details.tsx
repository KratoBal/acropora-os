import { viesCountry, type ViesVatLookupResult } from "@acropora/types";

import { COUNTRY_OPTIONS } from "@/components/customers/country-options";

/**
 * A VALID NUMBER WITHOUT A NAME OR AN ADDRESS (Balázs on the live site,
 * 2026-10-08, DE300632593): some member states (Germany among them) answer
 * VIES with `valid` only. The green badge then looked like a fill that did not
 * happen; this line says why the fields stay empty and who fills them.
 */
export function viesMissingDetailsText(
  taxNumber: string,
  result: ViesVatLookupResult | null,
): string | null {
  if (!result?.valid || result.name || result.address) return null;
  const code = viesCountry(taxNumber);
  const country =
    COUNTRY_OPTIONS.find((c) => c.code === code)?.label ?? code ?? "tagállam";
  return `A(z) ${country} adóhatósága a VIES-ben nem adja ki a nevet és a címet, ezeket kézzel kell megadni.`;
}

export function ViesMissingDetails({
  taxNumber,
  result,
}: {
  taxNumber: string;
  result: ViesVatLookupResult | null;
}) {
  const text = viesMissingDetailsText(taxNumber, result);
  return text ? <p className="mt-1 text-xs text-amber-700">{text}</p> : null;
}
