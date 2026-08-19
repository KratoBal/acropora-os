import type { WorksheetVersionStatus } from "@acropora/types";

export const worksheetStatusLabel: Record<WorksheetVersionStatus, string> = {
  DRAFT: "Piszkozat",
  AWAITING_SIGNATURE: "Aláírásra vár",
  SIGNED: "Aláírva",
  REJECTED: "Elutasítva",
};

export function worksheetStatusVariant(status: WorksheetVersionStatus) {
  if (status === "SIGNED") return "success" as const;
  if (status === "REJECTED") return "danger" as const;
  if (status === "AWAITING_SIGNATURE") return "warning" as const;
  return "neutral" as const;
}

/**
 * A piszkozatnak nincs száma: a sorszám a lezáráskor keletkezik. A listán
 * ezért nem üres cella áll, hanem kimondjuk, hogy még nincs - üres helyre a
 * felhasználó hibát képzel, nem szabályt.
 */
export function worksheetLabelOrDraft(label: string | null): string {
  return label ?? "Még nincs száma";
}

const forintFormat = new Intl.NumberFormat("hu-HU", {
  style: "currency",
  currency: "HUF",
  maximumFractionDigits: 0,
});

/**
 * Az összegek szövegként jönnek az API-ból (a Decimal pontossága nem fér
 * el egy JavaScript számban). A megjelenítéshez számmá alakítjuk, de csak
 * itt, egyetlen helyen - és ha az érték nem értelmezhető, inkább kiírjuk
 * nyersen, mint hogy "NaN Ft" jelenjen meg a lapon.
 */
export function formatAmount(value: string, currency = "HUF"): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (currency === "HUF") return forintFormat.format(amount);
  return `${new Intl.NumberFormat("hu-HU").format(amount)} ${currency}`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("hu-HU", {
    timeZone: "Europe/Budapest",
    dateStyle: "short",
    timeStyle: "short",
  });
}
