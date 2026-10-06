import {
  MORTALITY_SOURCE_LABELS,
  type MortalitySource,
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
export function sourceTitle(source: MortalitySource): string {
  return source.supplier?.name ?? MORTALITY_SOURCE_LABELS[source.type];
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
