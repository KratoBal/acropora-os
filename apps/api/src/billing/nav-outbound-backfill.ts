import { prisma } from "@acropora/database";

import type {
  NavInvoiceDigestItem,
  NavOnlineInvoiceClient,
} from "../integrations/nav/nav-online-invoice.client.js";
import type { NavCredentialsService } from "../integrations/nav/nav-credentials.service.js";
import { invoiceNumberKey } from "./external-billing-one-row.js";

/**
 * A KIMENŐ SZÁMLÁK A NAV-BÓL, SZÁRAZON (kártya 785dfea6; terv: agents/nautilus/megosztas/nav-kimeno-terv-2026-11-20.md, acrobot 58077,
 * 58082). A CASHMAN számlái (2026/, ACRW-2026/) a mi adószámunkon mennek a NAV-ba, de a Számlázz.hu feed csak 2026-10-01 óta hozza őket,
 * az Agent pedig sosem látja őket: 01-01 és 09-30 között a NAV az egyetlen forrás.
 *
 * EZ A RÉSZ CSAK OLVAS. A NAV OUTBOUND digestjét (kiállítói oldal; interfész-specifikáció v3.0, 2026.02.12, 35-36. o.) kelt szerinti,
 * legfeljebb 30 napos ablakokban kérdezi (a NAV határa 35 nap, 56. o.), és megszámolja, mi van már meg nálunk (külső számla vagy
 * az OS saját számlája, egy szám egy sor: `invoiceNumberKey`), és mi hiányzik. Nem ír semmit. A kimenet nem hordoz vevőnevet, adószámot
 * és összeget: sorozatonkénti darabszámot ad, és a hiányzók SZÁMÁT (a szám a számla azonosítója, nem személyes adat).
 */

/** Egy számla sorozata: a szám a záró számjegyek nélkül („2026/00090” → „2026/”, „ACRW-2026/00571” → „ACRW-2026/”). */
export function navOutboundSeries(invoiceNumber: string): string {
  const trimmed = invoiceNumber.trim().replace(/\d+$/, "");
  return trimmed === "" ? "(csak szám)" : trimmed;
}

export interface NavOutboundSeriesCount {
  seen: number;
  missing: number;
}

export interface NavOutboundWindowResult {
  windowStart: string;
  windowEnd: string;
  seen: number;
  /** már van külső számla-sora (Számlázz.hu, eBIZ) */
  presentExternal: number;
  /** az OS maga állította ki (`Invoice`, OUTBOUND) */
  presentOwn: number;
  /** nálunk sehol nincs: ezt hozná a visszatöltés */
  missing: number;
  storno: number;
  modification: number;
  /** a NAV nem adja a vevő nevét (nem adóalany magánszemély) */
  privatePerson: number;
  bySeries: Record<string, NavOutboundSeriesCount>;
  /** a hiányzó számlák számai, sorrendben */
  missingNumbers: string[];
}

/** Egy ablak tételeinek besorolása. Tiszta függvény: az adatbázist a hívó kérdezi. */
export function classifyNavOutbound(
  items: readonly NavInvoiceDigestItem[],
  present: { external: ReadonlySet<string>; own: ReadonlySet<string> },
  window: { start: Date; end: Date },
): NavOutboundWindowResult {
  const result: NavOutboundWindowResult = {
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    seen: 0,
    presentExternal: 0,
    presentOwn: 0,
    missing: 0,
    storno: 0,
    modification: 0,
    privatePerson: 0,
    bySeries: {},
    missingNumbers: [],
  };
  for (const item of items) {
    result.seen += 1;
    if (item.invoiceOperation === "STORNO") result.storno += 1;
    if (item.invoiceOperation === "MODIFY") result.modification += 1;
    if (!item.customerName && !item.customerTaxNumber)
      result.privatePerson += 1;
    const key = invoiceNumberKey(item.invoiceNumber);
    const series = (result.bySeries[navOutboundSeries(item.invoiceNumber)] ??= {
      seen: 0,
      missing: 0,
    });
    series.seen += 1;
    if (present.external.has(key)) result.presentExternal += 1;
    else if (present.own.has(key)) result.presentOwn += 1;
    else {
      result.missing += 1;
      series.missing += 1;
      result.missingNumbers.push(item.invoiceNumber);
    }
  }
  return result;
}

/** A NAV egy ablakban: a digest minden oldala (a lapméretet a szerver adja), a kelt szerint. */
const MAX_PAGES = 50;
const DAY_MS = 24 * 60 * 60_000;
const WINDOW_DAYS = 30;

/**
 * KELT-ABLAKOK NAPRA, A HATÁRNAP NEM ISMÉTLŐDIK. A kelt-tartomány mindkét vége benne van (`DateIntervalParamType`: dateFrom ≥,
 * dateTo ≤), ezért a következő ablak a záró nap UTÁNI napon indul; a bejövő szinkron időpont-ablakai (`backfillWindows`) a záró
 * pillanatban folytatódnak, ami napra váltva a határnap számláit kétszer számolná. Egy ablak legfeljebb 30 nap (a NAV 35-öt enged).
 */
export function issueDateWindows(
  from: Date,
  to: Date,
  days: number = WINDOW_DAYS,
): { start: Date; end: Date }[] {
  const windows: { start: Date; end: Date }[] = [];
  for (
    let start = from.getTime();
    start <= to.getTime();
    start += days * DAY_MS
  )
    windows.push({
      start: new Date(start),
      end: new Date(Math.min(start + (days - 1) * DAY_MS, to.getTime())),
    });
  return windows;
}

export interface NavOutboundPresentLookup {
  /** a megadott számok közül melyik van már külső számla-sorként, és melyik az OS saját kimenő számlájaként (`invoiceNumberKey`-jel) */
  present(
    numbers: readonly string[],
  ): Promise<{ external: Set<string>; own: Set<string> }>;
}

export const prismaNavOutboundPresent: NavOutboundPresentLookup = {
  async present(numbers) {
    if (numbers.length === 0) return { external: new Set(), own: new Set() };
    const [external, own] = await Promise.all([
      prisma.externalBillingDocument.findMany({
        where: { documentNumber: { in: [...numbers] } },
        select: { documentNumber: true },
      }),
      prisma.invoice.findMany({
        where: { direction: "OUTBOUND", invoiceNumber: { in: [...numbers] } },
        select: { invoiceNumber: true },
      }),
    ]);
    return {
      external: new Set(
        external.map((row) => invoiceNumberKey(row.documentNumber)),
      ),
      own: new Set(
        own.flatMap((row) =>
          row.invoiceNumber ? [invoiceNumberKey(row.invoiceNumber)] : [],
        ),
      ),
    };
  },
};

export class NavOutboundBackfill {
  constructor(
    private readonly client: Pick<NavOnlineInvoiceClient, "queryInvoiceDigest">,
    private readonly credentials: Pick<NavCredentialsService, "resolve">,
    private readonly lookup: NavOutboundPresentLookup = prismaNavOutboundPresent,
  ) {}

  /** Szárazon, ablakonként; a NAV hibája (például a 9-es: nincs jogosultság) a hívóhoz jut, megnevezve. */
  async dryRun(options: {
    from: Date;
    to: Date;
    onWindow?: (result: NavOutboundWindowResult) => void;
  }): Promise<NavOutboundWindowResult[]> {
    const credentials = await this.credentials.resolve();
    const results: NavOutboundWindowResult[] = [];
    for (const window of issueDateWindows(options.from, options.to)) {
      const items: NavInvoiceDigestItem[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const result = await this.client.queryInvoiceDigest(
          page,
          "OUTBOUND",
          window.start,
          window.end,
          credentials.technicalUser,
          credentials.software,
          "invoiceIssueDate",
        );
        items.push(...result.items);
        if (page >= result.availablePage) break;
      }
      const present = await this.lookup.present(
        items.map((item) => item.invoiceNumber),
      );
      const result = classifyNavOutbound(items, present, window);
      options.onWindow?.(result);
      results.push(result);
    }
    return results;
  }
}

/** `--from=ÉÉÉÉ-HH-NN` (kötelező) és `--to=ÉÉÉÉ-HH-NN` (alapból ma). Írni nem tud: `--apply` nincs. */
export function parseNavOutboundArgs(
  argv: readonly string[],
  now: Date = new Date(),
): { from: Date; to: Date } {
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
  const day = (text: string | undefined, name: string) => {
    if (text === undefined) return undefined;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      Number.isNaN(Date.parse(`${text}T00:00:00.000Z`))
    )
      throw new Error(`A --${name} alakja ÉÉÉÉ-HH-NN, nem ${text}.`);
    return new Date(`${text}T00:00:00.000Z`);
  };
  if (argv.includes("--apply"))
    throw new Error(
      "Ez a parancs csak olvas: --apply nincs (a visszatöltés írása külön lépés, a terv 2. PR-ja).",
    );
  const from = day(value("from"), "from");
  if (!from) throw new Error("Kötelező: --from=ÉÉÉÉ-HH-NN.");
  const to =
    day(value("to"), "to") ??
    new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (from.getTime() > to.getTime())
    throw new Error("A --from a --to utáni nap.");
  return { from, to };
}
