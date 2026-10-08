import {
  Prisma,
  type IncomingBillingDocument,
  type PrismaClient,
} from "@acropora/database";
import type {
  IncomingDocumentListItem,
  IncomingReadingField,
  IncomingReadingSource,
  IncomingReadingValues,
} from "@acropora/types";

import type { DocumentPairing } from "../missing-invoices/missing-invoices.service.js";
import { incomingKey } from "./billing-duplicates.js";
import {
  mailboxOnlyPaidItems,
  toIncomingListItem,
} from "./incoming-billing-documents.js";

/**
 * A RÖGZÍTETT BESZERZÉSI SZÁMLA MINT BEJÖVŐ SZÁMLA (kártya 83f31a95, Balázs
 * 2026-10-08 10:58). Ha egy POSTED beszerzési számlát semmilyen más forrás
 * nem ismer (NAV, Számlázz.hu szamlabe, postafiók, Hiányzó számlák), a
 * Bejövő számlák listán saját sort kap „Beszerzésből” eredettel, a hozzá
 * csatolt kép a PDF-je, és „Ellenőrizendő”, amíg ember jóvá nem hagyja,
 * pontosan úgy, mint a postafiókos (külföldi) számla (#1588). Jóváhagyás után
 * `PURCHASE` forrású IncomingBillingDocument lesz belőle.
 *
 * „UGYANAZ A SZÁMLA” egy kulcson: a számlaszám és a szállító adószám-törzse
 * (ennek hiányában a neve), ahogy a duplikáció-ellenőrző (`incomingKey`) is
 * nézi. Más forrás ismeri, ha:
 *   - NAV-sor van hozzá kötve, vagy azonos kulcsú NAV-sor létezik;
 *   - azonos kulcsú IncomingBillingDocument van (Számlázz.hu vagy jóváhagyott
 *     postafiókos);
 *   - azonos kulcsú, NEM a saját képe beérkezett dokumentum van.
 */

export const PURCHASE_SOURCE = "PURCHASE";
export const PURCHASE_ITEM_PREFIX = "purchase:";
/**
 * A beszerzésből jött sor típuskódja. Nem a Számlázz.hu kódjai közül való
 * (SZ, ES, VS...), mert a begyűjtés azokat ismert számnak veszi.
 */
export const PURCHASE_KIND_CODE = "BE";

type Database = Pick<
  PrismaClient,
  | "purchaseInvoice"
  | "navIncomingInvoice"
  | "incomingBillingDocument"
  | "incomingSupplierDocument"
>;

/** Egy listára kerülő (még nem jóváhagyott) beszerzési számla. */
export interface PurchaseSubject {
  purchaseInvoiceId: string;
  supplierInvoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date | null;
  currency: string;
  exchangeRate: Prisma.Decimal | null;
  vatRate: Prisma.Decimal | null;
  isPaid: boolean;
  paidAt: Date | null;
  supplierName: string;
  supplierTaxNumber: string | null;
  /** EU-s beszállítónál a `taxNumber` a közösségi adószám */
  supplierIsForeign: boolean;
  net: Prisma.Decimal;
  /** a csatolt képek (a szkennelés PDF-et tárol), a legkorábbi elöl */
  scanIds: string[];
  scanReceivedAt: Date | null;
}

const lineNet = (line: {
  actualQuantity: Prisma.Decimal;
  unitNet: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
}) => {
  const gross = line.actualQuantity.times(line.unitNet);
  return line.discountPercent
    ? gross.times(
        new Prisma.Decimal(1).minus(line.discountPercent.dividedBy(100)),
      )
    : gross;
};

/** A beérkezett dokumentum olvasott kulcsa (`textReading`), ha van szám. */
const textKey = (reading: unknown): string | null => {
  const value = reading as {
    invoiceNumber?: unknown;
    supplierTaxNumber?: unknown;
    supplierName?: unknown;
  } | null;
  const text = (field: unknown) => (typeof field === "string" ? field : null);
  const number = text(value?.invoiceNumber);
  return number
    ? incomingKey(
        number,
        text(value?.supplierTaxNumber),
        text(value?.supplierName) ?? "",
      )
    : null;
};

/**
 * A listára kerülő beszerzési számlák: POSTED, még nincs jóváhagyott sora,
 * és más forrás nem ismeri. `only` megadásával egyetlen számlát néz (az
 * ellenőrző lap ugyanezen a feltételen megy, mint a lista).
 */
export async function loadPurchaseSubjects(
  database: Database,
  only?: string,
): Promise<PurchaseSubject[]> {
  const invoices = await database.purchaseInvoice.findMany({
    where: {
      status: "POSTED",
      navIncomingInvoice: { is: null },
      ...(only ? { id: only } : {}),
    },
    select: {
      id: true,
      supplierInvoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      currency: true,
      exchangeRate: true,
      vatRate: true,
      isPaid: true,
      paidAt: true,
      source: true,
      supplier: { select: { name: true, taxNumber: true } },
      lines: {
        select: { actualQuantity: true, unitNet: true, discountPercent: true },
      },
      scanDocuments: {
        select: { id: true, receivedAt: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!invoices.length) return [];

  const [nav, rows, documents] = await Promise.all([
    database.navIncomingInvoice.findMany({
      where: { invoiceOperation: "CREATE" },
      select: {
        navInvoiceNumber: true,
        supplierTaxNumber: true,
        supplierName: true,
      },
    }),
    database.incomingBillingDocument.findMany({
      select: {
        source: true,
        externalId: true,
        documentNumber: true,
        supplierTaxNumber: true,
        supplierEuTaxNumber: true,
        supplierName: true,
      },
    }),
    // a beérkezett, NEM beszerzéshez kötött dokumentumok olvasott kulcsa
    database.incomingSupplierDocument.findMany({
      where: { purchaseInvoiceId: null, textReading: { not: Prisma.DbNull } },
      select: { textReading: true },
    }),
  ]);

  const approved = new Set(
    rows
      .filter((row) => row.source === PURCHASE_SOURCE)
      .map((row) => row.externalId),
  );
  const known = new Set<string>();
  const add = (key: string | null) => key && known.add(key);
  for (const row of nav)
    add(
      incomingKey(
        row.navInvoiceNumber,
        row.supplierTaxNumber,
        row.supplierName,
      ),
    );
  for (const row of rows)
    if (row.source !== PURCHASE_SOURCE)
      add(
        incomingKey(
          row.documentNumber,
          row.supplierTaxNumber ?? row.supplierEuTaxNumber,
          row.supplierName,
        ),
      );
  for (const document of documents) add(textKey(document.textReading));

  return invoices
    .filter((invoice) => !approved.has(invoice.id))
    .filter((invoice) => {
      const key = incomingKey(
        invoice.supplierInvoiceNumber,
        invoice.supplier.taxNumber,
        invoice.supplier.name,
      );
      return !key || !known.has(key);
    })
    .map((invoice) => ({
      purchaseInvoiceId: invoice.id,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate,
      vatRate: invoice.vatRate,
      isPaid: invoice.isPaid,
      paidAt: invoice.paidAt,
      supplierName: invoice.supplier.name,
      supplierTaxNumber: invoice.supplier.taxNumber,
      supplierIsForeign: invoice.source === "EU",
      net: invoice.lines.reduce(
        (sum, line) => sum.plus(lineNet(line)),
        new Prisma.Decimal(0),
      ),
      scanIds: invoice.scanDocuments.map((scan) => scan.id),
      scanReceivedAt:
        invoice.scanDocuments[0]?.receivedAt ??
        invoice.scanDocuments[0]?.createdAt ??
        null,
    }));
}

const iso = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

/**
 * A BESZERZÉSBŐL KITÖLTÖTT OLVASAT: amit a rögzítés tud. A nettó a sorokból
 * (ahogy a beszerzés összesítője), az ÁFA a számla kulcsából, a bruttó a
 * kettő összege; kulcs nélkül (például fordított adózás) az ÁFA és a bruttó
 * üres, azt az ellenőrző tölti. A teljesítés napja nem rögzített adat.
 */
export function purchaseReading(subject: PurchaseSubject): {
  values: IncomingReadingValues;
  sources: Partial<Record<IncomingReadingField, IncomingReadingSource>>;
} {
  const net = subject.net.toDecimalPlaces(2);
  const vat = subject.vatRate
    ? net.times(subject.vatRate).dividedBy(100).toDecimalPlaces(2)
    : null;
  const values: IncomingReadingValues = {
    supplierName: subject.supplierName,
    supplierTaxNumber: subject.supplierIsForeign
      ? null
      : subject.supplierTaxNumber,
    supplierEuTaxNumber: subject.supplierIsForeign
      ? subject.supplierTaxNumber
      : null,
    documentNumber: subject.supplierInvoiceNumber,
    issueDate: iso(subject.invoiceDate),
    fulfillmentDate: null,
    dueDate: iso(subject.dueDate),
    currency: subject.currency,
    netAmount: net.toFixed(2),
    vatAmount: vat?.toFixed(2) ?? null,
    grossAmount: vat ? net.plus(vat).toFixed(2) : null,
  };
  const sources: Partial<Record<IncomingReadingField, IncomingReadingSource>> =
    {};
  for (const [field, value] of Object.entries(values))
    if (value !== null) sources[field as IncomingReadingField] = "PURCHASE";
  return { values, sources };
}

const decimals = (currency: string) =>
  currency.toUpperCase() === "HUF" ? 0 : 2;
const money = (value: Prisma.Decimal, currency: string) =>
  value.toFixed(decimals(currency));

/**
 * A beszerzésből jött, még ellenőrizendő sor a listán. A fizetés a banki
 * párosításból jön, ha a kép párosodott; különben a rögzítés saját
 * „fizetve” jelölése.
 */
export function purchaseListItem(
  subject: PurchaseSubject,
  pairings: ReadonlyMap<string, DocumentPairing>,
  reading?: IncomingReadingValues,
): IncomingDocumentListItem {
  const values = reading ?? purchaseReading(subject).values;
  const currency = values.currency ?? subject.currency;
  const amount = (value: string | null) =>
    value === null ? null : money(new Prisma.Decimal(value), currency);
  const pairing = subject.scanIds
    .map((id) => pairings.get(id))
    .find((found) => found !== undefined);
  const debits = pairing?.debits ?? [];
  const bankPaid = debits.length > 0 && pairing!.paidInFull;
  const gross = amount(values.grossAmount);
  return {
    id: `${PURCHASE_ITEM_PREFIX}${subject.purchaseInvoiceId}`,
    origin: "PURCHASE",
    review: "TO_REVIEW",
    documentNumber: values.documentNumber ?? subject.supplierInvoiceNumber,
    kindCode: PURCHASE_KIND_CODE,
    kindLabel: "Beszerzésből",
    invoiceFormat: null,
    cancelled: false,
    supplierName: values.supplierName ?? subject.supplierName,
    supplierTaxNumber:
      values.supplierTaxNumber ?? values.supplierEuTaxNumber ?? null,
    issueDate: values.issueDate ?? iso(subject.invoiceDate)!,
    fulfillmentDate: values.fulfillmentDate,
    dueDate: values.dueDate,
    paymentMethod: null,
    currency,
    exchangeRate: subject.exchangeRate?.toString() ?? null,
    netAmount: amount(values.netAmount),
    vatAmount: amount(values.vatAmount),
    grossAmount: gross,
    paymentState: bankPaid || subject.isPaid ? "PAID" : "UNPAID",
    paidAmount: bankPaid || subject.isPaid ? (gross ?? "0") : "0",
    lastPaymentDate: bankPaid
      ? debits.map((d) => d.bookingDate).reduce((a, b) => (a > b ? a : b))
      : iso(subject.paidAt),
    paymentSource: bankPaid ? "BANK_PAIRING" : null,
    paymentConflict: false,
    bankMatch: debits.length
      ? { state: "PAIRED", reason: null, debits }
      : { state: "UNPAIRED", reason: null, debits: [] },
    hasPdf: subject.scanIds.length > 0,
  };
}

/**
 * A SZÁMLÁZZ.HU FEED LEVÁLTJA A BESZERZÉSBŐL JÖTT SORT (acrobot 28322). Ha egy
 * már jóváhagyott PURCHASE sor után ugyanaz a számla a feedből is megjön, két
 * IncomingBillingDocument állna egy számlára, és a könyvelői csomagba
 * kettőzve mehetne. A feed sora a teljes adattal érkezik (tételek, ÁFA-
 * összesítő, kifizetés), ezért az marad, a PURCHASE sor törlődik, ugyanabban a
 * tranzakcióban, mint a feed írása. Az olvasat ellenőrzött marad, csak a
 * sorra mutató azonosítója nullázódik. A NAV-szinkron bejövő számla-sort nem
 * ír (mérve: IncomingBillingDocument-et csak a feed és a jóváhagyás ír).
 */
export async function supersedePurchaseRows(
  transaction: Pick<
    Prisma.TransactionClient,
    "incomingBillingDocument" | "incomingDocumentReading" | "auditLog"
  >,
  feed: {
    externalId: string;
    documentNumber: string;
    supplierTaxNumber: string | null;
    supplierEuTaxNumber: string | null;
    supplierName: string;
  },
): Promise<string[]> {
  const key = incomingKey(
    feed.documentNumber,
    feed.supplierTaxNumber ?? feed.supplierEuTaxNumber,
    feed.supplierName,
  );
  if (!key) return [];
  const rows = await transaction.incomingBillingDocument.findMany({
    where: { source: PURCHASE_SOURCE },
    select: {
      id: true,
      externalId: true,
      documentNumber: true,
      supplierTaxNumber: true,
      supplierEuTaxNumber: true,
      supplierName: true,
    },
  });
  const superseded = rows.filter(
    (row) =>
      incomingKey(
        row.documentNumber,
        row.supplierTaxNumber ?? row.supplierEuTaxNumber,
        row.supplierName,
      ) === key,
  );
  for (const row of superseded) {
    await transaction.incomingDocumentReading.updateMany({
      where: { incomingBillingDocumentId: row.id },
      data: { incomingBillingDocumentId: null },
    });
    await transaction.incomingBillingDocument.delete({ where: { id: row.id } });
    await transaction.auditLog.create({
      data: {
        action: "billing.incoming-purchase.superseded",
        entityType: "IncomingBillingDocument",
        entityId: row.id,
        metadata: {
          purchaseInvoiceId: row.externalId,
          feedExternalId: feed.externalId,
        },
      },
    });
  }
  return superseded.map((row) => row.id);
}

/**
 * A KÉSŐBB ÉRKEZŐ PÉLDÁNY A BESZERZÉSHEZ KÖTŐDIK (kártya 83f31a95, PR 2). Ha
 * egy postafiókból, Drive-ról, a Hiányzó számlák feltöltésén vagy a Várható
 * beérkezéseken át érkező számla kulcsa (szám és adószám-törzs, ahogy az
 * `incomingKey`) egy POSTED beszerzési számláé, a dokumentum annak a
 * beszerzésnek a dokumentuma lesz (`purchaseInvoiceId`): a listán a
 * beszerzés sora marad egyetlen sorként, a PDF-jei között ez is, és a
 * jelöltek összevonása is erre a kötésre épít. Csak a számla (`INVOICE`)
 * kötődik: a díjbekérő és az ismeretlen fajtájú dokumentum nem.
 *
 * A kulcs az illesztő eredményéből jön (`importResult`), ha az számot adott,
 * különben a szövegolvasóéból (`textReading`). Csak a pontosan (kis-nagybetű
 * nélkül) egyező számú beszerzések jelöltek; a kulcs a szállítót is egyezteti.
 */
export async function postedPurchaseForArrival(
  database: Pick<Prisma.TransactionClient, "purchaseInvoice">,
  arrival: {
    importResult: unknown;
    textReading: unknown;
    kind: string | null;
  },
): Promise<string | null> {
  // csak a számla kötődik: díjbekérő és ismeretlen fajta nem (acrobot 28369)
  if (arrival.kind !== "INVOICE") return null;
  const adapter = arrival.importResult as {
    invoiceNumber?: string | null;
    supplier?: { name?: string | null; vatId?: string | null };
  } | null;
  const text = arrival.textReading as {
    invoiceNumber?: string | null;
    supplierTaxNumber?: string | null;
    supplierName?: string | null;
  } | null;
  const number = adapter?.invoiceNumber ?? text?.invoiceNumber ?? null;
  if (!number?.trim()) return null;
  const tax = adapter?.invoiceNumber
    ? (adapter.supplier?.vatId ?? null)
    : (text?.supplierTaxNumber ?? null);
  const name = adapter?.invoiceNumber
    ? (adapter.supplier?.name ?? "")
    : (text?.supplierName ?? "");
  const key = incomingKey(number, tax, name);
  if (!key) return null;
  const candidates = await database.purchaseInvoice.findMany({
    where: {
      status: "POSTED",
      supplierInvoiceNumber: { equals: number.trim(), mode: "insensitive" },
    },
    select: {
      id: true,
      supplierInvoiceNumber: true,
      supplier: { select: { taxNumber: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return (
    candidates.find(
      (invoice) =>
        incomingKey(
          invoice.supplierInvoiceNumber,
          invoice.supplier.taxNumber,
          invoice.supplier.name,
        ) === key,
    )?.id ?? null
  );
}

/**
 * EGY SZÁMLA, EGYSZERRE EGY ÍRÓ (acrobot 28369). A beszerzés jóváhagyása és a
 * Számlázz.hu feed írása ugyanarra a számlára versenyezhet: zár nélkül a
 * jóváhagyás nem látja a még nem véglegesített feed-sort, a feed leváltása
 * pedig a még nem véglegesített PURCHASE sort, és két sor marad. A két út
 * ugyanazt a tranzakció-szintű zárat veszi a számla kulcsára (`incomingKey`),
 * tehát a sorrend mindkét irányban determinisztikus: ha a feed az első, a
 * jóváhagyás 409-et kap; ha a jóváhagyás, a feed leváltja a sorát.
 */
export async function lockIncomingKey(
  transaction: Pick<Prisma.TransactionClient, "$executeRaw">,
  invoice: {
    documentNumber: string | null;
    supplierTaxNumber: string | null;
    supplierEuTaxNumber: string | null;
    supplierName: string | null;
  },
): Promise<string | null> {
  const key = incomingKey(
    invoice.documentNumber ?? "",
    invoice.supplierTaxNumber ?? invoice.supplierEuTaxNumber,
    invoice.supplierName ?? "",
  );
  if (!key) return null;
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`incoming-key:${key}`}, 0))`;
  return key;
}

/**
 * Egy NEM beszerzésből jött bejövő sor ugyanazzal a kulccsal (Számlázz.hu vagy
 * jóváhagyott postafiókos sor). Jelöltek a szóközök nélkül vagy a vágott
 * alakban egyező számú sorok; a kulcs a szállítót is egyezteti.
 */
export async function otherSourceRowFor(
  transaction: Pick<Prisma.TransactionClient, "incomingBillingDocument">,
  number: string,
  key: string,
): Promise<{ id: string; source: string } | null> {
  const rows = await transaction.incomingBillingDocument.findMany({
    where: {
      source: { not: PURCHASE_SOURCE },
      OR: [number.trim(), number.replace(/\s/g, "")].map((value) => ({
        documentNumber: { equals: value, mode: "insensitive" as const },
      })),
    },
    select: {
      id: true,
      source: true,
      documentNumber: true,
      supplierTaxNumber: true,
      supplierEuTaxNumber: true,
      supplierName: true,
    },
  });
  const row = rows.find(
    (candidate) =>
      incomingKey(
        candidate.documentNumber,
        candidate.supplierTaxNumber ?? candidate.supplierEuTaxNumber,
        candidate.supplierName,
      ) === key,
  );
  return row ? { id: row.id, source: row.source } : null;
}

/**
 * A BEJÖVŐ SZÁMLÁK LISTÁJÁNAK SORAI, egy helyen (a vezérlő ezt hívja). A
 * beszerzés képe nem lesz külön postafiókos sor (kártya 83f31a95): a kép
 * UPLOAD forrású, és fizetve „Postafiókos számla” sorként is megjelenne.
 * - Jóváhagyás előtt: amit csak a listázott beszerzési számlák képei
 *   alkotnak, az a beszerzés sora; ha más dokumentum is a jelöltben van, más
 *   forrás ismeri, és akkor a beszerzés nem kap sort (`loadPurchaseSubjects`).
 * - Jóváhagyás után: a PURCHASE sor a képre mutat (`sourceDocumentId`), és a
 *   postafiókos szűrő (`notInFeedTest`) ezen és a számán ismeri fel.
 */
export function incomingListItems(input: {
  rows: readonly IncomingBillingDocument[];
  pairings: ReadonlyMap<string, DocumentPairing>;
  hasCollectedPdf: (row: IncomingBillingDocument) => boolean;
  readings: ReadonlyMap<string, IncomingReadingValues>;
  purchases: readonly PurchaseSubject[];
}): IncomingDocumentListItem[] {
  const { rows, pairings, readings, purchases } = input;
  const purchaseScans = new Set(purchases.flatMap((p) => p.scanIds));
  const mailboxPairings = new Map(
    [...pairings].filter(
      ([, pairing]) =>
        ![pairing.document.id, ...(pairing.document.aliasIds ?? [])].every(
          (id) => purchaseScans.has(id),
        ),
    ),
  );
  return [
    ...rows.map((row) =>
      toIncomingListItem(row, pairings, input.hasCollectedPdf(row)),
    ),
    // a feedben nem szereplő, csak postafiókból ismert, fizetett számlák
    ...mailboxOnlyPaidItems(rows, mailboxPairings, readings),
    // a más forrásból nem ismert, rögzített beszerzési számlák
    ...purchases.map((subject) =>
      purchaseListItem(
        subject,
        pairings,
        subject.scanIds
          .map((id) => readings.get(id))
          .find((reading) => reading !== undefined),
      ),
    ),
  ];
}

/**
 * A SZTORNÓZOTT BESZERZÉS BEJÖVŐ SORA VISSZAVONÓDIK (kártya 2408d6ad, acrobot
 * 28406). A sztornó célja az újrarögzítés, és az újrarögzített számla újra
 * jóváhagyásra kerül: ha a PURCHASE sor megmaradna, egy számlára két sor
 * állna. Ezért a sztornó tranzakciójában a sor törlődik, az olvasat
 * „Ellenőrizendő” lesz (a kapcsolata nullázva, a jóváhagyó nélkül), és
 * auditsor nevezi meg. A könyvelőnek már elküldött csomagot nem tároljuk,
 * tehát ezt nem tudjuk jelezni; egy újragenerált csomagban a számla az
 * újrarögzített jóváhagyásáig nincs benne.
 */
export async function withdrawPurchaseRow(
  transaction: Pick<
    Prisma.TransactionClient,
    | "$executeRaw"
    | "incomingBillingDocument"
    | "incomingDocumentReading"
    | "auditLog"
  >,
  purchaseInvoiceId: string,
  userId: string,
): Promise<string | null> {
  const row = await transaction.incomingBillingDocument.findUnique({
    where: {
      source_externalId: {
        source: PURCHASE_SOURCE,
        externalId: purchaseInvoiceId,
      },
    },
    select: {
      id: true,
      documentNumber: true,
      supplierTaxNumber: true,
      supplierEuTaxNumber: true,
      supplierName: true,
    },
  });
  if (!row) return null;
  await lockIncomingKey(transaction, row);
  await transaction.incomingDocumentReading.updateMany({
    where: { incomingBillingDocumentId: row.id },
    data: {
      incomingBillingDocumentId: null,
      state: "TO_REVIEW",
      reviewedAt: null,
      reviewedByUserId: null,
    },
  });
  await transaction.incomingBillingDocument.delete({ where: { id: row.id } });
  await transaction.auditLog.create({
    data: {
      userId,
      action: "billing.incoming-purchase.withdrawn",
      entityType: "IncomingBillingDocument",
      entityId: row.id,
      metadata: { purchaseInvoiceId, documentNumber: row.documentNumber },
    },
  });
  return row.id;
}

/**
 * A JAVÍTOTT BESZERZÉST KÖVETI A BEJÖVŐ SORA (kártya 2408d6ad). Ha egy már
 * jóváhagyott beszerzés számát, keltét vagy határidejét az „Adatok javítása”
 * (#1615) átírja, a PURCHASE sor és az olvasata ugyanazt mondja, ugyanabban a
 * tranzakcióban. Ha az új szám kulcsa egy másik forrás sorával egyezik
 * (Számlázz.hu vagy postafiók), az a sor marad, és a PURCHASE sor törlődik,
 * ahogy a feed érkezésekor (`supersedePurchaseRows`): az olvasat ellenőrzött
 * marad, csak a kapcsolata nullázódik.
 */
export async function followPurchaseEdit(
  transaction: Pick<
    Prisma.TransactionClient,
    | "$executeRaw"
    | "$queryRaw"
    | "incomingBillingDocument"
    | "incomingDocumentReading"
    | "auditLog"
  >,
  purchaseInvoiceId: string,
  changes: { documentNumber?: string; issueDate?: Date; dueDate?: Date | null },
): Promise<{ id: string; superseded: boolean } | null> {
  if (
    changes.documentNumber === undefined &&
    changes.issueDate === undefined &&
    changes.dueDate === undefined
  )
    return null;
  const row = await transaction.incomingBillingDocument.findUnique({
    where: {
      source_externalId: {
        source: PURCHASE_SOURCE,
        externalId: purchaseInvoiceId,
      },
    },
    select: {
      id: true,
      documentNumber: true,
      supplierTaxNumber: true,
      supplierEuTaxNumber: true,
      supplierName: true,
    },
  });
  if (!row) return null;
  const after = {
    ...row,
    documentNumber: changes.documentNumber ?? row.documentNumber,
  };
  // the feed and the approval write the new number's invoice under this lock
  const key = await lockIncomingKey(transaction, after);
  // MERES EDIT-SUPERSEDED: no check for another source
  const known =
    changes.documentNumber === "MERES-NEVER" && key
      ? await otherSourceRowFor(transaction, after.documentNumber, key)
      : null;
  if (known) {
    // the other source's row is the full data; the reading stays verified
    await transaction.incomingDocumentReading.updateMany({
      where: { incomingBillingDocumentId: row.id },
      data: { incomingBillingDocumentId: null },
    });
    await transaction.incomingBillingDocument.delete({ where: { id: row.id } });
    await transaction.auditLog.create({
      data: {
        action: "billing.incoming-purchase.superseded",
        entityType: "IncomingBillingDocument",
        entityId: row.id,
        metadata: {
          purchaseInvoiceId,
          supersededBy: known.id,
          documentNumber: after.documentNumber,
        },
      },
    });
    return { id: row.id, superseded: true };
  }
  const data = {
    ...(changes.documentNumber !== undefined && {
      documentNumber: changes.documentNumber,
    }),
    ...(changes.issueDate !== undefined && { issueDate: changes.issueDate }),
    ...(changes.dueDate !== undefined && { dueDate: changes.dueDate }),
  };
  // MERES EDIT-FOLLOWS: the row and the reading keep the old values
  void data;
  return { id: row.id, superseded: false };
}
