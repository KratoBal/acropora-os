import {
  MORTALITY_SOURCE_LABELS,
  type MortalitySource,
  type MortalityStockEffect,
  type MortalityStockReason,
  type MortalitySummary,
} from "@acropora/types";

/**
 * AZ ELHULLÁSI NAPLÓ FELIRATAI ÉS IDŐSZAKAI (kártya 115c9740), tiszta
 * függvényekben: a lista, a részlet és az űrlap ugyanezt használja.
 */

const ZONE = "Europe/Budapest";

/** Budapest naptári napja, `ÉÉÉÉ-HH-NN` alakban. */
export function budapestDay(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A „Minden időszak” választó értékei; az URL-ben a `period` kulcs viszi. */
export const MORTALITY_PERIODS = [
  { value: "", label: "Minden időszak" },
  { value: "ma", label: "Ma" },
  { value: "7nap", label: "Utolsó 7 nap" },
  { value: "honap", label: "Ez a hónap" },
  { value: "elozo-honap", label: "Előző hónap" },
] as const;
export type MortalityPeriod = (typeof MORTALITY_PERIODS)[number]["value"];

/**
 * Az időszak napjai (a szerver `from`/`to` paramétere, mindkettő zárt, Budapest
 * naptára szerint), vagy `null`, ha nincs szűrés.
 */
export function periodRange(
  period: MortalityPeriod,
  now: Date,
): { from: string; to: string } | null {
  const today = budapestDay(now);
  const monthStart = `${today.slice(0, 8)}01`;
  switch (period) {
    case "ma":
      return { from: today, to: today };
    case "7nap":
      return { from: shiftDay(today, -6), to: today };
    case "honap":
      return { from: monthStart, to: today };
    case "elozo-honap": {
      const lastOfPrevious = shiftDay(monthStart, -1);
      return { from: `${lastOfPrevious.slice(0, 8)}01`, to: lastOfPrevious };
    }
    default:
      return null;
  }
}

const MONTH_INESSIVE = [
  "januárban",
  "februárban",
  "márciusban",
  "áprilisban",
  "májusban",
  "júniusban",
  "júliusban",
  "augusztusban",
  "szeptemberben",
  "októberben",
  "novemberben",
  "decemberben",
] as const;

/** „Elhullás októberben”: a folyó hónap neve, Budapest szerint. */
export function monthCardTitle(now: Date): string {
  const month = Number(budapestDay(now).slice(5, 7));
  return `Elhullás ${MONTH_INESSIVE[month - 1]}`;
}

/**
 * A heti kártya alsó sora. A számhoz kötött rag (2-vel, 3-mal, 1-gyel) a
 * kiejtéstől függ, ezért a mondat a „példánnyal” szóra épül.
 */
export function weekComparison(
  summary: Pick<MortalitySummary, "last7Days" | "previous7Days">,
): string {
  const diff = summary.last7Days - summary.previous7Days;
  if (diff === 0) return "Ugyanannyi, mint az előző héten";
  return `${Math.abs(diff)} példánnyal ${diff < 0 ? "kevesebb" : "több"}, mint az előző héten`;
}

export function aquariumLabel(aquarium: {
  aquariumNumber: string;
  name: string;
}): string {
  return `${aquarium.aquariumNumber} · ${aquarium.name}`;
}

/** A forrás fő sora: a beszállító neve, más forrásnál a típus felirata. */
/** A rendszerben nem szereplő élőlény vagy beszállító jelölése (Balázs 2026-10-07). */
export const NOT_IN_SYSTEM = "nincs a rendszerben";

/**
 * A forrás címe: a beszállító neve (a rendszerbeli, vagy a szabad szöveggel
 * beírt), különben a forrás-típus felirata.
 */
export function sourceTitle(source: MortalitySource): string {
  if (source.supplier) return source.supplier.name;
  if (source.type === "SUPPLIER" && source.note) return source.note;
  return MORTALITY_SOURCE_LABELS[source.type];
}

/**
 * A forrás második sora: beszállítónál a jelölés, ha nincs a rendszerben; más
 * forrásnál a megnevezés (pl. a tenyésztő neve).
 */
export function sourceSubtitle(source: MortalitySource): string | null {
  if (source.type === "SUPPLIER")
    return source.supplier || !source.note
      ? null
      : `Beszállító, ${NOT_IN_SYSTEM}`;
  return source.note;
}

/** Az élőlény neve: a rendszerbeli termék, vagy a szabad szöveggel beírt név. */
export function livestockTitle(record: {
  product: { name: string } | null;
  productName: string | null;
}): string {
  return record.product?.name ?? record.productName ?? "";
}

/** Az élőlény második sora: a magyar név, vagy a jelölés, ha nincs a rendszerben. */
export function livestockSubtitle(record: {
  product: { commonName: string | null } | null;
}): string | null {
  return record.product ? record.product.commonName : NOT_IN_SYSTEM;
}

const STOCK_REASON_TEXT: Readonly<Record<MortalityStockReason, string>> = {
  FREE_TEXT: `A készlet nem változott: az élőlény ${NOT_IN_SYSTEM}.`,
  NOT_STOCKED: "A készlet nem változott: a termék nem készletezett.",
  NO_VARIANT: "A készlet nem változott: a terméknek nincs aktív változata.",
  VARIANT_NOT_CHOSEN:
    "A készlet nem változott: a terméknek több változata van, és nem dönthető el, melyik.",
  PACKAGE: "A készlet nem változott: csomagtermék.",
};

/** A bejegyzés készlethatása egy mondatban (a részletlapon). */
export function stockEffectText(stock: MortalityStockEffect): string {
  if (stock.deducted > 0)
    return `${stock.deducted} db levonva a készletből${stock.sku ? ` (${stock.sku})` : ""}.`;
  return stock.reason
    ? STOCK_REASON_TEXT[stock.reason]
    : "A készlet nem változott.";
}

function parts(instant: Date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("hu-HU", {
      timeZone: ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return values as Record<"year" | "month" | "day" | "hour" | "minute", string>;
}

/** A lista időpontja: „2026.10.06. 09:42”. */
export function shortDateTime(iso: string): string {
  const p = parts(new Date(iso));
  return `${p.year}.${p.month}.${p.day}. ${p.hour}:${p.minute}`;
}

const MONTH_NAMES = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
] as const;

/** A részlet időpontja: „2026. október 6. · 09:42”. */
export function longDateTime(iso: string): string {
  const p = parts(new Date(iso));
  return `${p.year}. ${MONTH_NAMES[Number(p.month) - 1]} ${Number(p.day)}. · ${p.hour}:${p.minute}`;
}
