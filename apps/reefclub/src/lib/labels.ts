import type { ReefClubAquarium } from "./types";

export const WATER_BODY_LABEL: Record<
  ReefClubAquarium["waterBodyType"],
  string
> = {
  AKVARIUM: "Akvárium",
  TO: "Tó",
};

export const WATER_TYPE_LABEL = {
  EDESVIZI: "Édesvizi",
  TENGERI: "Tengeri",
} as const;

/** The volume the way a Hungarian reads it: a decimal comma, "liter". */
export function formatLiters(liters: number | null): string {
  if (liters === null) return "ismeretlen térfogat";
  return `${new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 3 }).format(liters)} liter`;
}

/** A decimal as typed in Hungary ("60,5") or elsewhere ("60.5"); null when it is not a number. */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function formatMoment(iso: string): string {
  return new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Budapest",
  }).format(new Date(iso));
}
