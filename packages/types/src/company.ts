/**
 * A CÉG SAJÁT AZONOSSÁGA, EGY HELYEN (Hiányzó számlák, brief 4. pont: „Ne szórd
 * szét a 23916229 adószámot több fájlban hardcode-olva”). Egy számla csak akkor
 * számít megtaláltnak, ha erre a cégre szól.
 */
export const ACROPORA_COMPANY = {
  name: "Acropora Kft.",
  /** Az adószám törzsszáma (az első nyolc számjegy). */
  taxNumberBase: "23916229",
} as const;
