/** "12 700 Ft", "100,50 EUR": the shared formatter (`@acropora/types`, T1.5). */
export { formatMoney } from "@acropora/types";

const MONTH = new Intl.DateTimeFormat("hu-HU", {
  month: "long",
  timeZone: "UTC",
});

/** "2026-09" -> "szeptember" */
export function monthName(month: string): string {
  const label = MONTH.format(new Date(`${month}-01T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
