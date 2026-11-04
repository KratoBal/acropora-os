/**
 * Összeg a pénznem tizedeseivel, pénznem-jel nélkül (a DEVIZA oszlop mondja): a bejövő és a kimenő számlák listája
 * ugyanezt használja, hogy a két lista sorai ugyanúgy olvashatók legyenek (Luca, 2026-11-04).
 */
export function listAmount(value: string | null, currency: string): string {
  // a csak postafiókos bejövő sornál a nettó és az ÁFA nem ismert (096607af); a kimenő vázlatnál is előfordulhat
  if (value === null) return "—";
  const digits = currency === "HUF" ? 0 : 2;
  return new Intl.NumberFormat("hu-HU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}
