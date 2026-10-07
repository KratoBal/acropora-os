import type { PilotBadgeVariant } from "@acropora/ui";
import type { QuoteBlockKindValue, QuoteStatusValue } from "@acropora/types";

/** Az ajánlat állapota a felületen (a modell hat állapota, a Figma színeivel). */
export const QUOTE_STATUS: Record<
  QuoteStatusValue,
  { label: string; variant: PilotBadgeVariant }
> = {
  DRAFT: { label: "Piszkozat", variant: "grey" },
  SENT: { label: "Kiküldve", variant: "blue" },
  ACCEPTED: { label: "Elfogadva", variant: "success" },
  REJECTED: { label: "Elutasítva", variant: "danger" },
  POSTPONED: { label: "Elhalasztva", variant: "amber" },
  CANCELLED: { label: "Visszavonva", variant: "grey" },
};

export const QUOTE_VERSION_STATUS: Record<
  "DRAFT" | "PUBLISHED" | "SUPERSEDED",
  { label: string; variant: PilotBadgeVariant }
> = {
  DRAFT: { label: "Piszkozat", variant: "amber" },
  PUBLISHED: { label: "Publikált", variant: "blue" },
  SUPERSEDED: { label: "Felülírt", variant: "grey" },
};

export const QUOTE_BLOCK_LABEL: Record<QuoteBlockKindValue, string> = {
  TEXT: "Szöveg",
  SECTION: "Fejezet",
  OPTIONS: "Opciók",
  SUMMARY: "Összesítő",
  TERMS: "Feltételek",
  IMAGE: "Kép",
  PAGE_BREAK: "Oldaltörés",
};

/** Pénz: forint egészre, más pénznem két tizedesre (a számlázás szabálya). */
export function formatQuoteMoney(
  value: string | null,
  currency: string,
): string {
  if (value === null) return "—";
  const digits = currency === "HUF" ? 0 : 2;
  const formatted = new Intl.NumberFormat("hu-HU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
  return currency === "HUF" ? `${formatted} Ft` : `${formatted} ${currency}`;
}

/** `2026-11-06` → `2026.11.06.` */
export function formatQuoteDay(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${y}.${m}.${d}.`;
}

/** Egy decimális szöveg emberi alakja (tizedesvessző, felesleges nullák nélkül). */
export function formatQuantity(value: string): string {
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 6 }).format(n)
    : value;
}

/** A mai nap után `days` nappal, `YYYY-MM-DD` alakban (Budapest szerint). */
export function dayAfter(days: number, now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
  }).format(now);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Az API hibája a felületre: a szerver magyar üzenete, vagy egy tartalék. */
export function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export const isAbort = (cause: unknown) =>
  cause instanceof DOMException && cause.name === "AbortError";
