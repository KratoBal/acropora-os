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
  | "OTHER_NUMBER"
  | "UNVERIFIED"
  | "NOT_OUR_ACCOUNT";

/**
 * A száraz kör ezeket nem kérdezi újra (folytatható): a válasz végleges. A hibás és az olvashatatlan válasz újra megy.
 *
 * A NOT_FOUND CSAK EGY SIKERES KONTROLL MELLETT VÉGLEGES (acrobot 57804, 2026-11-20): a 2026-11-19-i első élő kör mind az
 * 542 számra "nincs ilyen szám"-ot rögzített, a 2026/00058-ra is, amiről tudjuk, hogy létezik, és a körnek nem volt
 * mérője, ami ezt megmutatta volna. Azóta a kör a sorozat legnagyobb tárolt számát (ami biztosan létezik) kérdezi
 * ELŐSZÖR, és csak akkor rögzít nemet, ha arra számla jött vissza. A kontroll nélkül rögzített nemek az UNVERIFIED
 * kimenetet kapták (migráció): az nem végleges, újra megy, és a lapon külön sorban áll, nem "nem ismeri"-ként.
 */
export const SETTLED_OUTCOMES: ReadonlySet<string> = new Set([
  "WOULD_STORE",
  "STORED",
  "NOT_FOUND",
  "OTHER_NUMBER",
]);

/**
 * A SOROZAT NEM A MI SZÁMLÁZZ.HU FIÓKUNKBÓL VALÓ (acrobot 58095, Balázs 2026-11-20): a feedben lévő szám a kontrollon 7-es
 * választ kapott, MIKÖZBEN az OS által ugyanezzel a kulccsal kiállított számla megvan, vagyis a kérés alakja és a kulcs jó,
 * a szám nem ebben a fiókban él (a push-végponton jött, másik számlázó programból). A sorozat legnagyobb száma kapja ezt a
 * kimenetet a visszatöltés táblájában: a sorozat VÉGLEGESEN kimarad a Számlázz.hu-s visszatöltésből, és a lap erre nem
 * kínál gombot. Nem cégadat és nem konfig: a Számlázz.hu válasza dönti el, sorozatonként, és a tábla őrzi.
 */
export const NOT_OUR_ACCOUNT = "NOT_OUR_ACCOUNT" as const;

/** A sorozatok, amelyeket a kontroll a mi fiókunkon kívülinek ítélt. */
export function foreignSeries(
  checked: readonly { series: string; outcome: string }[],
): ReadonlySet<string> {
  return new Set(
    checked.filter((c) => c.outcome === NOT_OUR_ACCOUNT).map((c) => c.series),
  );
}

/** A kontroll-kérdés: a sorozat legnagyobb tárolt száma, ami a feedben van, tehát a Számlázz.hu-ban is létezik. */
export interface FeedControlResult {
  series: string;
  number: string;
  /** `WOULD_STORE`: a Számlázz.hu ismerte, a kérdezés megbízható; bármi más: nem az */
  outcome: string;
  /** a Számlázz.hu hibakódja és üzenete, vagy a hiba alakja (a válasz XML-je és vevő nélkül) */
  detail: string;
  passed: boolean;
  /**
   * Igaz, ha a kontroll 7-et kapott, és az OS által kiállított számlát ugyanez a kulcs megtalálta: a sorozat nem a mi fiókunkból
   * való (`NOT_OUR_ACCOUNT`). Ez NEM kontroll-bukás: a kör nem áll le miatta, a sorozat kimarad.
   */
  foreign?: boolean;
  /** a bukott kontroll diagnosztikája: ugyanaz a szám más kérés-alakkal, a PDF-lekéréssel, és egy OS-ben kiállított számmal */
  diagnostics?: string[];
}

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
