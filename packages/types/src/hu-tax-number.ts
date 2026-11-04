/**
 * A MAGYAR ADÓSZÁM ALAKJA (vevő szerkesztése, acrobot 42510; Luca 2026-11-04: az állatkert vevő-során az adószámot nem
 * tudta beírni). A szabály egy helyen áll, hogy a felület és az API ugyanazt mondja, és hogy egy félrement szám ne
 * kerüljön a vevő-sorra, ahonnan a számla kapuja (`buyer-tax-number.ts`) és a Számlázz.hu `<adoszam>` mezője olvassa.
 *
 * A tárolt alak a pontozott: `12345678-1-42` (nyolc számjegy törzsszám, egy ÁFA-kód, két számjegy megyekód). Elfogadott
 * bevitel: kötőjellel vagy anélkül, szóközzel, `HU` előtaggal (a magyar szám előtagja nem a közösségi adószám). Az
 * ellenőrzés csak az ALAKOT nézi, nem azt, hogy a szám létezik: azt a NAV-lekérdezés (a felületen) mondja meg.
 */
const HU_TAX_NUMBER = /^(\d{8})-?(\d)-?(\d{2})$/;

/** A magyar adószám a tárolt, pontozott alakban, vagy `null`, ha a bevitel nem ilyen alakú. */
export function normalizeHuTaxNumber(value: string): string | null {
  const compact = value.replace(/\s+/g, "").replace(/^HU(?=\d)/i, "");
  const match = HU_TAX_NUMBER.exec(compact);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** A kezelőnek szóló mondat egy rossz alakú magyar adószámra. */
export const HU_TAX_NUMBER_PROBLEM =
  "A magyar adószám nyolc számjegy, egy számjegy és két számjegy (például 12345678-1-42). Külföldi cégnek a közösségi adószám mezőt töltsd ki.";

/** Üres, ha rendben van (vagy üres a bevitel: az adószám nem kötelező itt), különben a mondat. */
export function huTaxNumberProblem(
  value: string | null | undefined,
): string | null {
  const text = value?.trim();
  if (!text) return null;
  return normalizeHuTaxNumber(text) ? null : HU_TAX_NUMBER_PROBLEM;
}
