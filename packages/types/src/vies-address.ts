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

/**
 * A postal code at the start of a line, after an optional country prefix
 * (`AT-`, and Luxembourg's one-letter `L-`): an NL letter pair, a CZ/SK space,
 * the PL `00-950` and PT `1000-001` hyphens, or plain digits.
 */
const POSTAL_LINE =
  /^(?:[A-Z]{1,2}-)?(\d{4}\s?[A-Z]{2}|\d{3}\s\d{2}|\d{2}-\d{3}|\d{4}-\d{3}|\d{3,6})\s+(\S.*)$/;

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

/**
 * A COMMUNITY (EU) TAX NUMBER AS IT IS STORED AND SENT: the country prefix
 * and the number, upper case, without spaces, dots or dashes ("sk 2020-123
 * 456" -> "SK2020123456"). Null when it is not that shape: two letters and
 * 2 to 12 letters, digits or the `+`/`*` some member states use.
 */
export function normalizeEuTaxNumber(value: string): string | null {
  const compact = value.replace(/[\s.\-]/g, "").toUpperCase();
  return /^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(compact) ? compact : null;
}

/**
 * THE EU MEMBER STATES' HUNGARIAN NAMES, by ISO code, plus XI (Northern
 * Ireland, which has its own VAT prefix). Számlázz.hu's `<orszag>` is free
 * text (XSD `string`), and the invoice prints it as written, so an EU buyer's
 * country goes as its Hungarian name (acrobot 28300). Greece's VAT prefix is
 * EL; `viesCountry` already turns it into GR.
 */
export const EU_COUNTRY_NAMES_HU: Readonly<Record<string, string>> = {
  AT: "Ausztria",
  BE: "Belgium",
  BG: "Bulgária",
  CY: "Ciprus",
  CZ: "Csehország",
  DE: "Németország",
  DK: "Dánia",
  EE: "Észtország",
  ES: "Spanyolország",
  FI: "Finnország",
  FR: "Franciaország",
  GR: "Görögország",
  HR: "Horvátország",
  HU: "Magyarország",
  IE: "Írország",
  IT: "Olaszország",
  LT: "Litvánia",
  LU: "Luxemburg",
  LV: "Lettország",
  MT: "Málta",
  NL: "Hollandia",
  PL: "Lengyelország",
  PT: "Portugália",
  RO: "Románia",
  SE: "Svédország",
  SI: "Szlovénia",
  SK: "Szlovákia",
  XI: "Észak-Írország",
};

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
    // inner whitespace counts as one space on both sides of the comparison
    const now = clean(current[field] ?? "");
    if (!now) fill[field] = vies;
    else if (now.toLocaleLowerCase("hu") !== vies.toLocaleLowerCase("hu"))
      conflicts.push({ field, current: now, vies });
  }
  return { fill, conflicts };
}
