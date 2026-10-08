/**
 * THE VIES ANSWER AS FORM FIELDS (card 600575a0).
 *
 * VIES gives the address as ONE string with `\n` line breaks, in each member
 * state's own shape (measured on stage 2026-10-07,
 * exchange/vies/vies-nyers-stage-2026-10-07.json):
 *
 *   IE  "3RD FLOOR, GORDON HOUSE, BARROW STREET, DUBLIN 4"   one line, no code
 *   NL  "VOLDERSGRACHT 00001\n2611ET DELFT"                  zero-padded number
 *   AT  "Europastraße 3\nAT-5020 Salzburg"                   country prefix
 *   CZ  "tř. Václava Klementa 869\nMLADÁ BOLESLAV II\n293 01  MLADÁ BOLESLAV 1"
 *
 * The rule: the LAST line is split into postal code and city only when it
 * starts with a postal code; the lines before it are the street. A one-line
 * address is kept whole as the street, with no guessed code or city.
 */
export interface ViesAddressFields {
  addressLine1: string;
  postalCode: string;
  city: string;
}

/** A postal code at the start of a line: digits, an NL letter pair, a CZ/SK space. */
const POSTAL_LINE =
  /^(?:[A-Z]{2}-)?(\d{4}\s?[A-Z]{2}|\d{3}\s\d{2}|\d{3,6})\s+(\S.*)$/;

const clean = (line: string) => line.replace(/\s+/g, " ").trim();

/** "VOLDERSGRACHT 00001" -> "VOLDERSGRACHT 1": NL pads the house number. */
const unpadHouseNumber = (line: string) =>
  line.replace(/\b0+(\d+)\b/g, (whole, digits: string) =>
    whole.length >= 4 ? digits : whole,
  );

export function splitViesAddress(address: string): ViesAddressFields {
  const lines = address.split("\n").map(clean).filter(Boolean);
  if (!lines.length) return { addressLine1: "", postalCode: "", city: "" };
  const last = lines.length > 1 ? POSTAL_LINE.exec(lines.at(-1)!) : null;
  if (!last)
    return {
      addressLine1: lines.map(unpadHouseNumber).join(", "),
      postalCode: "",
      city: "",
    };
  return {
    addressLine1: lines.slice(0, -1).map(unpadHouseNumber).join(", "),
    postalCode: last[1]!,
    city: last[2]!,
  };
}

/** The ISO country of a VIES prefix (VIES writes Greece as EL). */
export function viesCountry(taxNumber: string): string | null {
  const prefix = taxNumber.trim().slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(prefix)) return null;
  return prefix === "EL" ? "GR" : prefix;
}

export type ViesFillField = "name" | "country" | keyof ViesAddressFields;

/**
 * What VIES would put in each field, and what that means for the form:
 * an EMPTY field is filled, a field already holding the same value is left,
 * and a field holding ANOTHER value is a conflict: it is never overwritten
 * without the user asking for it.
 */
export function viesFill(
  current: Partial<Record<ViesFillField, string>>,
  answer: { name?: string; address?: string; taxNumber: string },
): {
  fill: Partial<Record<ViesFillField, string>>;
  conflicts: Array<{ field: ViesFillField; current: string; vies: string }>;
} {
  const proposed: Partial<Record<ViesFillField, string>> = {};
  if (answer.name?.trim()) proposed.name = clean(answer.name);
  const country = viesCountry(answer.taxNumber);
  if (country) proposed.country = country;
  if (answer.address?.trim()) {
    const parts = splitViesAddress(answer.address);
    for (const key of ["addressLine1", "postalCode", "city"] as const)
      if (parts[key]) proposed[key] = parts[key];
  }
  const fill: Partial<Record<ViesFillField, string>> = {};
  const conflicts: Array<{
    field: ViesFillField;
    current: string;
    vies: string;
  }> = [];
  for (const [field, vies] of Object.entries(proposed) as Array<
    [ViesFillField, string]
  >) {
    if (!(field in current)) continue;
    const now = (current[field] ?? "").trim();
    if (!now) fill[field] = vies;
    else if (now.toLocaleLowerCase("hu") !== vies.toLocaleLowerCase("hu"))
      conflicts.push({ field, current: now, vies });
  }
  return { fill, conflicts };
}
