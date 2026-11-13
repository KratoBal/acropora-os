import type { OperationsTaskFrequency } from "./operations-log.js";

/**
 * ÜZEMELTETÉSI NAPLÓ: A HAVI KIMUTATÁS SZÁMÍTÁSA (task os-uzemeltetesi-naplo, S4). EGY HELYEN ÁLL, ÉS NEM A WEBES FELÜLETBEN VAGY A
 * PARTNER-PORTÁLBAN (Balázs 2026-09-25: minden, amit építünk, egyszer publikus alap lehet): a belső kimutatás, a PDF és a partner
 * nézete (S5) UGYANAZT a számítást használja, és csak a nézőnek szóló szűrés (`audience`) különbözik.
 *
 * A KIMUTATÁS, amit Balázs kért: mit végeztek el, kik, mennyi ideig, a vízóra különbsége (utána mínusz előtte), és a KIMARADT ütemezett
 * feladatok. A napi és a heti sablon ütemezett; az alkalmi nem (annak nincs esedékessége).
 *
 * AZ IDŐ BUDAPESTI: a nap határa a budapesti éjfél, nem az UTC-é (egy este 23:30-kor rögzített bejegyzés az adott napé).
 */
export const OPERATIONS_REPORT_TIME_ZONE = "Europe/Budapest";

/** A nézőtől függő szűrés: a partner NEM látja, ki végezte (helyette „Acropora"), és a belső megjegyzés sosem kerül ide. */
export type OperationsReportAudience = "INTERNAL" | "PARTNER";

export const OPERATIONS_REPORT_PARTNER_PERFORMER = "Acropora";

export interface OperationsReportEntryInput {
  id: string;
  templateId: string;
  templateName: string;
  frequency: OperationsTaskFrequency;
  assetId: string;
  assetLabel: string;
  startedAt: string;
  finishedAt: string;
  /** A rögzítő és a megadott kollégák nevei. */
  participantNames: string[];
  anomaly: boolean;
  anomalyNote: string | null;
  serviceJob: { jobNumber: string; status: string } | null;
  /** A bejegyzés értékei, a mező pillanatfelvételével (csak a szám érték számít a vízóránál). */
  values: {
    fieldKey: string;
    label: string;
    unit: string | null;
    meterRole: "BEFORE" | "AFTER" | null;
    value: number | boolean | string;
  }[];
}

/** Egy ütemezett sablon egy eszközön: a kimutatás ebből számolja a kimaradtakat. */
export interface OperationsReportScheduleInput {
  templateId: string;
  templateName: string;
  frequency: OperationsTaskFrequency;
  /** A sablon aktív-e: a kivezetett sablon kimaradása nem számít (a kivezetés ideje nem ismert, ezért nem találgatunk). */
  isActive: boolean;
  /** A sablon létrehozása: előtte nem lehetett kimaradás. */
  createdAt: string;
  assetId: string;
  assetLabel: string;
}

export interface OperationsReportEntryRow {
  id: string;
  startedAt: string;
  templateName: string;
  frequency: OperationsTaskFrequency;
  assetId: string;
  /** A tartam percben, kerekítve. */
  minutes: number;
  meterBefore: number | null;
  meterAfter: number | null;
  /** Utána mínusz előtte; `null`, ha a kettő közül bármelyik hiányzik. */
  meterDifference: number | null;
  meterUnit: string | null;
  /** A negatív különbség ellenőrizendő (az óra lenullázódott, vagy rosszul írták be). */
  meterSuspicious: boolean;
  performers: string[];
  anomaly: boolean;
  anomalyNote: string | null;
  ticket: { jobNumber: string; status: string } | null;
}

export interface OperationsReportAssetBlock {
  assetId: string;
  assetLabel: string;
  entries: OperationsReportEntryRow[];
  totalMinutes: number;
  /** A vízóra-különbségek összege, ahol van; az egység a bejegyzések egysége (vegyes egységnél `null`). */
  meterTotal: number | null;
  meterUnit: string | null;
  anomalies: number;
}

export interface OperationsReportMissed {
  assetId: string;
  assetLabel: string;
  templateId: string;
  templateName: string;
  frequency: OperationsTaskFrequency;
  /** A kimaradt időszakok: napi sablonnál a nap (`2026-11-03`), hetinél a hét hétfője (`2026-11-02`). */
  periods: string[];
}

export interface OperationsReport {
  /** `ÉÉÉÉ-HH`. */
  month: string;
  /** A hónap határai: a budapesti éjfélek (az eleje bennfoglalt, a vége kizárt). */
  monthStart: string;
  monthEnd: string;
  audience: OperationsReportAudience;
  totals: {
    entries: number;
    totalMinutes: number;
    anomalies: number;
    missed: number;
  };
  assets: OperationsReportAssetBlock[];
  missed: OperationsReportMissed[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Budapesti naptár: a nap kulcsa `ÉÉÉÉ-HH-NN`, a számítás dátumkulcsokon megy, nem időpontokon.
// ---------------------------------------------------------------------------------------------------------------------------------

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: OPERATIONS_REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: OPERATIONS_REPORT_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

/** Az időpont budapesti napja, `ÉÉÉÉ-HH-NN` alakban. */
export function budapestDayKey(instant: Date | string): string {
  return dayFormatter.format(new Date(instant));
}

function utcDate(dayKey: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** Naptári napok adása egy dátumkulcshoz (a nyári időszámítás nem számít: nem időpontokkal számolunk). */
export function addDays(dayKey: string, days: number): string {
  const date = utcDate(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A hét hétfője (ISO hét) a napot tartalmazó héthez. */
export function mondayOf(dayKey: string): string {
  const weekday = utcDate(dayKey).getUTCDay(); // 0 = vasárnap
  return addDays(dayKey, -((weekday + 6) % 7));
}

/** A budapesti éjfél időpontja a napra (a nyári és téli időszámítás eltolását a keresés találja meg). */
export function budapestMidnight(dayKey: string): Date {
  const base = utcDate(dayKey).getTime();
  for (const offsetHours of [2, 1]) {
    const candidate = new Date(base - offsetHours * 3_600_000);
    if (
      budapestDayKey(candidate) === dayKey &&
      hourFormatter.format(candidate) === "00"
    )
      return candidate;
  }
  throw new Error(`Nincs budapesti éjfél a(z) ${dayKey} napra.`);
}

export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** A hónap budapesti határai: az eleje az első nap éjfele, a vége a következő hónap első napjának éjfele. */
export function monthBounds(month: string): { start: Date; end: Date } {
  if (!isMonthKey(month)) throw new Error(`Érvénytelen hónap: ${month}.`);
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: budapestMidnight(first), end: budapestMidnight(next) };
}

/** A hónap utolsó napja `ÉÉÉÉ-HH-NN` alakban. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// A számítás.
// ---------------------------------------------------------------------------------------------------------------------------------

function minutesBetween(startedAt: string, finishedAt: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 60_000),
  );
}

function entryRow(
  entry: OperationsReportEntryInput,
  audience: OperationsReportAudience,
): OperationsReportEntryRow {
  const meter = (role: "BEFORE" | "AFTER") =>
    entry.values.find(
      (value) => value.meterRole === role && typeof value.value === "number",
    );
  const before = meter("BEFORE");
  const after = meter("AFTER");
  const difference =
    before && after
      ? Math.round(
          ((after.value as number) - (before.value as number)) * 1_000_000,
        ) / 1_000_000
      : null;
  return {
    id: entry.id,
    startedAt: entry.startedAt,
    templateName: entry.templateName,
    frequency: entry.frequency,
    assetId: entry.assetId,
    minutes: minutesBetween(entry.startedAt, entry.finishedAt),
    meterBefore: before ? (before.value as number) : null,
    meterAfter: after ? (after.value as number) : null,
    meterDifference: difference,
    meterUnit: after?.unit ?? before?.unit ?? null,
    meterSuspicious: difference !== null && difference < 0,
    performers:
      audience === "PARTNER"
        ? [OPERATIONS_REPORT_PARTNER_PERFORMER]
        : [...entry.participantNames],
    anomaly: entry.anomaly,
    anomalyNote: entry.anomalyNote,
    ticket: entry.serviceJob,
  };
}

/**
 * A KIMARADT ÜTEMEZETT FELADATOK. Egy ütemezett sablon egy eszközön akkor „maradt ki" egy időszakban, ha az időszak LEZÁRULT (a
 * mai nap nem számít, még lehet vele dolgozni), a sablon már létezett az időszak ELŐTT, és az eszközön nincs a sablonból egy
 * bejegyzés sem az időszakban.
 *
 *   napi    minden budapesti nap a hónapban;
 *   heti    minden hét (hétfőtől vasárnapig), amelynek VASÁRNAPJA a hónapba esik: a hónap-határon átnyúló hét ahhoz a hónaphoz
 *           tartozik, amelyben véget ér, és a számításhoz a hét hétfőjétől számított bejegyzések kellenek (a hívó a hónap előtti
 *           hat napot is átadja);
 *   alkalmi nincs esedékessége.
 *
 * A kivezetett sablon nem számít (a kivezetés ideje nem ismert, és egy utólag kivezetett sablon múltbeli napjait nem akarjuk
 * kimaradásnak hívni).
 */
function missedTasks(input: {
  month: string;
  today: string;
  schedules: readonly OperationsReportScheduleInput[];
  entries: readonly OperationsReportEntryInput[];
}): OperationsReportMissed[] {
  const lastDay = lastDayOfMonth(input.month);
  const monthFirst = `${input.month}-01`;
  const days = new Map<string, Set<string>>();
  for (const entry of input.entries) {
    const key = `${entry.assetId}|${entry.templateId}`;
    const set = days.get(key) ?? new Set<string>();
    set.add(budapestDayKey(entry.startedAt));
    days.set(key, set);
  }

  const result: OperationsReportMissed[] = [];
  for (const schedule of input.schedules) {
    if (!schedule.isActive || schedule.frequency === "OCCASIONAL") continue;
    const done =
      days.get(`${schedule.assetId}|${schedule.templateId}`) ?? new Set();
    // az időszak csak akkor esedékes, ha a sablon már a LÉTREHOZÁSA UTÁNI időszakban élt: a létrehozás napja nem számít
    const created = budapestDayKey(schedule.createdAt);
    const periods: string[] = [];
    if (schedule.frequency === "DAILY") {
      for (let day = monthFirst; day <= lastDay; day = addDays(day, 1)) {
        if (day <= created || day >= input.today) continue;
        if (!done.has(day)) periods.push(day);
      }
    } else {
      for (
        let monday = mondayOf(monthFirst);
        monday <= lastDay;
        monday = addDays(monday, 7)
      ) {
        const sunday = addDays(monday, 6);
        if (sunday < monthFirst || sunday > lastDay) continue;
        // a hét lezárult, és a sablon a hét ELEJE előtt létezett
        if (sunday >= input.today || monday <= created) continue;
        let any = false;
        for (let day = monday; day <= sunday; day = addDays(day, 1))
          if (done.has(day)) any = true;
        if (!any) periods.push(monday);
      }
    }
    if (periods.length > 0)
      result.push({
        assetId: schedule.assetId,
        assetLabel: schedule.assetLabel,
        templateId: schedule.templateId,
        templateName: schedule.templateName,
        frequency: schedule.frequency,
        periods,
      });
  }
  return result.sort(
    (a, b) =>
      a.assetLabel.localeCompare(b.assetLabel, "hu") ||
      a.templateName.localeCompare(b.templateName, "hu"),
  );
}

/**
 * A HAVI KIMUTATÁS. A `entries` a hónap bejegyzései ÉS a hónap előtti hat nap bejegyzései (a hét-határ miatt): a sorok közé csak a
 * hónapba (budapesti napja szerint) eső bejegyzések kerülnek. A `now` a „ma": a mai nap és a jövő nem számít kimaradásnak.
 */
export function buildOperationsReport(input: {
  month: string;
  audience: OperationsReportAudience;
  entries: readonly OperationsReportEntryInput[];
  schedules: readonly OperationsReportScheduleInput[];
  now?: Date;
}): OperationsReport {
  const { start, end } = monthBounds(input.month);
  const inMonth = input.entries
    .filter((entry) => {
      const at = Date.parse(entry.startedAt);
      return at >= start.getTime() && at < end.getTime();
    })
    .sort(
      (a, b) =>
        Date.parse(a.startedAt) - Date.parse(b.startedAt) ||
        a.id.localeCompare(b.id),
    );

  const blocks = new Map<string, OperationsReportAssetBlock>();
  for (const entry of inMonth) {
    const row = entryRow(entry, input.audience);
    const block =
      blocks.get(entry.assetId) ??
      ({
        assetId: entry.assetId,
        assetLabel: entry.assetLabel,
        entries: [],
        totalMinutes: 0,
        meterTotal: null,
        meterUnit: null,
        anomalies: 0,
      } satisfies OperationsReportAssetBlock);
    block.entries.push(row);
    block.totalMinutes += row.minutes;
    if (row.anomaly) block.anomalies += 1;
    blocks.set(entry.assetId, block);
  }
  for (const block of blocks.values()) {
    const diffs = block.entries.filter((row) => row.meterDifference !== null);
    const units = new Set(diffs.map((row) => row.meterUnit));
    if (diffs.length > 0 && units.size === 1) {
      block.meterTotal =
        Math.round(
          diffs.reduce((sum, row) => sum + (row.meterDifference ?? 0), 0) *
            1_000_000,
        ) / 1_000_000;
      block.meterUnit = [...units][0] ?? null;
    }
  }
  const assets = [...blocks.values()].sort((a, b) =>
    a.assetLabel.localeCompare(b.assetLabel, "hu"),
  );

  const today = budapestDayKey(input.now ?? new Date());
  const missed = missedTasks({
    month: input.month,
    today,
    schedules: input.schedules,
    entries: input.entries,
  });

  return {
    month: input.month,
    monthStart: start.toISOString(),
    monthEnd: end.toISOString(),
    audience: input.audience,
    totals: {
      entries: inMonth.length,
      totalMinutes: assets.reduce((sum, block) => sum + block.totalMinutes, 0),
      anomalies: assets.reduce((sum, block) => sum + block.anomalies, 0),
      missed: missed.reduce((sum, item) => sum + item.periods.length, 0),
    },
    assets,
    missed,
  };
}
