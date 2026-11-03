import type { PilotBadgeVariant } from "@acropora/ui";
import { formatDayHu } from "@/lib/format/date";
import type {
  QuoteAcceptanceSourceValue,
  QuoteAcceptanceRecordedSource,
  QuoteBlockKindValue,
  QuoteCloseReasonValue,
  QuotePriceDisplay,
  QuoteStatusValue,
} from "@acropora/types";

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

/** P4a: honnan jött az ügyfél igenje (a link a P4b-ben jön). */
export const QUOTE_ACCEPTANCE_SOURCE: Record<
  QuoteAcceptanceSourceValue,
  string
> = {
  PHONE: "Telefonon",
  EMAIL: "Emailben",
  IN_PERSON: "Személyesen",
  OTHER_MANUAL: "Egyéb módon",
};

/** Egy rögzített elfogadás forrása, a P4b linkjével együtt (csak kijelzésre). */
export const QUOTE_ACCEPTANCE_RECORDED_SOURCE: Record<
  QuoteAcceptanceRecordedSource,
  string
> = {
  ...QUOTE_ACCEPTANCE_SOURCE,
  PUBLIC_LINK: "Az elfogadó linken",
};

/** P4a: az elutasítás vagy visszavonás oka (a riport ebből készülhet). */
export const QUOTE_CLOSE_REASON: Record<QuoteCloseReasonValue, string> = {
  PRICE: "Ár",
  COMPETITOR: "Versenytárs",
  PROJECT_CANCELLED: "A projekt elmaradt",
  PROJECT_POSTPONED: "A projekt később lesz",
  NO_RESPONSE: "Nem válaszolt",
  SCOPE_CHANGED: "Változott a tartalom",
  OTHER: "Egyéb",
};

export const QUOTE_VERSION_STATUS: Record<
  "DRAFT" | "PUBLISHED" | "SUPERSEDED",
  { label: string; variant: PilotBadgeVariant }
> = {
  DRAFT: { label: "Piszkozat", variant: "amber" },
  PUBLISHED: { label: "Publikált", variant: "blue" },
  SUPERSEDED: { label: "Felülírt", variant: "grey" },
};

/** How the prices read on the PDF: the net-only quote ends "… Ft + ÁFA". */
export const QUOTE_PRICE_DISPLAY: Record<QuotePriceDisplay, string> = {
  NET: "Csak nettó + ÁFA",
  GROSS: "Bruttó (ÁFA-val)",
  BOTH: "Nettó és bruttó",
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

/**
 * Pénz: forint egészre, más pénznem két tizedesre (a számlázás szabálya), hiányzó érték "—".
 * A közös formázó (`@acropora/types`, T1.5) a megszokott néven; egy egységár (nettó egységár,
 * egységköltség, javasolt ár) `{ fractionDigits: 2 }`-vel hívja, mert ott a fillér valódi adat.
 */
export { formatMoney as formatQuoteMoney } from "@acropora/types";

/** `2026-11-06` → `2026. 11. 06.` (the one list date format, see `lib/format/date.ts`). */
export function formatQuoteDay(value: string | null): string {
  if (!value) return "—";
  return formatDayHu(value.slice(0, 10));
}

/** Egy decimális szöveg emberi alakja (tizedesvessző, felesleges nullák nélkül): a közös formázó. */
export { formatQuantity } from "@acropora/types";

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
