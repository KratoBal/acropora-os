/**
 * A PÉNZNEM FELIRATA A KÉPERNYŐN (UI-áttekintés, 4. csomag, 2026-11-03). A forint felirata
 * mindenhol "Ft" (a számlázás, a webshop, a POS így írja); a beszerzés listái eddig a "HUF"
 * ISO-kódot írták mellé. Más pénznemnél a kód a felirat (EUR, USD).
 */
export function currencyLabel(code: string | null | undefined): string {
  const normalized = (code ?? "").trim().toUpperCase();
  return normalized === "HUF" ? "Ft" : normalized;
}
