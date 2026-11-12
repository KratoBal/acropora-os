import { Prisma, type IncomingBillingDocument } from "@acropora/database";
import type {
  BillingPaymentSource,
  IncomingBankMatch,
  IncomingDocumentDetail,
  IncomingDocumentLine,
  IncomingDocumentListItem,
  IncomingDocumentListQuery,
  IncomingDocumentListResponse,
  IncomingPaymentState,
  IncomingReadingValues,
  IncomingRelatedDocument,
} from "@acropora/types";
import { paymentStateOf as sharedPaymentStateOf } from "@acropora/types";

import type { DocumentPairing } from "../missing-invoices/missing-invoices.service.js";
import {
  normalizeName,
  shownNumber,
} from "../missing-invoices/missing-invoice-matching.js";
import { supplierTaxBase } from "./billing-duplicates.js";
import {
  identityTaxNumber,
  invoiceIdentity,
  sameGross,
} from "./invoice-identity.js";
import { externalKindLabel as feedKindLabel } from "./billing-document-list.js";

/**
 * A POSTAFIÓKOS SZÁMLA SAJÁT TÍPUSKÓDJA (kártya e4c3b0fb, barracuda
 * visszamérése, acrobot 27623). Nem `SZ`: a begyűjtés `FEED_BASE_KINDS`
 * listája (`SZ`, `ES`, `VS`) a Számlázz.hu sorok számait ismert számnak veszi
 * más PDF-ek felismerésénél, és ez a sor nem a Számlázz.hu-ból jön.
 */
export const MAILBOX_KIND_CODE = "MB";

export const externalKindLabel = (kindCode: string): string =>
  kindCode.toUpperCase() === MAILBOX_KIND_CODE
    ? "Postafiókos számla"
    : kindCode.toUpperCase() === "BE"
      ? "Beszerzésből"
      : feedKindLabel(kindCode);
import type {
  IncomingPayment,
  IncomingVatSummary,
} from "./incoming-szamlazz-invoice.js";

/**
 * A SZÁMLÁZÁS „BEJÖVŐ SZÁMLÁK” NÉZETE (Balázs újraterv-promptja, acrobot 25869):
 * a lista és az adatlap TISZTA FÜGGVÉNYEKKEL, a sorokból (IncomingBillingDocument)
 * és a Hiányzó számlák párosításából.
 *
 * A SZŰRÉS ÉS A LAPOZÁS MEMÓRIÁBAN FUT, nem az adatbázisban: a banki párosítás
 * számított, nem tárolt (a Hiányzó számlák számítása adja), tehát rá csak a
 * sorok után lehet szűrni. Élesen 2026-10-01-én 73 forrás-dokumentum áll; ha a
 * sorok száma egyszer ezres nagyságrendű lesz, a párosítás tárolása a lépés.
 */

const decimals = (currency: string) =>
  currency.toUpperCase() === "HUF" ? 0 : 2;
const money = (value: Prisma.Decimal, currency: string) =>
  value.toFixed(decimals(currency));
const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

/**
 * A KIFIZETÉSI ÁLLAPOT: a kimenő listával KÖZÖS számítás (`paymentStateOf` a
 * `@acropora/types`-ban; murena és nautilus, 2026-10-01). A tűrés forintnál 2 Ft
 * (az 5 forintos készpénz-kerekítés), devizánál fél cent, abszolút értékben.
 */
export function paymentStateOf(row: {
  paymentsKnown: boolean;
  paidAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  currency: string;
}): IncomingPaymentState {
  return sharedPaymentStateOf({
    paymentsKnown: row.paymentsKnown,
    paidAmount: row.paidAmount.toFixed(),
    grossAmount: row.grossAmount.toFixed(),
    currency: row.currency,
  });
}

/**
 * A BEJÖVŐ SZÁMLA SORÁHOZ PÁROSÍTOTT DOKUMENTUM: elébb a sor forrás-dokumentuma, és ha annak NINCS terhelése, a számla
 * AZONOSSÁGA (szám + szállító adószám-törzse vagy neve, az `inv:` kulcs). A niceshops-eset (2026-11-12): a terhelés egy
 * FELTÖLTÖTT dokumentumhoz párosodott, a bejövő számla-rekord más entitás ugyanazzal a számlaszámmal és adószámmal, ezért a
 * forrás-dokumentum szerinti keresés nem találta, és a számla „kifizetetlen” maradt egy már kifizetett terhelés mellett.
 * A saját párosítás, ha van terhelése, mindig előbb nyer: az azonosság csak a hiányt pótolja, a meglévőt nem írja felül.
 */
export function pairingOfRow<
  T extends Pick<DocumentPairing, "debits"> & {
    document?: { gross: Prisma.Decimal | null; currency: string };
  },
>(
  row: {
    sourceDocumentId: string | null;
    documentNumber?: string;
    supplierName?: string;
    supplierTaxNumber?: string | null;
    /** külföldi szállítónál itt áll az adószám (`identityTaxNumber`) */
    supplierEuTaxNumber?: string | null;
    /** az azonosság szerinti párosításhoz kell: az összeg és a deviza egyezése nélkül nem fizetett (`sameGross`) */
    grossAmount?: Prisma.Decimal;
    currency?: string;
  },
  pairings: ReadonlyMap<string, T>,
): T | undefined {
  const direct = row.sourceDocumentId
    ? pairings.get(row.sourceDocumentId)
    : undefined;
  if (direct && direct.debits.length > 0) return direct;
  const found =
    row.documentNumber && row.grossAmount && row.currency
      ? pairings.get(
          invoiceIdentity(
            row.documentNumber,
            identityTaxNumber(row.supplierTaxNumber, row.supplierEuTaxNumber),
            row.supplierName ?? "",
          ),
        )
      : undefined;
  const byIdentity =
    found?.document &&
    sameGross(
      { grossAmount: row.grossAmount!, currency: row.currency! },
      found.document,
    )
      ? found
      : undefined;
  if (byIdentity && byIdentity.debits.length > 0) return byIdentity;
  return direct ?? byIdentity;
}

/**
 * A BANKI PÁROSÍTÁS a Hiányzó számlák számításából, új logika nélkül. Nem
 * párosítandó CSAK két esetben (acrobot 25879): a számla nem a cégre szól, vagy
 * díjbekérő (a Számlázz.hu típusa D, vagy a párosító PROFORMA-nak olvasta).
 */
export function bankMatchOf(
  row: {
    sourceDocumentId: string | null;
    /** a számla azonossága (szám + adószám/név) a `sourceDocumentId` melletti második kulcs: lásd `pairingOfRow` */
    documentNumber?: string;
    supplierName?: string;
    supplierTaxNumber?: string | null;
    supplierEuTaxNumber?: string | null;
    kindCode: string;
    grossAmount: Prisma.Decimal;
    currency?: string;
    /** „Nem könyvelendő” (Balázs, 2026-10-26): ez nyer minden más ok előtt. */
    notBookable?: boolean;
  },
  pairings: ReadonlyMap<string, DocumentPairing>,
): IncomingBankMatch {
  if (row.notBookable)
    return { state: "NOT_TO_PAIR", reason: "NOT_BOOKABLE", debits: [] };
  const pairing = pairingOfRow(row, pairings);
  if (pairing?.payee === "NOT_COMPANY")
    return { state: "NOT_TO_PAIR", reason: "NOT_COMPANY", debits: [] };
  if (row.kindCode.toUpperCase() === "D" || pairing?.kind === "PROFORMA")
    return { state: "NOT_TO_PAIR", reason: "PROFORMA", debits: [] };
  if (pairing && pairing.debits.length > 0)
    return { state: "PAIRED", reason: null, debits: pairing.debits };
  // nulla végösszeg: nincs mit fizetni; a kézi párosítás fent nyer (847bca33)
  if (row.grossAmount.isZero())
    return { state: "NOT_TO_PAIR", reason: "ZERO_TOTAL", debits: [] };
  return { state: "UNPAIRED", reason: null, debits: [] };
}

/**
 * A KIFIZETETTSÉG A FEEDBŐL ÉS A BANKI PÁROSÍTÁSBÓL (acrobot 25988; élesen
 * mérve: 79 bejövő számlából csak 14-nél küldött a Számlázz.hu kifizetést, az
 * átutalásos 29-ből 3-nál, tehát a banki párosítás érdemben hozzáad):
 *
 *   a Számlázz.hu küldött kifizetést   az nyer (SZAMLAZZ); ha részben fizetettet
 *                                      mond, de a számla banki terheléshez
 *                                      párosítva van, az eltérés jelölve
 *   nincs kifizetés, de párosítva      NÁLUNK fizetett (BANK_PAIRING): a bruttó,
 *                                      a legutolsó terhelés napjával
 *   egyik sem                          a feed állapota, forrás nélkül
 *
 * „Párosítva” CSAK akkor jelent teljes fizetést, ha minden párosított terhelés
 * Megvan vagy Eredeti hiányzik, összeg-eltérés nélkül (`paidInFull`; murena
 * lelete, 26014): az összeg-eltéréses, a kétszer fizetett és a sztornózott
 * vásárlás párosítása nem fizetettség. Ilyenkor a feed állapota marad.
 */
/**
 * A BESZERZÉSI SZÁMLÁN KÉZZEL BEÍRT „FIZETVE” (`PurchaseInvoice.isPaid`), a PURCHASE
 * forrású sor mellé. A beszerzési számla a jóváhagyás UTÁN is szerkeszthető, tehát a
 * jelölést nem másoljuk a sorba (a másolat eltérne attól, amit a Beszerzésben
 * átírnak), hanem a mezőből olvassuk. Jóváhagyás előtt ugyanezt mutatta a lista
 * (`purchaseListItem`): a jelölés a jóváhagyással nem veszhet el (barracuda,
 * 2026-10-17; Balázs kérése 2026-10-19).
 */
export interface ManualPurchasePayment {
  paidAt: Date | null;
}

export function incomingPaymentOf(
  row: Pick<
    IncomingBillingDocument,
    | "paymentsKnown"
    | "paidAmount"
    | "grossAmount"
    | "currency"
    | "lastPaymentDate"
  >,
  bankMatch: IncomingBankMatch,
  /** A párosított terhelések a teljes számlát fizetik (`DocumentPairing.paidInFull`). */
  paidInFull: boolean,
  /**
   * A beszerzési számla kézi jelölése, ha a sor beszerzésből jött és a jelölés áll. A
   * sorrend: Számlázz.hu, banki párosítás, kézi jelölés, a feed állapota. A kézi jelölés
   * forrás-jelölést nem kap (jóváhagyás előtt sem kapott).
   */
  manualPaid: ManualPurchasePayment | null = null,
): {
  paymentState: IncomingPaymentState;
  paidAmount: string;
  lastPaymentDate: string | null;
  paymentSource: BillingPaymentSource | null;
  paymentConflict: boolean;
} {
  const feed = paymentStateOf(row);
  const paired = bankMatch.state === "PAIRED" && paidInFull;
  if (row.paymentsKnown && !row.paidAmount.isZero())
    return {
      paymentState: feed,
      paidAmount: money(row.paidAmount, row.currency),
      lastPaymentDate: day(row.lastPaymentDate),
      paymentSource: "SZAMLAZZ",
      paymentConflict: paired && feed !== "PAID",
    };
  if (paired)
    return {
      paymentState: "PAID",
      paidAmount: money(row.grossAmount, row.currency),
      lastPaymentDate: bankMatch.debits
        .map((d) => d.bookingDate)
        .reduce((a, b) => (a > b ? a : b)),
      paymentSource: "BANK_PAIRING",
      paymentConflict: false,
    };
  if (manualPaid)
    return {
      paymentState: "PAID",
      paidAmount: money(row.grossAmount, row.currency),
      lastPaymentDate: day(manualPaid.paidAt),
      paymentSource: null,
      paymentConflict: false,
    };
  return {
    paymentState: feed,
    paidAmount: money(row.paidAmount, row.currency),
    lastPaymentDate: day(row.lastPaymentDate),
    paymentSource: null,
    paymentConflict: false,
  };
}

/** A feed sora a listán: minden adata megvan (az adatlap is ebből épül). */
type FeedListItem = IncomingDocumentListItem &
  Pick<
    IncomingDocumentDetail,
    "origin" | "invoiceFormat" | "netAmount" | "vatAmount" | "grossAmount"
  >;

export function toIncomingListItem(
  row: IncomingBillingDocument,
  pairings: ReadonlyMap<string, DocumentPairing>,
  /**
   * Van-e a számlához begyűjtött PDF (`incoming-collected-pdf.ts`). A feed
   * PDF-je nélkül is igaz lehet: a `hasPdf` bármelyik forrásra igaz.
   */
  collectedPdf = false,
  /** Lásd `ManualPurchasePayment`; csak a PURCHASE forrású sor kaphat ilyet. */
  manualPaid: ManualPurchasePayment | null = null,
): FeedListItem {
  const bankMatch = bankMatchOf(row, pairings);
  return {
    id: row.id,
    // a jóváhagyott postafiókos számla rendes sor, de az eredete látszik (kártya e4c3b0fb)
    origin:
      row.source === "MAILBOX" || row.source === "PURCHASE"
        ? row.source
        : "SZAMLAZZ",
    // a jóváhagyott beszerzésből jött sor is ellenőrzött (kártya 83f31a95)
    review:
      row.source === "MAILBOX" || row.source === "PURCHASE" ? "VERIFIED" : null,
    documentNumber: row.documentNumber,
    kindCode: row.kindCode,
    kindLabel: externalKindLabel(row.kindCode),
    invoiceFormat: row.electronic ? "ELECTRONIC" : "PAPER",
    cancelled: row.cancelled,
    supplierName: row.supplierName,
    supplierTaxNumber: row.supplierTaxNumber,
    issueDate: day(row.issueDate)!,
    fulfillmentDate: day(row.fulfillmentDate),
    dueDate: day(row.dueDate),
    paymentMethod: row.paymentMethod,
    currency: row.currency,
    exchangeRate: row.exchangeRate?.toString() ?? null,
    netAmount: money(row.netAmount, row.currency),
    vatAmount: money(row.vatAmount, row.currency),
    grossAmount: money(row.grossAmount, row.currency),
    ...incomingPaymentOf(
      row,
      bankMatch,
      pairingOfRow(row, pairings)?.paidInFull ?? false,
      row.source === "PURCHASE" ? manualPaid : null,
    ),
    bankMatch,
    notBookable: row.notBookable,
    paperOriginal: paperOriginalOfRow(row, pairings),
    paperOriginalMarkedHere: row.paperOriginalAt !== null,
    hasPdf: row.hasPdf || collectedPdf,
  };
}

/** A csak postafiókos sor forrásai: ahonnan eredeti számla jön, nem a NAV és nem a feed. */
const MAILBOX_ONLY_SOURCES: ReadonlySet<string> = new Set([
  "MAILBOX",
  "DRIVE",
  "UPLOAD",
]);
const compactNumber = (value: string) =>
  value.replace(/[\s/_-]/g, "").toLowerCase();

/**
 * A PÁROSÍTÁSOK TÉRKÉPÉNEK SZÁM SZERINTI KULCSA: a „Papíron megvan” jelölés a
 * terhelésen áll, a bejövő számla sora pedig akkor is ugyanaz a számla, ha a
 * terheléshez nem az ő forrás-dokumentuma, hanem a postafiókos példánya van
 * párosítva (más azonosító, ugyanaz a szám). A KULCSBAN A SZÁLLÍTÓ IS BENNE
 * VAN (barracuda, #2013 review): két különböző szállító számlája ugyanarra a
 * tömörített számra kerülhet (2026/0001 és 2026-0001), és az egyik terhelés
 * jelölése nem lehet a másik számla „papíron megvan”-ja. A párosítás oldalán
 * csak a szállító NEVE áll rendelkezésre (az adószám nem), ezért a név a
 * kulcs; ha a két név nem egyezik, a jelölés NEM megy át (a biztonságos
 * irány: a PDF a csomagban marad). Az előtag miatt nem ütközhet
 * dokumentum-azonosítóval.
 */
const PAIRING_NUMBER_PREFIX = "number:";
export function pairingNumberKey(
  documentNumber: string,
  supplierName: string,
): string | null {
  const compact = compactNumber(documentNumber);
  const who = normalizeName(supplierName)
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return compact && who ? `${PAIRING_NUMBER_PREFIX}${compact}|${who}` : null;
}

/**
 * A SZÁM ÉS A SZÁLLÍTÓ ADÓSZÁMA SZERINTI KULCS (kártya 9ccd7769, Balázs 2026-11-03).
 * A név-kulcs elgépeléskor, „Kft.” elhagyásakor vagy névváltozáskor nem találja meg
 * ugyanazt a szállítót (és ilyenkor a „papíron megvan” jelölés nem megy át, a PDF a
 * csomagban marad). Az adószám törzse (az első nyolc számjegy) a szállító maga, és a
 * szám az ő számlái között egyedi (`incomingKey` ugyanezt mondja), tehát ez a kulcs
 * pontosabb a névnél: ugyanaz a szám + ugyanaz az adóalany = ugyanaz a számla,
 * akárhogy írják a nevét. Üres, ha nincs szám vagy nincs adószám-törzs.
 */
export function pairingTaxKey(
  documentNumber: string,
  supplierTaxNumber: string | null | undefined,
): string | null {
  const compact = compactNumber(documentNumber);
  const base = supplierTaxBase(supplierTaxNumber);
  return compact && base
    ? `${PAIRING_NUMBER_PREFIX}${compact}|tax:${base}`
    : null;
}

/**
 * EGY SZÁMLA ÖSSZES SZÁM SZERINTI KULCSA, a pontosabbtól a régi felé: az adószámos, aztán
 * a nevet. A párosítások térképébe MINDET beírjuk, a keresés sorban próbálja. A név-kulcs
 * azért marad, mert az egyik oldalon nincs mindig adószám (a postafiókos PDF-ből nem
 * mindig olvasható ki); az adószámos kulcs csak TÖBB egyezést ad, kevesebbet soha, tehát
 * ami eddig megtalálta, azt ezután is.
 */
export function pairingNumberKeys(
  documentNumber: string,
  supplierName: string,
  supplierTaxNumber?: string | null,
): string[] {
  return [
    pairingTaxKey(documentNumber, supplierTaxNumber),
    pairingNumberKey(documentNumber, supplierName),
  ].filter((key): key is string => key !== null);
}

/**
 * „PAPÍRON MEGVAN” EGY BEJÖVŐ SZÁMLA-SORRA: a soron tett jelölés VAGY a
 * párosított terhelésen tett (a sor forrás-dokumentuma szerint, ennek
 * hiányában a szám ÉS a szállító neve szerint). A lista és a könyvelői csomag
 * EZT a döntést használja (MMXH két számlája, Balázs 2026-11-03 00:03 UTC: a
 * terhelésen bejelölt jelölés nem jutott el a számla sorához).
 */
export function paperOriginalOfRow(
  row: Pick<
    IncomingBillingDocument,
    | "paperOriginalAt"
    | "sourceDocumentId"
    | "documentNumber"
    | "supplierName"
    | "supplierTaxNumber"
  > & { supplierEuTaxNumber?: string | null },
  pairings: ReadonlyMap<string, Pick<DocumentPairing, "paperOriginal">>,
): boolean {
  if (row.paperOriginalAt !== null) return true;
  if (row.sourceDocumentId && pairings.get(row.sourceDocumentId)?.paperOriginal)
    return true;
  if (
    row.documentNumber &&
    pairings.get(
      invoiceIdentity(
        row.documentNumber,
        identityTaxNumber(row.supplierTaxNumber, row.supplierEuTaxNumber),
        row.supplierName,
      ),
    )?.paperOriginal
  )
    return true;
  return pairingNumberKeys(
    row.documentNumber,
    row.supplierName,
    row.supplierTaxNumber,
  ).some((key) => pairings.get(key)?.paperOriginal ?? false);
}

/**
 * A CSAK POSTAFIÓKBÓL ISMERT, FIZETETT SZÁMLÁK SORAI (kártya 096607af;
 * acrobot 26716: kapjanak jelölést, ugyanazzal a párosítási feltétellel,
 * látszó forrással, duplikáció nélkül). Élesen mérve 2026-10-06-án: 10
 * szeptemberi számla FOUND-dal fizetett, mégis hiányzott a listáról, mert
 * nincs a Számlázz.hu feedben (külföldi kiállító nem jelent a NAV-nak).
 *
 * Sor CSAK abból lesz, amit a feed-sorok ugyanazzal a feltétellel
 * fizetettnek jelölnének: valódi számla, a cégre szól, minden párosított
 * terhelés teljesen fizeti (`paidInFull`). A párosítatlan postafiókos
 * dokumentum a Hiányzó számlák dolga marad, nem sor itt.
 *
 * DUPLIKÁCIÓ NÉLKÜL: ha a dokumentum (vagy bármelyik aliasa) egy feed-sor
 * forrása, vagy a száma egy feed-soré, a feed sora jelöli, ez kimarad.
 */
/**
 * MELYIK DOKUMENTUM HORDOZHATJA EGY POSTAFIÓKOS SOR OLVASATÁT, sorrendben: a sor
 * saját azonosítója, az eredeti, az aliasok. Egy összevont számla saját
 * azonosítója gyakran a NAV-soré (`missing-invoices.repository.ts`, az
 * összevonás), az pedig nem `IncomingSupplierDocument`: az olvasat ott nem
 * állhat, és élesen 21 sor írása bukott rajta P2003-mal (2026-10-14). A saját
 * azonosító áll elöl, mert a ma tárolt olvasatok mind azon vannak.
 */
export function readingDocumentIds(
  document: Pick<DocumentPairing["document"], "id" | "originalId" | "aliasIds">,
): string[] {
  return [
    ...new Set([
      document.id,
      ...(document.originalId ? [document.originalId] : []),
      ...(document.aliasIds ?? []),
    ]),
  ];
}

/** Egy sor olvasata a fenti azonosítók közül az elsőn, amin van. */
export function readingOfDocument<T>(
  readings: ReadonlyMap<string, T>,
  document: Pick<DocumentPairing["document"], "id" | "originalId" | "aliasIds">,
): T | undefined {
  for (const id of readingDocumentIds(document)) {
    const reading = readings.get(id);
    if (reading !== undefined) return reading;
  }
  return undefined;
}

export function mailboxOnlyPaidItems(
  feed: readonly Pick<
    IncomingBillingDocument,
    "sourceDocumentId" | "documentNumber"
  >[],
  pairings: ReadonlyMap<string, DocumentPairing>,
  /**
   * A kinyert, még nem jóváhagyott adat dokumentumonként (kártya e4c3b0fb):
   * ha van, a sor ezzel töltődik ki, „Ellenőrizendő” jelöléssel.
   */
  readings: ReadonlyMap<string, IncomingReadingValues> = new Map(),
): IncomingDocumentListItem[] {
  return mailboxOnlyPairings(feed, pairings).map((pairing) =>
    mailboxListItem(
      pairing.document,
      pairing,
      readingOfDocument(readings, pairing.document),
    ),
  );
}

/**
 * Ugyanazok a párosítások, amikből a fenti sorok lesznek: a kinyerés és a
 * jóváhagyás ezen a halmazon dolgozik, hogy a lista és a jóváhagyható sorok
 * soha ne térjenek el (kártya e4c3b0fb).
 */
export function mailboxOnlyPairings(
  feed: readonly Pick<
    IncomingBillingDocument,
    "sourceDocumentId" | "documentNumber"
  >[],
  pairings: ReadonlyMap<string, DocumentPairing>,
): DocumentPairing[] {
  const notInFeed = notInFeedTest(feed);
  const seen = new Set<DocumentPairing>();
  const result: DocumentPairing[] = [];
  for (const pairing of pairings.values()) {
    if (seen.has(pairing)) continue;
    seen.add(pairing);
    const document = pairing.document;
    if (
      pairing.kind !== "INVOICE" ||
      pairing.payee !== "COMPANY" ||
      !pairing.paidInFull ||
      pairing.debits.length === 0 ||
      !notInFeed(document)
    )
      continue;
    result.push(pairing);
  }
  return result;
}

/**
 * CSAK POSTAFIÓKBÓL ISMERT-E a dokumentum: postafiókos (Drive, feltöltés)
 * forrás, és sem ő, sem az aliasa nem egy feed-sor forrása, és a száma sem
 * egy feed-soré. A havi csomag is ezzel dönti el, melyik számla adatát kell
 * ellenőrizni (kártya e4c3b0fb).
 */
export function notInFeedTest(
  feed: readonly Pick<
    IncomingBillingDocument,
    "sourceDocumentId" | "documentNumber"
  >[],
): (
  document: Pick<
    DocumentPairing["document"],
    "id" | "aliasIds" | "number" | "source"
  >,
) => boolean {
  const inFeed = inFeedTest(feed);
  return (document) =>
    MAILBOX_ONLY_SOURCES.has(document.source) &&
    // only the id, the aliases and the number, as before (not the original)
    !inFeed({
      id: document.id,
      aliasIds: document.aliasIds,
      number: document.number,
    });
}

/**
 * EGY BEJÖVŐ SZÁMLA-SOR MÁR HORDOZZA-E a dokumentumot: a sor forrása a
 * dokumentum (vagy az aliasa), vagy a száma egyezik. Forrástól független, a
 * könyvelői csomag ezzel veszi ki a banki oldalról azt, amit a bejövő számla
 * sora már behoz (egy számla egyszer, egy hónapban szerepel).
 */
export function inFeedTest(
  feed: readonly Pick<
    IncomingBillingDocument,
    "sourceDocumentId" | "documentNumber"
  >[],
): (
  document: Pick<
    DocumentPairing["document"],
    "id" | "aliasIds" | "originalId" | "number"
  >,
) => boolean {
  const feedSources = new Set(
    feed.map((row) => row.sourceDocumentId).filter(Boolean),
  );
  const feedNumbers = new Set(
    feed.map((row) => compactNumber(row.documentNumber)),
  );
  return (document) =>
    [
      document.id,
      ...(document.aliasIds ?? []),
      ...(document.originalId ? [document.originalId] : []),
    ].some((id) => feedSources.has(id)) ||
    // az olvasatlan feltöltés száma üres: az nem egy feed-sor száma
    Boolean(document.number && feedNumbers.has(compactNumber(document.number)));
}

/** A csak postafiókos sor azonosítójának előtagja; utána a jelölt dokumentum azonosítója. */
export const MAILBOX_ITEM_PREFIX = "mailbox:";

/**
 * A CSAK POSTAFIÓKOS SOR PDF-JELÖLTJEI, sorrendben. A sor azonosítója a
 * párosított jelölt `id`-je, ami összevont számlánál a fő dokumentumé (gyakran
 * a NAV-soré, aminek nincs fájlja); a fájl az `originalId` dokumentumánál van.
 * Ezért előbb az eredeti, utána maga a jelölt, végül az aliasai: mind
 * `IncomingSupplierDocument` azonosító lehet, a NAV-sor egyszerűen nem talál.
 */
export function mailboxPdfCandidates(
  document: DocumentPairing["document"],
): string[] {
  return [
    ...new Set([
      ...(document.originalId ? [document.originalId] : []),
      document.id,
      ...(document.aliasIds ?? []),
    ]),
  ];
}

function mailboxListItem(
  document: DocumentPairing["document"],
  pairing: DocumentPairing,
  reading?: IncomingReadingValues,
): IncomingDocumentListItem {
  const debits = pairing.debits;
  // bruttó nélküli rekordnál a fizetett összeg a terheléseké, a terhelés devizájában
  const currency = document.gross ? document.currency : debits[0]!.currency;
  const paid = document.gross
    ? document.gross
    : debits.reduce(
        (sum, debit) => sum.plus(new Prisma.Decimal(debit.amount)),
        new Prisma.Decimal(0),
      );
  /*
    A KINYERT ADAT CSAK KIEGÉSZÍT (kártya e4c3b0fb): ami a párosításból ismert,
    marad; a kinyert mező a hiányzót tölti, a sor pedig „Ellenőrizendő”, amíg
    ember jóvá nem hagyja. A fizetés továbbra is a bankból jön.
  */
  const item: IncomingDocumentListItem = {
    id: `${MAILBOX_ITEM_PREFIX}${document.id}`,
    origin: "MAILBOX",
    // jóváhagyás után a sor a feedből jön, ide csak ellenőrizetlen jut
    review: "TO_REVIEW",
    // az olvasatlan feltöltésnél a fájlneve, jelölve; a kinyert szám felülírja
    documentNumber: shownNumber(document),
    kindCode: MAILBOX_KIND_CODE,
    kindLabel: externalKindLabel(MAILBOX_KIND_CODE),
    invoiceFormat: null,
    cancelled: false,
    supplierName: document.supplierName,
    supplierTaxNumber: null,
    issueDate: document.date,
    fulfillmentDate: null,
    dueDate: null,
    paymentMethod: null,
    currency,
    exchangeRate: null,
    netAmount: null,
    vatAmount: null,
    grossAmount: document.gross ? money(document.gross, currency) : null,
    paymentState: "PAID",
    paidAmount: money(paid, currency),
    lastPaymentDate: debits
      .map((debit) => debit.bookingDate)
      .reduce((a, b) => (a > b ? a : b)),
    paymentSource: "BANK_PAIRING",
    paymentConflict: false,
    bankMatch: { state: "PAIRED", reason: null, debits },
    notBookable: false,
    paperOriginal: pairing.paperOriginal,
    paperOriginalMarkedHere: false,
    hasPdf: false,
  };
  if (!reading) return item;
  /*
    A sornak EGY devizája van, és a fizetett összeg a párosítás devizájában áll.
    Ha a kinyert deviza más, a kinyert összegeket a lista nem mutatja (rossz
    devizával címkézve állnának); az adatlap mindet mutatja.
  */
  const sameCurrency = (reading.currency ?? item.currency) === item.currency;
  const value = (amount: string | null) =>
    amount === null || !sameCurrency
      ? null
      : money(new Prisma.Decimal(amount), item.currency);
  return {
    ...item,
    documentNumber: reading.documentNumber ?? item.documentNumber,
    supplierName: reading.supplierName ?? item.supplierName,
    supplierTaxNumber:
      reading.supplierTaxNumber ?? reading.supplierEuTaxNumber ?? null,
    issueDate: reading.issueDate ?? item.issueDate,
    fulfillmentDate: reading.fulfillmentDate,
    dueDate: reading.dueDate,
    netAmount: value(reading.netAmount),
    vatAmount: value(reading.vatAmount),
    grossAmount: value(reading.grossAmount) ?? item.grossAmount,
  };
}

export function toIncomingDetail(
  row: IncomingBillingDocument,
  pairings: ReadonlyMap<string, DocumentPairing>,
  collectedPdf = false,
  manualPaid: ManualPurchasePayment | null = null,
  relatedDocuments: IncomingRelatedDocument[] = [],
): IncomingDocumentDetail {
  const payments = row.payments as unknown as IncomingPayment[];
  return {
    ...toIncomingListItem(row, pairings, collectedPdf, manualPaid),
    relatedDocuments,
    exchangeBank: row.exchangeBank,
    supplier: {
      name: row.supplierName,
      address: row.supplierAddress,
      taxNumber: row.supplierTaxNumber,
      euTaxNumber: row.supplierEuTaxNumber,
      bankAccount: row.supplierBankAccount,
    },
    buyer: { name: row.buyerName, taxNumber: row.buyerTaxNumber },
    lines: row.lines as unknown as IncomingDocumentLine[],
    vatSummary: row.vatSummary as unknown as IncomingVatSummary[],
    paymentsKnown: row.paymentsKnown,
    payments: payments.map(({ date, title, amount, note }) => ({
      date,
      title,
      amount,
      note,
    })),
    note: row.note,
    orderNumber: row.orderNumber,
    referencedInvoiceNumber: row.referencedInvoiceNumber,
    referencedProformaNumber: row.referencedProformaNumber,
    versionCount: row.versionCount,
    receivedAt: row.feedReceivedAt.toISOString(),
  };
}

/**
 * A SZŰRŐ (a prompt 6. pontja): szállító (név vagy adószám), időszak a kelt vagy
 * a teljesítés szerint, kifizetési állapot, típus, pénznem, banki párosítás. A
 * sorrend: a legújabb kelt elöl, azon belül a számlaszám.
 */
export function filterIncoming(
  items: readonly IncomingDocumentListItem[],
  query: IncomingDocumentListQuery,
): IncomingDocumentListItem[] {
  const q = query.q?.trim().toLowerCase();
  const digits = q?.replace(/\D/g, "");
  return items
    .filter((item) => {
      if (q) {
        const name = item.supplierName.toLowerCase().includes(q);
        const tax =
          !!digits &&
          digits.length >= 3 &&
          (item.supplierTaxNumber ?? "").replace(/\D/g, "").includes(digits);
        if (!name && !tax) return false;
      }
      const date =
        query.dateBasis === "FULFILLMENT"
          ? item.fulfillmentDate
          : item.issueDate;
      if (query.from && (!date || date < query.from)) return false;
      if (query.to && (!date || date > query.to)) return false;
      if (query.paymentState && item.paymentState !== query.paymentState)
        return false;
      if (
        query.kindCode &&
        item.kindCode.toUpperCase() !== query.kindCode.toUpperCase()
      )
        return false;
      if (query.currency && item.currency !== query.currency.toUpperCase())
        return false;
      if (query.bankMatch && item.bankMatch.state !== query.bankMatch)
        return false;
      if (query.review && item.review !== query.review) return false;
      return true;
    })
    .sort(
      (a, b) =>
        b.issueDate.localeCompare(a.issueDate) ||
        a.documentNumber.localeCompare(b.documentNumber),
    );
}

export function incomingListResponse(
  all: readonly IncomingDocumentListItem[],
  query: IncomingDocumentListQuery & { page: number; pageSize: number },
): IncomingDocumentListResponse {
  const filtered = filterIncoming(all, query);
  const offset = (query.page - 1) * query.pageSize;
  const kinds = [...new Set(all.map((item) => item.kindCode))].sort();
  return {
    items: filtered.slice(offset, offset + query.pageSize),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems: filtered.length,
      totalPages: Math.ceil(filtered.length / query.pageSize),
    },
    facets: {
      kindCodes: kinds.map((code) => ({
        code,
        label: externalKindLabel(code),
      })),
      currencies: [...new Set(all.map((item) => item.currency))].sort(),
    },
  };
}
