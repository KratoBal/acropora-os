import { Prisma, prisma } from "@acropora/database";

import type {
  NavInvoiceDigestItem,
  NavOnlineInvoiceClient,
} from "../integrations/nav/nav-online-invoice.client.js";
import type { NavCredentialsService } from "../integrations/nav/nav-credentials.service.js";
import { EBIZ_DEFAULT_SINCE } from "../integrations/ebiz/ebiz-sync.service.js";
import { NAV_SOURCE, invoiceNumberKey } from "./external-billing-one-row.js";

/**
 * A KIMENŐ SZÁMLÁK A NAV-BÓL, SZÁRAZON (kártya 785dfea6; terv: agents/nautilus/megosztas/nav-kimeno-terv-2026-11-20.md, acrobot 58077,
 * 58082). A CASHMAN számlái (2026/, ACRW-2026/) a mi adószámunkon mennek a NAV-ba, de a Számlázz.hu feed csak 2026-10-01 óta hozza őket,
 * az Agent pedig sosem látja őket: 01-01 és 09-30 között a NAV az egyetlen forrás.
 *
 * ALAPBÓL CSAK OLVAS (a PR 1 óta). A NAV OUTBOUND digestjét (kiállítói oldal; interfész-specifikáció v3.0, 2026.02.12, 35-36. o.) kelt szerinti,
 * legfeljebb 30 napos ablakokban kérdezi (a NAV határa 35 nap, 56. o.), és megszámolja, mi van már meg nálunk (külső számla vagy
 * az OS saját számlája, egy szám egy sor: `invoiceNumberKey`), és mi hiányzik. Nem ír semmit. A kimenet nem hordoz vevőnevet, adószámot
 * és összeget: sorozatonkénti darabszámot ad, és a hiányzók SZÁMÁT (a szám a számla azonosítója, nem személyes adat).
 *
 * `--apply` (a PR 2): a hiányzókat `ExternalBillingDocument`-sorként felveszi, `source` = `NAV`, migráció nélkül (acrobot 58082):
 * a feed-mezőket az eBIZ mintájára tölti (`NAV:<tranzakció>:<index>`, a befogadás). A sor csak a LÉTEZÉST hordozza (szám, kelt,
 * összeg, vevő): fizetést nem (a NAV nem adja; a saját banki jelölésünk igen), tételt nem (acrobot 58082), PDF-et nem
 * (`NAV_NO_PDF`). Egy szám egy sor: a NAV csak ott ír, ahol egyik forrásnál sincs meg a szám, és a Számlázz.hu meg az eBIZ
 * átveszi a sorát (`takeOverNavRow`).
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

/**
 * A KULCS AZ ADATBÁZIS OLDALÁN IS (barracuda, #2775): a tárolt számot ugyanúgy normalizálja, mint az `invoiceNumberKey` (szóköz ki,
 * nagybetű), nem pontos egyezéssel keres. Írás mellett a pontos egyezés egy másként írt tárolt számot („acrw-2026/00571”)
 * hiányzónak látna, és a NAV sor mellé kerülne: ugyanaz a szám két sorban, és a `skipDuplicates` sem fogja meg (más forrás).
 */
export const prismaNavOutboundPresent: NavOutboundPresentLookup = {
  async present(numbers) {
    if (numbers.length === 0) return { external: new Set(), own: new Set() };
    const keys = [...new Set(numbers.map(invoiceNumberKey))];
    const [external, own] = await Promise.all([
      prisma.$queryRaw<{ key: string }[]>`
        SELECT DISTINCT upper(regexp_replace("documentNumber", '[[:space:]]', '', 'g')) AS "key"
        FROM "ExternalBillingDocument"
        WHERE upper(regexp_replace("documentNumber", '[[:space:]]', '', 'g')) = ANY(${keys})`,
      prisma.$queryRaw<{ key: string }[]>`
        SELECT DISTINCT upper(regexp_replace("invoiceNumber", '[[:space:]]', '', 'g')) AS "key"
        FROM "Invoice"
        WHERE "direction" = 'OUTBOUND'
          AND upper(regexp_replace("invoiceNumber", '[[:space:]]', '', 'g')) = ANY(${keys})`,
    ]);
    return {
      external: new Set(external.map((row) => row.key)),
      own: new Set(own.map((row) => row.key)),
    };
  },
};

/** A NAV a lapméretet maga dönti el (specifikáció 56. o.); ennél több oldal egy ablakban hiba, nem csendes vágás (barracuda, #2774). */
export class NavOutboundPageLimitError extends Error {
  constructor(window: { start: Date; end: Date }, availablePage: number) {
    super(
      `A NAV a(z) ${window.start.toISOString().slice(0, 10)} .. ${window.end.toISOString().slice(0, 10)} ablakban ${availablePage} oldalt adna, ` +
        `a határ ${MAX_PAGES}: az ablak számai csonkák lennének. Szűkebb ablak kell.`,
    );
  }
}

const KIND_CODE: Record<NavInvoiceDigestItem["invoiceOperation"], string> = {
  CREATE: "SZ",
  STORNO: "SS",
  MODIFY: "HS",
};

/** A NAV `PaymentMethodType` értékei, ahogy a lapon olvasható (a zárt `paymentMethodUnified` a Számlázz.hu-é, itt üres). */
const PAYMENT_METHOD: Record<string, string> = {
  TRANSFER: "átutalás",
  CASH: "készpénz",
  CARD: "bankkártya",
  VOUCHER: "utalvány",
  OTHER: "egyéb",
};

/** A vevő neve, ha a NAV nem adja (nem adóalany magánszemély; specifikáció 95., 108. o.). */
export const NAV_PRIVATE_PERSON_NAME = "Magánszemély (a NAV nem adja a nevét)";

const calendarDay = (text: string) =>
  new Date(`${text.slice(0, 10)}T00:00:00.000Z`);

/**
 * EGY NAV DIGEST-TÉTEL A KÜLSŐ SZÁMLÁK KÖZÉ. Tiszta függvény. `null`, ha a digestben nincs nettó vagy áfa: összeg nélküli sort
 * nem veszünk fel (a lista és a párosítás összegre épül), a futás megszámolja.
 */
export function navOutboundRow(
  item: NavInvoiceDigestItem,
): Prisma.ExternalBillingDocumentCreateManyInput | null {
  if (
    item.invoiceNetAmount === undefined ||
    item.invoiceVatAmount === undefined
  )
    return null;
  const net = new Prisma.Decimal(item.invoiceNetAmount);
  const vat = new Prisma.Decimal(item.invoiceVatAmount);
  return {
    source: NAV_SOURCE,
    externalId: invoiceNumberKey(item.invoiceNumber),
    feedMessageId: `NAV:${item.transactionId ?? "-"}:${item.index ?? 0}`,
    feedReceivedAt: new Date(item.insDate),
    kindCode: KIND_CODE[item.invoiceOperation],
    documentNumber: item.invoiceNumber.trim(),
    electronic:
      item.invoiceAppearance === "ELECTRONIC" ||
      item.invoiceAppearance === "EDI",
    issueDate: calendarDay(item.invoiceIssueDate),
    fulfillmentDate: item.invoiceDeliveryDate
      ? calendarDay(item.invoiceDeliveryDate)
      : null,
    dueDate: item.paymentDate ? calendarDay(item.paymentDate) : null,
    paymentMethod: item.paymentMethod
      ? (PAYMENT_METHOD[item.paymentMethod] ?? item.paymentMethod)
      : null,
    paymentMethodUnified: null,
    currency: (item.currency ?? "HUF").toUpperCase(),
    customerName: item.customerName ?? NAV_PRIVATE_PERSON_NAME,
    customerTaxNumber: item.customerTaxNumber ?? null,
    netAmount: net.toFixed(2),
    vatAmount: vat.toFixed(2),
    grossAmount: net.plus(vat).toFixed(2),
    lines: [],
    paymentsKnown: null,
    pdfMissingReason: "NAV_NO_PDF",
  };
}

export interface NavOutboundWriteResult {
  created: number;
  /** a NAV-ból felvett eredeti, amit egy sztornó most érvénytelenített */
  cancelled: number;
  /** összeg nélküli tétel: nem vettük fel */
  skippedNoAmount: number;
}

export interface NavOutboundWriter {
  write(
    items: readonly NavInvoiceDigestItem[],
  ): Promise<NavOutboundWriteResult>;
}

/**
 * A HIÁNYZÓK FELVÉTELE. Egy ablak egy tranzakció. Előbb a sorok, utána a sztornó: így egy ugyanebben az ablakban felvett eredetit is
 * érvénytelenít. Csak a NAV-ból felvett eredetihez nyúl: a Számlázz.hu sor sztornóját a feed hozza. A `skipDuplicates` miatt egy
 * újrafuttatás (vagy két egyidejű) nem ad második sort.
 */
export const prismaNavOutboundWriter: NavOutboundWriter = {
  async write(items) {
    const rows = items.flatMap((item) => {
      const row = navOutboundRow(item);
      return row ? [row] : [];
    });
    const originals = items
      .filter(
        (item) =>
          item.invoiceOperation === "STORNO" && item.originalInvoiceNumber,
      )
      .map((item) => invoiceNumberKey(item.originalInvoiceNumber!));
    return prisma.$transaction(async (transaction) => {
      const created = rows.length
        ? await transaction.externalBillingDocument.createMany({
            data: rows,
            skipDuplicates: true,
          })
        : { count: 0 };
      const cancelled = originals.length
        ? await transaction.externalBillingDocument.updateMany({
            where: {
              source: NAV_SOURCE,
              externalId: { in: originals },
              cancelled: false,
            },
            data: { cancelled: true },
          })
        : { count: 0 };
      return {
        created: created.count,
        cancelled: cancelled.count,
        skippedNoAmount: items.length - rows.length,
      };
    });
  },
};

export type NavOutboundRunResult = NavOutboundWindowResult &
  Partial<NavOutboundWriteResult> & {
    /** eBIZ-számla (EINV) a határnap előtti kelttel: nem vettük fel */
    skippedEbizCutoff?: number;
  };

/**
 * AZ eBIZ RÉGI SZÁMLÁI NEM KELLENEK (Balázs, 2026-10-02 19:44 UTC: „Ebizbol nem kellenek a regi szamlak. Csak oktober 1-tol”;
 * acrobot 58116: a visszatöltés ezt nem írja felül). Az eBIZ szinkron a határnap előtti EINV számlát soha nem hozza be, ezért a NAV
 * sem: a száraz futás hiányzóként mutatja, az írás kihagyja és megszámolja.
 */
export function beforeEbizCutoff(
  item: NavInvoiceDigestItem,
  since: string,
): boolean {
  return (
    navOutboundSeries(item.invoiceNumber).trim().toUpperCase() === "EINV" &&
    item.invoiceIssueDate.slice(0, 10) < since
  );
}

/**
 * LASSAN (Balázs, 2026-11-20 13:21 UTC, acrobot 58122: a NAV ne tiltson le a terhelés miatt): két digest-hívás között legalább
 * ennyi szünet, ablakon és oldalon át is. Egy év visszatöltése így is néhány perc (13 ablak, ablakonként egy-két oldal).
 */
export const NAV_PAUSE_MS = 2000;

export class NavOutboundBackfill {
  constructor(
    private readonly client: Pick<NavOnlineInvoiceClient, "queryInvoiceDigest">,
    private readonly credentials: Pick<NavCredentialsService, "resolve">,
    private readonly lookup: NavOutboundPresentLookup = prismaNavOutboundPresent,
    private readonly writer: NavOutboundWriter = prismaNavOutboundWriter,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** Szárazon, ablakonként; a NAV hibája (például a 9-es: nincs jogosultság) a hívóhoz jut, megnevezve. */
  dryRun(options: {
    from: Date;
    to: Date;
    onWindow?: (result: NavOutboundRunResult) => void;
  }): Promise<NavOutboundRunResult[]> {
    return this.run({ ...options, apply: false });
  }

  async run(options: {
    from: Date;
    to: Date;
    apply: boolean;
    /** az eBIZ határnapja (`ebizSince`, ÉÉÉÉ-HH-NN); alapból Balázs napja */
    ebizSince?: string;
    /** szünet két NAV-hívás között, ezredmásodperc (alapból `NAV_PAUSE_MS`) */
    pauseMs?: number;
    onWindow?: (result: NavOutboundRunResult) => void;
  }): Promise<NavOutboundRunResult[]> {
    const ebizSince = options.ebizSince ?? EBIZ_DEFAULT_SINCE;
    const pauseMs = options.pauseMs ?? NAV_PAUSE_MS;
    const credentials = await this.credentials.resolve();
    const results: NavOutboundRunResult[] = [];
    let calls = 0;
    for (const window of issueDateWindows(options.from, options.to)) {
      const items: NavInvoiceDigestItem[] = [];
      let page = 1;
      for (; ; page += 1) {
        if (calls++ > 0) await this.sleep(pauseMs);
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
        if (page >= MAX_PAGES)
          throw new NavOutboundPageLimitError(window, result.availablePage);
      }
      const present = await this.lookup.present(
        items.map((item) => item.invoiceNumber),
      );
      const result: NavOutboundRunResult = classifyNavOutbound(
        items,
        present,
        window,
      );
      if (options.apply) {
        const missing = new Set(result.missingNumbers);
        const wanted = items.filter((item) => missing.has(item.invoiceNumber));
        const kept = wanted.filter(
          (item) => !beforeEbizCutoff(item, ebizSince),
        );
        Object.assign(result, await this.writer.write(kept), {
          skippedEbizCutoff: wanted.length - kept.length,
        });
      }
      options.onWindow?.(result);
      results.push(result);
    }
    return results;
  }
}

/** `--from=ÉÉÉÉ-HH-NN` (kötelező), `--to=ÉÉÉÉ-HH-NN` (alapból ma), `--apply` (ír; nélküle száraz). */
export function parseNavOutboundArgs(
  argv: readonly string[],
  now: Date = new Date(),
): { from: Date; to: Date; apply: boolean } {
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
  const from = day(value("from"), "from");
  if (!from) throw new Error("Kötelező: --from=ÉÉÉÉ-HH-NN.");
  const to =
    day(value("to"), "to") ??
    new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (from.getTime() > to.getTime())
    throw new Error("A --from a --to utáni nap.");
  return { from, to, apply: argv.includes("--apply") };
}
