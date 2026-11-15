/**
 * THE CONTENT'S RESULTS (T5.5 S8; spec 4.: "Visszacsatolás: teljesítmény a tételre"). A sent item's numbers, entered by
 * hand per week until the channels' own statistics are connected (that connection is a separate decision: a new
 * outside access), and the outgoing links carry the item's id as tracking parameters so a visit can be traced back.
 */
import type { ContentChannel } from "./content-management.js";

/** The numbers of one week; null where nobody entered one (never 0 for "not measured"). */
export interface ContentResultValues {
  /** how many saw it */
  reach: number | null;
  /** likes, comments, shares (a post) */
  reactions: number | null;
  /** opens (a newsletter) */
  opens: number | null;
  /** clicks to the webshop */
  clicks: number | null;
  /** pre-registrations, when the item calls for them */
  preorders: number | null;
  /** orders, when they can be traced */
  orders: number | null;
}

export const CONTENT_RESULT_FIELDS = [
  "reach",
  "reactions",
  "opens",
  "clicks",
  "preorders",
  "orders",
] as const satisfies readonly (keyof ContentResultValues)[];

export const CONTENT_RESULT_FIELD_LABELS: Record<
  keyof ContentResultValues,
  string
> = {
  reach: "Elérés",
  reactions: "Reakció",
  opens: "Megnyitás",
  clicks: "Kattintás a webshopra",
  preorders: "Előjegyzés",
  orders: "Rendelés",
};

export const CONTENT_RESULT_LIMITS = {
  value: { min: 0, max: 10_000_000 },
} as const;

export interface ContentResultWeek extends ContentResultValues {
  /** The Monday of the Budapest week, `YYYY-MM-DD`. */
  weekStart: string;
  updatedAt: string;
}

export interface ContentResults {
  contentId: string;
  /** null: the item has not been sent, so there is nothing to measure yet. */
  sentAt: string | null;
  weeks: ContentResultWeek[];
  /** The sums over the weeks; null where no week has a number. */
  totals: ContentResultValues;
}

export type ContentDaypart =
  "reggel" | "délelőtt" | "délután" | "este" | "éjszaka";

export interface ContentResultsSummary {
  from: string;
  to: string;
  byChannel: {
    channel: ContentChannel;
    /** sent items in the range */
    items: number;
    /** of those, with at least one week entered */
    measured: number;
    /** averages over the measured items; null where none has the number */
    avgReach: number | null;
    avgClicks: number | null;
    best: { contentId: string; title: string; reach: number } | null;
    worst: { contentId: string; title: string; reach: number } | null;
  }[];
  /** The items that brought pre-registrations, the most first. */
  preorders: { contentId: string; title: string; preorders: number }[];
  /** By the Budapest hour the item went out. */
  byDaypart: {
    daypart: ContentDaypart;
    measured: number;
    avgReach: number | null;
  }[];
}

/** The Budapest daypart of an hour (0-23). */
export function contentDaypart(hour: number): ContentDaypart {
  if (hour >= 5 && hour < 9) return "reggel";
  if (hour >= 9 && hour < 12) return "délelőtt";
  if (hour >= 12 && hour < 17) return "délután";
  if (hour >= 17 && hour < 22) return "este";
  return "éjszaka";
}

const TRACKING_SOURCE: Record<
  ContentChannel,
  { source: string; medium: string }
> = {
  FACEBOOK_POST: { source: "facebook", medium: "social" },
  FACEBOOK_AD: { source: "facebook", medium: "paid_social" },
  ARTICLE: { source: "acropora", medium: "article" },
  TEACHING_SOURCE: { source: "acropora", medium: "teaching" },
  NEWSLETTER: { source: "newsletter", medium: "email" },
  OTHER: { source: "acropora", medium: "other" },
};

/**
 * AN OUTGOING LINK WITH THE ITEM'S TRACKING PARAMETERS (spec 4.: "Minden kifelé menő hivatkozás kapja a tétel
 * azonosítóját mérőparaméterként"). `utm_content` is the item's id: a visit and an order can be traced back to it. The
 * link's own parameters stay; its own `utm_*` values are replaced (an old campaign must not be credited). Null for
 * anything that is not an http(s) address: a tracking parameter on a `mailto:` or a relative path means nothing.
 */
export function contentTrackingUrl(
  url: string,
  item: { id: string; channel: ContentChannel },
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const { source, medium } = TRACKING_SOURCE[item.channel];
  parsed.searchParams.set("utm_source", source);
  parsed.searchParams.set("utm_medium", medium);
  parsed.searchParams.set("utm_campaign", "acropora-tartalom");
  parsed.searchParams.set("utm_content", item.id);
  return parsed.toString();
}
