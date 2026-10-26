/**
 * A customer created at an aquarium may hold an address with blank parts (os-ugyfel-akvarium-hianyos), so
 * every document that PRINTS or SENDS the address checks it first. The labels are the ones the billing
 * document issue shows.
 */
export function missingAddressParts(address: {
  postalCode?: string | null;
  city?: string | null;
  line1?: string | null;
}): string[] {
  return [
    ["irányítószám", address.postalCode],
    ["város", address.city],
    ["utca, házszám", address.line1],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([label]) => label!);
}
