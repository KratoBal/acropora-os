/**
 * A CÉG SAJÁT AZONOSSÁGA, EGY HELYEN (Hiányzó számlák, brief 4. pont: „Ne szórd
 * szét a 23916229 adószámot több fájlban hardcode-olva”). Egy számla csak akkor
 * számít megtaláltnak, ha erre a cégre szól.
 */
export const ACROPORA_COMPANY = {
  name: "Acropora Kft.",
  /** Az adószám törzsszáma (az első nyolc számjegy). */
  taxNumberBase: "23916229",
  /** A székhely, ahogy a kimenő dokumentumokon áll (Balázs, 2026-10-08). */
  address: "1106 Budapest, Pesti Gábor utca 35",
  phone: "+36-20-2676801",
  email: "info@acropora.hu",
  web: "www.acropora.hu",
} as const;

/**
 * A KIMENŐ AJÁNLAT LÁBLÉCE, Balázs szavaival (2026-10-08 08:14): a cégadat,
 * utána a dokumentum azonosítója.
 */
export function acroporaFooterLine(documentRef: string): string {
  const c = ACROPORA_COMPANY;
  return `${c.name} ${c.address} Tel: ${c.phone} e-mail: ${c.email} ${c.web} · ${documentRef}`;
}
