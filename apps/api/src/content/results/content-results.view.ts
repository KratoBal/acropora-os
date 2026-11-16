import {
  CONTENT_RESULT_FIELDS,
  contentDaypart,
  type ContentChannel,
  type ContentDaypart,
  type ContentResultValues,
  type ContentResultsSummary,
} from "@acropora/types";

/**
 * THE RESULTS, FROM WEEKS TO ANSWERS (T5.5 S8, spec 4.). Pure.
 *
 * WHAT TURNS THE SPEC RED: a number nobody entered summed as 0 (an item with no reach entered would drag an average
 * down and could be named the worst); an unmeasured item counted in an average; the daypart taken from UTC instead of
 * the Budapest hour the item went out.
 */

const EMPTY: ContentResultValues = {
  reach: null,
  reactions: null,
  opens: null,
  clicks: null,
  preorders: null,
  orders: null,
};

/** The sums over the weeks; a field stays null until a week has a number for it. */
export function sumWeeks(
  weeks: readonly ContentResultValues[],
): ContentResultValues {
  const totals: ContentResultValues = { ...EMPTY };
  for (const week of weeks)
    for (const field of CONTENT_RESULT_FIELDS) {
      const value = week[field];
      if (value !== null) totals[field] = (totals[field] ?? 0) + value;
    }
  return totals;
}

export interface SummaryItem {
  id: string;
  title: string;
  channel: ContentChannel;
  sentAt: Date;
  weeks: ContentResultValues[];
}

const budapestHour = (at: Date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Budapest",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at),
  );

const average = (values: number[]) =>
  values.length === 0
    ? null
    : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

const DAYPARTS: ContentDaypart[] = [
  "reggel",
  "délelőtt",
  "délután",
  "este",
  "éjszaka",
];

export function summarize(
  from: string,
  to: string,
  items: readonly SummaryItem[],
): ContentResultsSummary {
  const withTotals = items.map((item) => ({
    ...item,
    totals: sumWeeks(item.weeks),
    measured: item.weeks.length > 0,
  }));
  const channels = [...new Set(withTotals.map((item) => item.channel))].sort();
  const byChannel = channels.map((channel) => {
    const own = withTotals.filter((item) => item.channel === channel);
    const measured = own.filter((item) => item.measured);
    const withReach = measured.filter((item) => item.totals.reach !== null);
    const ranked = [...withReach].sort(
      (a, b) => b.totals.reach! - a.totals.reach! || a.id.localeCompare(b.id),
    );
    const pick = (item: (typeof ranked)[number] | undefined) =>
      item
        ? { contentId: item.id, title: item.title, reach: item.totals.reach! }
        : null;
    return {
      channel,
      items: own.length,
      measured: measured.length,
      avgReach: average(withReach.map((item) => item.totals.reach!)),
      avgClicks: average(
        measured.flatMap((item) =>
          item.totals.clicks === null ? [] : [item.totals.clicks],
        ),
      ),
      best: pick(ranked[0]),
      worst: ranked.length > 1 ? pick(ranked[ranked.length - 1]) : null,
    };
  });
  const preorders = withTotals
    .filter((item) => (item.totals.preorders ?? 0) > 0)
    .sort(
      (a, b) =>
        b.totals.preorders! - a.totals.preorders! || a.id.localeCompare(b.id),
    )
    .map((item) => ({
      contentId: item.id,
      title: item.title,
      preorders: item.totals.preorders!,
    }));
  const byDaypart = DAYPARTS.map((daypart) => {
    const own = withTotals.filter(
      (item) =>
        item.measured &&
        item.totals.reach !== null &&
        contentDaypart(budapestHour(item.sentAt)) === daypart,
    );
    return {
      daypart,
      measured: own.length,
      avgReach: average(own.map((item) => item.totals.reach!)),
    };
  });
  return { from, to, byChannel, preorders, byDaypart };
}
