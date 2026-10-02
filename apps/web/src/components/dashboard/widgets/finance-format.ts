const HUF = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 });
const OTHER = new Intl.NumberFormat("hu-HU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "12 700 Ft", "100,50 EUR": the amount as the billing pages write it. */
export function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);
  return currency === "HUF"
    ? `${HUF.format(value)} Ft`
    : `${OTHER.format(value)} ${currency}`;
}

const MONTH = new Intl.DateTimeFormat("hu-HU", {
  month: "long",
  timeZone: "UTC",
});

/** "2026-09" -> "szeptember" */
export function monthName(month: string): string {
  const label = MONTH.format(new Date(`${month}-01T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
