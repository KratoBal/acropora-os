/**
 * A TÁROLT SZÁMLÁZZ.HU FEED VISSZATÖLTÉSE AZ ÉV ELEJÉIG (6fd8c574; acrobot 43766, 43768, 43776). A feed csak push: a
 * Számlázz.hu a kiállításkor küldi a számlát, és a tárolt feed 2026-09-03-tól tartalmaz számlát (a push bekötése). Ami
 * előtte készült, az a kifizetett-jelölésnek "nincs a Számlázz.hu feedben".
 *
 * MIT TUD A SZÁMLÁZZ.HU VISSZAMENŐLEG (docs.szamlazz.hu/agent, 2026-11-05): az Agent olvasó művelete
 * (`action-szamla_agent_xml`) EGY bizonylatot ad, számlaszámra; lista vagy dátumtartomány nincs, visszamenőleges
 * korlátot a dokumentáció nem nevez meg, és csak a Számlázz.hu-ban kiállított bizonylat kérdezhető le. A visszatöltés
 * tehát SZÁMONKÉNT megy, ugyanazon az úton, mint a "Lekérés a Számlázz.hu-ból" gomb (`pullFromSzamlazz`).
 *
 * MELYIK SZÁMOKAT: a tárolt feed sorozatai közül azok, amelyek ebben az évben fizetendő számlát (SZ, VS, ES) hoztak
 * (a díjbekérő sorozata kimarad: a Számlázz.hu a régi díjbekérőt magától törli, 7-es hibakóddal felelne). Sorozatonként
 * az 1-től a tárolt legnagyobb számig minden szám, ami nincs a feedben, a tárolt számok szélességével (`00069`).
 */
export interface StoredFeedNumber {
  documentNumber: string;
  kindCode: string;
}

export interface FeedGapSeries {
  /** `ACRW-2026` vagy az előtag nélküli `2026` */
  series: string;
  /** a tárolt legnagyobb szám a sorozatban */
  highest: string;
  /** a feedből hiányzó számok, növekvő sorrendben */
  missing: string[];
}

const PAYABLE_KINDS: ReadonlySet<string> = new Set(["SZ", "VS", "ES"]);
const NUMBER = /^(?:(.+)-)?(\d{4})\/(\d+)$/;

/** A szám sorozata (`ACRW-2026`, `2026`), vagy `null`, ha nem `[ELŐTAG-]ÉÉÉÉ/NNNNN` alakú. */
export function feedSeries(number: string): string | null {
  const match = NUMBER.exec(number);
  if (!match) return null;
  return match[1] ? `${match[1]}-${match[2]}` : match[2]!;
}

export function feedGaps(
  stored: readonly StoredFeedNumber[],
  year: number,
): FeedGapSeries[] {
  const bySeries = new Map<
    string,
    { numbers: Set<number>; width: number; payable: boolean }
  >();
  for (const row of stored) {
    const match = NUMBER.exec(row.documentNumber);
    if (!match || Number(match[2]) !== year) continue;
    const series = match[1] ? `${match[1]}-${match[2]}` : match[2]!;
    const entry = bySeries.get(series) ?? {
      numbers: new Set<number>(),
      width: 0,
      payable: false,
    };
    entry.numbers.add(Number(match[3]));
    entry.width = Math.max(entry.width, match[3]!.length);
    entry.payable ||= PAYABLE_KINDS.has(row.kindCode);
    bySeries.set(series, entry);
  }
  const out: FeedGapSeries[] = [];
  for (const [series, entry] of [...bySeries].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (!entry.payable) continue;
    const highest = Math.max(...entry.numbers);
    const format = (n: number) =>
      `${series}/${String(n).padStart(entry.width, "0")}`;
    const missing: string[] = [];
    for (let n = 1; n < highest; n++)
      if (!entry.numbers.has(n)) missing.push(format(n));
    out.push({ series, highest: format(highest), missing });
  }
  return out;
}

/** Egy szám ellenőrzésének kimenete, ahogy a visszatöltés tárolja (a `FeedPullLine` kimenetei). */
export type FeedBackfillOutcome =
  | "WOULD_STORE"
  | "STORED"
  | "NOT_FOUND"
  | "ERROR"
  | "UNREADABLE"
  | "OTHER_NUMBER";

/**
 * A száraz kör ezeket nem kérdezi újra (folytatható): a válasz végleges. A hibás és az olvashatatlan válasz újra megy.
 */
export const SETTLED_OUTCOMES: ReadonlySet<string> = new Set([
  "WOULD_STORE",
  "STORED",
  "NOT_FOUND",
  "OTHER_NUMBER",
]);

/** Sorozatonként és kimenetenként a darabszám: a lap ebből mondja meg, hány ACRW számot ismer a Számlázz.hu. */
export function backfillSummary(
  rows: readonly { series: string; outcome: string }[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const series = (out[row.series] ??= {});
    series[row.outcome] = (series[row.outcome] ?? 0) + 1;
  }
  return out;
}
