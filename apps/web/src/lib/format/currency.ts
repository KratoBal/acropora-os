/**
 * A PÉNZNEM FELIRATA A KÉPERNYŐN (UI-áttekintés, 4. csomag, 2026-11-03). A forint felirata
 * mindenhol "Ft" (a számlázás, a webshop, a POS így írja); a beszerzés listái eddig a "HUF"
 * ISO-kódot írták mellé. Más pénznemnél a kód a felirat (EUR, USD).
 *
 * A szabály 2026-11-03 óta a közös pénz- és számformázóban él (`@acropora/types`,
 * `number-format.ts`); ez a modul a meglévő importokat szolgálja ki.
 */
export { currencyLabel } from "@acropora/types";
