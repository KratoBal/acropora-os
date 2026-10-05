import { Prisma } from "@acropora/database";

import type { BankCategory } from "./bank-transaction.classify.js";
import { NO_INVOICE_CATEGORIES } from "./bank-transaction.classify.js";
import { sequenceRatio } from "./sequence-ratio.js";

/**
 * A BANKI TERHELÉS ÉS A SZÁMLA PÁROSÍTÁSA, DETERMINISZTIKUSAN (brief 17: AI
 * nincs). A szabályok barracuda 4. szakaszából jönnek
 * (`exchange/havi-elszamolas/parositas-szabalyok.md`), acrobot döntéseivel:
 *
 *   0. a kézzel párosított sor elsőbbséget kap, a szabály nem írja felül;
 *   1. a számla száma a közleményben (legalább 5 karakter);
 *   2. a partner számlaszáma egyezik a szállító bankszámlájával (acrobot 25274),
 *      az összeggel és a dátumablakkal;
 *   3. összeg + partner-név + dátumablak;
 *   4. több számla egy utalásban: legfeljebb 5 elemű részhalmaz; ha több is
 *      kiadja, nem választunk;
 *   5. egy számlát egy terhelés visz (mért: két 23 810 Ft-os Alza-fizetés);
 *   6. a proforma nem számla, és CSAK TARTALÉK (acrobot 25607): ha a partnertől
 *      van pontos összegű valódi számla az ablakban, az nyer, akkor is, ha a
 *      közlemény a proforma számát nevezi meg.
 *
 * A 2-4 Ft-os kerekítés Megvan (acrobot 25265 a): HUF-ban 5 Ft a tűrés, EUR-ban
 * 5 cent. TISZTA FÜGGVÉNY: a hívó adja a hónap terheléseit és a jelölteket.
 */

export type DocumentSource =
  | "NAV"
  | "MAILBOX"
  | "UPLOAD"
  | "DRIVE"
  | "SETTLEMENT"
  | "PREMIUM_NOTICE"
  | "SZAMLAZZ";

export type Payee = "COMPANY" | "NOT_COMPANY" | "UNKNOWN";

export interface CandidateDocument {
  id: string;
  source: DocumentSource;
  number: string;
  /** ÉÉÉÉ-HH-NN */
  date: string;
  /** `null`, ahol a forrás nem ad bruttót (hazai postafiók-számla): ott csak a
   *  számlaszám-szabály párosíthat. */
  gross: Prisma.Decimal | null;
  currency: string;
  supplierName: string;
  /** A szállító ismert bankszámlái, kötőjel és szóköz nélkül. */
  supplierAccounts: readonly string[];
  kind: "INVOICE" | "PROFORMA" | "PREMIUM_NOTICE";
  payee: Payee;
  /** A vevőt kézzel jelölték (acrobot 25633); csak feltöltött vagy postafiókos PDF-nél. */
  payeeMarked?: boolean;
  /**
   * VAN-E EREDETI (Balázs, 2026-09-30 20:01 UTC, acrobot 25322): a könyvelőnek
   * az eredeti számla kell. PDF (postafiók, feltöltés, Drive, elszámolás) vagy
   * kézi „papíron megvan” jelölés. A NAV-adatsor nem eredeti.
   */
  hasOriginal: boolean;
  /**
   * Amivel a fizetés közleménye a számlára hivatkozhat, ha az nem a száma
   * (például a rendelésszám a Fauna Marin számláján); az 1. szabály nézi.
   */
  references?: readonly string[];
  /**
   * Az összevont jelölt többi azonosítója (ugyanaz a számla másik forrásból).
   * Egy kézi párosítás bármelyikre mutathat, és akkor is érvényes marad, ha a
   * számla később egy másik forrásból is beérkezik.
   */
  aliasIds?: readonly string[];
  /**
   * AZ ÖSSZEVONT JELÖLTBEN MELYIK FORRÁS HORDOZZA AZ EREDETIT. Az azonosító
   * gyakran a NAV-soré (az a fő), a fájl viszont a postafiókos vagy a
   * feltöltött társánál van; a könyvelői csomag ezt tölti le. Összevonás
   * nélkül nincs kitöltve: ott az eredeti maga a jelölt.
   */
  originalId?: string;
  /**
   * AMI ALAPJÁN KÉT DOKUMENTUM UGYANAZ A SZÁMLA (acrobot 25636): `sha:<fájl
   * lenyomata>` és `inv:<számlaszám|szállító>`. Az összevont jelölt a társaié
   * is. Ha egy azonosság két terheléshez párosul, az Kétszer fizetett számla.
   */
  identities?: readonly string[];
  /**
   * A KÁRTYÁS FIZETÉS(EK), amihez a begyűjtő a NAV nélküli számlát kötötte
   * (`cardPaymentMatch`): egy, vagy legfeljebb három fizetés, aminek az összege
   * a számla végösszege (Kia Charge: 40 086 = 21 279 + 18 807).
   */
  cardPaymentIds?: readonly string[];
  /**
   * A SZÁMLA FIZETÉSI MÓDJA KÁRTYA (a Számlázz.hu bejövő számlájának
   * `fizmod`-ja; a NAV-sor nem hordozza). A 3f. szabály csak ilyen számlát
   * párosít név nélkül (acrobot 26084, Tesland / MEDIAVOX).
   */
  cardPaid?: boolean;
}

export interface MatchableDebit {
  id: string;
  /** ÉÉÉÉ-HH-NN */
  bookingDate: string;
  amount: Prisma.Decimal;
  currency: string;
  original: { amount: Prisma.Decimal; currency: string } | null;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  narrative: string;
  category: BankCategory;
}

/**
 * EGY JÓVÁÍRÁS A BANKBAN: a sztornózott vásárlás visszatérítése ebből látszik
 * (acrobot 25933). A kártyás visszatérítés („ÁRUVISSZAVÉT ELLENÉRTÉKE”)
 * partner-név nélkül jön, a közleménye a terhelésé alakú: `2026.08.28
 * 0194683438 Alza.hu Kft. -APPLE`.
 */
export interface MatchableCredit {
  id: string;
  /** ÉÉÉÉ-HH-NN */
  bookingDate: string;
  amount: Prisma.Decimal;
  currency: string;
  counterpartyName: string | null;
  narrative: string;
}

export type ItemState =
  | "FOUND"
  | "ORIGINAL_MISSING"
  | "NOT_MATCHED"
  | "NO_INVOICE"
  | "NOT_COMPANY"
  | "PROFORMA_ONLY"
  | "DOUBLE_PAID"
  | "NO_INVOICE_NEEDED"
  /** Sztornózva (jóváíró van), a visszatérítés még a határidőn belül. */
  | "REFUND_EXPECTED"
  /** Sztornózva, de a visszatérítés a határidőig nem jött meg. */
  | "REFUND_MISSING";

export interface MatchOutcome {
  state: ItemState;
  documents: CandidateDocument[];
  matchedBy: "RULE" | "MANUAL" | null;
  /** A döntő szabály mondata; a hiánylista kiírja. */
  reason: string;
  /** A drawer jelöltjei: a partner ablakba eső dokumentumai. */
  candidates: CandidateDocument[];
  /**
   * A KÖZLEMÉNY ÁLTAL MEGNEVEZETT, DE HIÁNYZÓ SZÁMLÁK, név szerint (Balázs,
   * acrobot 25610: „ki kellene írni melyik hiányzik”): a párosított számla,
   * aminek nincs eredetije, és a megnevezett szám, amihez egyáltalán nincs
   * dokumentum. Csak az 1. szabály tölti.
   */
  missingNumbers?: string[];
  /**
   * A terhelés és a párosított számlák összegének különbsége (terhelés mínusz
   * számlák), ha a tűrésen túl eltér. A párosítás ettől még áll.
   */
  amountDifference?: { amount: Prisma.Decimal; currency: string };
  /** A többi terhelés, amelyhez ugyanez a számla is párosítva van. */
  doublePaidWith?: string[];
  /**
   * A PÁROSÍTÁS, amelyben ez a terhelés a dokumentumot kapta. Alapból maga a
   * terhelés; a gyűjtőszámla-szabályok (egy számla, sok fizetés) egy közös
   * párosítást adnak a csoport minden tagjának. A kettős fizetés ezt nézi: egy
   * számla akkor kétszer fizetett, ha KÉT KÜLÖNBÖZŐ párosításban szerepel.
   */
  pairing?: string;
  /**
   * A SZTORNÓZOTT VÁSÁRLÁS VISSZATÉRÍTÉSE (acrobot 25933): a várt összeg, a
   * határidő (a jóváíró kelte + 30 nap), és ha megjött, a jóváírás napja.
   */
  refund?: {
    amount: Prisma.Decimal;
    currency: string;
    creditNoteNumber: string;
    due: string;
    receivedOn: string | null;
  };
}

/**
 * AZ ÁLTALÁNOS SZAVAK, szóhatárral, ami az ÉKEZETES betűt is betűnek látja. A
 * régi `\b` csak ASCII-t ismert: egy ékezetre végződő szó (felelősségű,
 * hungária) után nincs `\b`, tehát ezek sosem estek ki (barracuda esetlistája,
 * acrobot 25928: a B-O 2001 NAV-neve kiírt jogi formával áll).
 */
const GENERIC =
  /(?<![\p{L}\p{N}])(hungária|hungaria|magyarország|magyarorszag|online|digital|technologies|international|kereskedelmi|korlátolt|korlatolt|felelősségű|felelossegu|társaság|tarsasag|zártkörűen|zartkoruen|működő|mukodo|részvénytársaság|reszvenytarsasag|kft|zrt|nyrt|bt|gmbh|ltd|limited|inc|llc|bv|srl|sas|doo|ag)(?![\p{L}\p{N}])/gu;

/** Név a hasonlítás előtt: kisbetű, fizetési előtagok és általános szavak nélkül. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/simplep\*|barionp\*|paypal \*|\*/g, " ")
    .replace(GENERIC, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/**
 * A név első szava első 4 betűjének egyezése ÉS a hasonlóság a küszöb fölött.
 * Két küszöb van, barracuda kódja szerint: a párosításnál 0,5, a „van-e számla
 * a partnertől” kérdésnél 0,6. Az első-szó feltétel nélkül mért hamis
 * egyezések: Allianz Hungária ~ SOPRO HUNGÁRIA, Hetzner Online ~ UNAS Online.
 */
export function samePartner(a: string, b: string, threshold = 0.6): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  const first = (s: string) => s.split(" ")[0]!.slice(0, 4);
  if (first(x) !== first(y)) return false;
  return sequenceRatio(x, y) >= threshold || wordPrefix(x, y);
}

/**
 * A RÖVIDEBB NÉV A HOSSZABB ELEJE, egész szavakban, legalább KÉT szóval: a
 * cégnév kiírt alakja a magja után tevékenység-szavakat visel („B-O 2001.
 * BEFEKTETÉSI ÉS KERESKEDELMI KFT.”), ezért a hasonlósági arány alacsony,
 * pedig a kezdete betűre a bank partnerneve. Egyetlen szóra nem: egy
 * vezetéknév sok cég és személy elején áll.
 */
function wordPrefix(x: string, y: string): boolean {
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.split(" ").length >= 2 && `${long} `.startsWith(`${short} `);
}

function shiftMonth(date: string, months: number, day: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) + months;
  const y = year + Math.floor((month - 1) / 12);
  const m = ((((month - 1) % 12) + 12) % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-${day}`;
}

/** A számla a fizetés előtt legfeljebb 4 hónappal, utána a következő hónap 15-éig kelhet. */
export function inWindow(debitDate: string, documentDate: string): boolean {
  return (
    documentDate >= shiftMonth(debitDate, -4, "01") &&
    documentDate <= shiftMonth(debitDate, 1, "15")
  );
}

/**
 * Az összeg eltérése a terhelés pénznemében, vagy kártyás devizás sornál az
 * eredeti devizában; `null`, ha a kettő nem vethető össze.
 */
function amountGap(
  debit: MatchableDebit,
  total: Prisma.Decimal | null,
  currency: string,
): Prisma.Decimal | null {
  if (total === null) return null;
  if (currency === debit.currency) return total.minus(debit.amount).abs();
  if (debit.original && currency === debit.original.currency)
    return total.minus(debit.original.amount).abs();
  return null;
}

/** PONTOS: HUF-ban 1 Ft, devizában 5 cent (barracuda 4.2). */
const exact = (gap: Prisma.Decimal | null, currency: string) =>
  gap !== null && gap.lte(currency === "HUF" ? 1 : 0.05);
/** KEREKÍTÉSSEL: HUF-ban 5 Ft-ig Megvan (acrobot 25265 a). */
const rounded = (gap: Prisma.Decimal | null, currency: string) =>
  gap !== null && currency === "HUF" && gap.gt(1) && gap.lte(5);

const MONTHS: readonly [RegExp, number][] = [
  [/^jan/, 1],
  [/^feb/, 2],
  [/^m[áa]rc/, 3],
  [/^[áa]pr/, 4],
  [/^m[áa]j/, 5],
  [/^j[úu]n/, 6],
  [/^j[úu]l/, 7],
  [/^aug/, 8],
  [/^sz?ep/, 9],
  [/^o[kc]t/, 10],
  [/^nov/, 11],
  [/^dec/, 12],
];

/**
 * A KÖZLEMÉNYBEN MEGNEVEZETT HÓNAP, `YYYY-MM` (barracuda esetlistája, B-O 2001:
 * „2026 aug” egy szeptemberi fizetésen, és ugyanaz a havidíj augusztusra és
 * szeptemberre is ott áll). Csak a hónap NEVE: a kártyás közlemény eleje egy
 * teljes dátum (2026.09.10), az a vásárlás napja, nem a számlázott hónap. Év
 * nélkül a fizetés éve, és ha a hónap a fizetésé után van, az előző év.
 */
export function namedMonth(
  narrative: string,
  bookingDate: string,
): string | null {
  const match =
    /(?<![\p{L}\p{N}])(?:(20\d{2})[\s.\/-]*)?(jan|febr?|m[áa]rc|[áa]pr|m[áa]j|j[úu]n|j[úu]l|aug|szept?|sep|okt|oct|nov|dec)\p{L}*\.?(?![\p{L}\p{N}])/iu.exec(
      narrative,
    );
  if (!match) return null;
  const month = MONTHS.find(([rx]) => rx.test(match[2]!.toLowerCase()))![1];
  const bookingYear = Number(bookingDate.slice(0, 4));
  const year = match[1]
    ? Number(match[1])
    : month > Number(bookingDate.slice(5, 7))
      ? bookingYear - 1
      : bookingYear;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** A számla hónapja a megnevezett hónaphoz: a hónap utolsó 3 napja a következőé. */
const billedMonth = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 3 * 86_400_000)
    .toISOString()
    .slice(0, 7);

/** A kártyás közlemény eleje: a vásárlás napja (2026.09.10 7413124583 OBI ...). */
export function cardPurchaseDay(narrative: string): string | null {
  const match = /^(\d{4})\.(\d{2})\.(\d{2}) \d{10} /.exec(narrative);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** A normalizált név első szava, ha legalább 3 betű (a márka); számjegyre nem. */
const firstWord = (name: string) => {
  const word = normalizeName(name).split(" ")[0] ?? "";
  return /^\p{L}{3,}$/u.test(word) ? word : null;
};

/** A valódi számla előbb, a proforma utána: a proforma tartalék (acrobot 25607). */
/** A jóváíró kelte legfeljebb ennyi nappal a vásárlás után (barracuda esetlistája). */
const CREDIT_NOTE_DAYS = 15;
/** A visszatérítés határideje a jóváíró keltétől (acrobot 25933). */
const REFUND_DAYS = 30;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** A kártyás közlemény kereskedője: a vásárlás napja és a kártyaszám után. */
const cardMerchant = (narrative: string) =>
  /^\d{4}\.\d{2}\.\d{2} \d{10} (.+)$/.exec(narrative)?.[1] ?? null;

const proformaLast = (a: CandidateDocument, b: CandidateDocument) =>
  Number(a.kind === "PROFORMA") - Number(b.kind === "PROFORMA");

const dayDistance = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

const compact = (s: string) => s.replace(/\s/g, "").toLowerCase();

/**
 * A KÖZLEMÉNY SZAVAI: szóköz, vessző, pontosvessző és kettőspont mentén, a
 * szó végi pont nélkül.
 */
const narrativeTokens = (narrative: string) =>
  narrative
    .split(/[\s,;:]+/)
    .map((token) => token.replace(/\.$/, "").toLowerCase())
    .filter(Boolean);

/** Ennél rövidebb számlaszámnál a partnernek is egyeznie kell. */
const SHORT_NUMBER = 8;

/**
 * A BANK TÖRDELÉSE: a közleményt mezőkre vágja, és a mezőhatár egy szám KÖZEPÉRE
 * eshet (Fluidra, 2026-09-25: „KS26/0 8450”, „K S26/08541”). Ezért egy szám a
 * közlemény legfeljebb ennyi SZOMSZÉDOS szavának összefűzéséből is állhat. Az
 * összefűzött alak csak a partner saját számlájára talál: két számjegy-csoport
 * összefűzve hosszú, ártatlannak látszó számot ad (bankszámla-darabok, dátum).
 */
const JOIN_LIMIT = 3;

interface NarrativeSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function narrativeSpans(narrative: string): NarrativeSpan[] {
  const tokens = narrativeTokens(narrative);
  const spans: NarrativeSpan[] = [];
  for (let start = 0; start < tokens.length; start++)
    for (let n = 1; n <= JOIN_LIMIT && start + n <= tokens.length; n++)
      spans.push({
        start,
        end: start + n,
        text: tokens.slice(start, start + n).join(""),
      });
  return spans;
}

/** Egy szám alakja: betű helyén `a`, számjegy helyén `9`, a többi jel marad. */
const shapeOf = (number: string) =>
  number.replace(/\p{L}/gu, "a").replace(/\p{N}/gu, "9");

/**
 * A SZÁMLA SZÁMA A KÖZLEMÉNYBEN: a szám a közlemény EGY EGÉSZ SZAVA (vagy a bank
 * tördelése miatt szomszédos szavainak összefűzése), és rövid számnál a partner
 * is egyezik. A közlemény-darabot adja vissza, vagy `null`-t.
 *
 * Mérve 2026-10-01, az exchange kivonatain (2025-12 .. 2026-08, 1144
 * terhelés), barracuda lelete nyomán: a régi részszöveg-keresés 158
 * párosításából kettő rossz volt. A `PETIK-2026-3` a `PETIK-2026-30`
 * közleményű fizetést vitte el, és egy MÁSIK partner `2026-37` számlája az
 * `E-VEGA-2026-37` közleményűt. A szóhatár magában az utóbbit nem fogta volna:
 * a kötőjel a szám része. Ezzel a szabállyal a 158-ból 156 marad, és a kieső
 * kettő pontosan a két rossz.
 */
/**
 * MAGYAR ADÓSZÁM ALAKÚ SZÓ (NNNNNNNN-N-NN): egy céget nevez meg, nem egy
 * számlát. Mérve 2026-10-04, éles (acrobot 26163): öt szeptemberi NAV-utalás
 * közleménye pontosan „23916229-2-42”, a saját adószámunk, és kb. 151 régen
 * tárolt saját kimenő számla ezt viselte számként; az első ilyen terhelés
 * mind a 151-et megkaphatta. Ilyen szám sem a dokumentum, sem a közlemény
 * oldalán nem nevez meg számlát.
 */
const TAX_NUMBER_SHAPE = /^\d{8}-\d-\d{2}$/;

function spanNaming(
  debit: MatchableDebit,
  document: CandidateDocument,
  spans: readonly NarrativeSpan[],
): NarrativeSpan | null {
  // a számla száma MELLETT a hivatkozásai is (#1323: a Fauna Marin közleménye a
  // rendelésszámot nevezi meg), ugyanazzal az egész-szó szabállyal
  for (const raw of [document.number, ...(document.references ?? [])]) {
    const number = compact(raw);
    if (number.length < 5 || TAX_NUMBER_SHAPE.test(number)) continue;
    for (const span of spans) {
      if (span.text !== number) continue;
      const joined = span.end - span.start > 1;
      const partner = samePartner(
        debit.counterpartyName ?? "",
        document.supplierName,
      );
      if (joined ? partner : number.length >= SHORT_NUMBER || partner)
        return span;
    }
  }
  return null;
}

/**
 * A MEGNEVEZETT, DE DOKUMENTUM NÉLKÜLI SZÁMOK: a közlemény olyan darabjai, amik
 * UGYANOLYAN ALAKÚAK, mint a már megtalált számlák száma (`KS26/08132` mellett
 * egy `KS26/08999`), és egyetlen megtalált darabbal sem fednek át. Az alak
 * nélkül minden szó számlaszámnak látszana.
 */
function namedWithoutDocument(
  spans: readonly NarrativeSpan[],
  named: readonly { document: CandidateDocument; span: NarrativeSpan }[],
  /** MINDEN ismert dokumentum száma és hivatkozása: a másik terheléshez párosított nem hiányzik. */
  known: ReadonlySet<string>,
): string[] {
  const shapes = new Set(named.map((n) => shapeOf(compact(n.document.number))));
  const taken = named.map((n) => n.span);
  const overlaps = (a: NarrativeSpan, b: NarrativeSpan) =>
    a.start < b.end && b.start < a.end;
  const out: string[] = [];
  // a hosszabb darab előbb: a „KS26/0 8450” egy szám, nem kettő
  for (const span of [...spans].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  )) {
    if (!shapes.has(shapeOf(span.text)) || known.has(span.text)) continue;
    if (taken.some((t) => overlaps(t, span))) continue;
    taken.push(span);
    out.push(span.text.toUpperCase());
  }
  return out;
}

/**
 * A terhelés mínusz a számlák összege, ha a tűrésen túl eltér; `null`, ha
 * egyezik, vagy nem összeadható (hiányzó bruttó, eltérő devizák).
 */
function invoiceDifference(
  debit: MatchableDebit,
  documents: readonly CandidateDocument[],
): { amount: Prisma.Decimal; currency: string } | null {
  if (documents.some((d) => d.gross === null)) return null;
  const currency = documents[0]!.currency;
  if (documents.some((d) => d.currency !== currency)) return null;
  const paid =
    currency === debit.currency
      ? debit.amount
      : debit.original?.currency === currency
        ? debit.original.amount
        : null;
  if (!paid) return null;
  const total = documents.reduce(
    (sum, d) => sum.plus(d.gross!),
    new Prisma.Decimal(0),
  );
  const gap = paid.minus(total);
  // a kerekítési tűrésen belül (HUF-ban 5 Ft, devizában 5 cent) nem eltérés
  return gap.abs().lte(currency === "HUF" ? 5 : 0.05)
    ? null
    : { amount: gap, currency };
}

function stateOf(documents: CandidateDocument[]): ItemState {
  if (documents.some((d) => d.kind === "PROFORMA")) return "PROFORMA_ONLY";
  // ugyanannak a számlának a cégre szóló eredetije mellett egy másik
  // dokumentum (emlékeztető, másolat) „nem a cégre” ítélete nem dönt (acrobot 25664)
  const companyOriginals = new Set(
    documents
      .filter((d) => d.payee === "COMPANY" && d.hasOriginal)
      .map((d) => compact(d.number)),
  );
  if (
    documents.some(
      (d) =>
        d.payee === "NOT_COMPANY" && !companyOriginals.has(compact(d.number)),
    )
  )
    return "NOT_COMPANY";
  // a vevő nem ellenőrizhető: a brief szerint csak a Kft-re szóló számla
  // Megvan, tehát ez a drawerben kézzel jelölendő („A cégre szól”), addig
  // Nem párosodott
  if (documents.some((d) => d.payee === "UNKNOWN")) return "NOT_MATCHED";
  // párosítva, de csak NAV-adat van: tudjuk, melyik számla, az eredeti kell
  if (documents.some((d) => !d.hasOriginal)) return "ORIGINAL_MISSING";
  return "FOUND";
}

function subsets<T>(items: readonly T[], max: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, chosen: T[]) => {
    if (chosen.length >= 2) result.push([...chosen]);
    if (chosen.length === max) return;
    for (let i = start; i < items.length; i++) {
      chosen.push(items[i]!);
      walk(i + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return result;
}

/** A havi gyűjtőszámla legkésőbbi napja a következő hónapban (mérve: 1. vagy 2.). */
const MONTHLY_INVOICE_LAST_DAY = 5;

/**
 * A GYŰJTŐSZÁMLA KIS MARADÉKA (acrobot 25647, Balázs a Parkl szeptemberi
 * számlájáról): a számla nagyobb a havi fizetések összegénél, mert egy tétel
 * még nincs a kivonatban (a bank még nem könyvelte; mérve: a szeptemberi
 * kivonat elutasított, függő -640 Ft-os Parkl-sora, és a számla 640 Ft-tal
 * több). Ilyenkor a fizetések a számlához párosodnak, összeg-eltéréssel.
 *
 * A maradék legfeljebb a csoport legnagyobb fizetése (kb. egy hiányzó tétel),
 * és legfeljebb a számla ennyi része. Mérve 2026-10-01 a 2025-12 .. 2026-09
 * kivonatain: a pontosan nem párosodó gyűjtő-jelöltek közül négy Parkl-csoport
 * marad el kis maradékkal (225, 640, 760, 835 Ft; 1,9-6,3 %), a többi messze
 * (eurogreen +54 734 Ft = 37 %, Fluidra +12 millió), vagy a számla a kisebb
 * (Tesla: a terhelésenkénti számlák, nem havi összesítő).
 */
const MONTHLY_REMAINDER_SHARE = 0.1;

/**
 * A KÁRTYÁS FIZETÉSEK HAVI CSOPORTJAI. A kártyás terhelés közleménye így
 * kezdődik: `2026.03.05 7413124583 SIMPLEP*PARKL .NET`, vagyis a VÁSÁRLÁS napja
 * és a kártya. A csoport kulcsa a partner, a kártya és a vásárlás hónapja; a
 * könyvelés napja nem jó kulcs, mert egy hónap utolsó napjainak vásárlása a
 * következő hónapban könyvelődik.
 *
 * Mérve 2026-10-01, a 2025-12 .. 2026-08 kivonatain (barracuda megfigyelése
 * nyomán): a Parkl-fizetések 14 ilyen csoportjából 10 pontosan egy következő
 * elsejei Parkl-számlát ad, ez a 209 Parkl-fizetésből 128. A maradék 4 a
 * hiányzó februári kivonaton és a hónap szélén múlik.
 */
export function monthlyCardGroups(debits: readonly MatchableDebit[]): {
  debits: MatchableDebit[];
  nextMonth: string;
}[] {
  const groups = new Map<string, MatchableDebit[]>();
  for (const debit of debits) {
    const card = /^(\d{4})\.(\d{2})\.\d{2}\s+(\d{6,})\s/.exec(
      debit.narrative.trim() + " ",
    );
    if (!card || !debit.counterpartyName) continue;
    const key = `${normalizeName(debit.counterpartyName)}|${card[3]}|${card[1]}-${card[2]}`;
    groups.set(key, [...(groups.get(key) ?? []), debit]);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, members]) => {
      const month = key.slice(-7);
      const next = new Date(`${month}-01T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return { debits: members, nextMonth: next.toISOString().slice(0, 7) };
    });
}

/**
 * A KÉZZEL PÁROSÍTOTT, OLVASHATATLAN FELTÖLTÉS ÖSSZEVONÁSA A SZÁMLA SORÁVAL
 * (7ff26bc9, acrobot 26120 és 26292).
 *
 * Egy feltöltött másolat, amiből sem szám, sem szállító nem olvasható, nem
 * vonódik össze a `mergeSameInvoice`-ban, tehát a kézi párosítása csak a
 * feltöltést fizeti: a NAV- vagy a Számlázz.hu-sor ugyanarról a számláról
 * párosítatlan marad, és a bejövő számla nem lesz fizetett (mérve
 * 2026-10-02: a Tesla 4042V0000011711). Itt összevonjuk azzal az EGYETLEN
 * számla-sorral, amelyik
 *
 *   - a feltöltés fájlnevével azonos számú, VAGY
 *   - a 3. szabály szerint illik MINDEN terheléséhez: partner (0,5), pontos
 *     összeg, dátumablak, és a száma nem egy ugyanolyan alakú MÁSIK szám,
 *     mint a fájlnév (KBOSS: a feltöltés E-KBOSS-2026-503610, a sor
 *     E-KBOSS-2026-560251, azonos összeggel és partnerrel: két számla).
 *
 * Ha nincs ilyen, vagy több van, vagy a sort más terheléshez párosították
 * kézzel, minden marad. A partner-próba a 3. szabályé, változatlanul: a
 * „TelekomSzaml*” partnernevű terhelés ezért nem vonódik össze a Magyar
 * Telekom sorával (acrobot 26292: a Telekom kézi marad).
 */
export function mergeManualUploads(
  documents: readonly CandidateDocument[],
  manual: ReadonlyMap<string, readonly string[]>,
  debits: readonly MatchableDebit[],
): CandidateDocument[] {
  const byId = new Map<string, CandidateDocument>();
  for (const d of documents) {
    byId.set(d.id, d);
    for (const alias of d.aliasIds ?? []) byId.set(alias, d);
  }
  const debitById = new Map(debits.map((debit) => [debit.id, debit]));
  // melyik dokumentumot melyik terhelés(ek)hez párosították kézzel
  const pairedTo = new Map<CandidateDocument, MatchableDebit[]>();
  for (const [debitId, ids] of manual) {
    const debit = debitById.get(debitId);
    if (!debit) continue;
    for (const d of new Set(ids.flatMap((id) => byId.get(id) ?? [])))
      pairedTo.set(d, [...(pairedTo.get(d) ?? []), debit]);
  }
  const unreadable = (d: CandidateDocument) =>
    d.source === "UPLOAD" &&
    !(d.aliasIds?.length ?? 0) &&
    !(d.identities ?? []).some((identity) => identity.startsWith("inv:"));
  const baseName = (fileName: string) => fileName.replace(/\.[a-z0-9]+$/i, "");

  const absorbed = new Map<CandidateDocument, CandidateDocument[]>();
  const taken = new Set<CandidateDocument>();
  for (const [upload, uploadDebits] of pairedTo) {
    if (!unreadable(upload)) continue;
    const name = baseName(upload.number);
    const invoices = documents.filter(
      (d) =>
        d !== upload &&
        d.source !== "UPLOAD" &&
        d.kind === "INVOICE" &&
        d.gross !== null &&
        !taken.has(d) &&
        // más terheléshez kézzel párosítva: az a másik számlája
        (pairedTo.get(d) ?? []).every((debit) => uploadDebits.includes(debit)),
    );
    const byNumber = invoices.filter(
      (d) => compact(d.number) !== "" && compact(d.number) === compact(name),
    );
    const byRule = invoices.filter(
      (d) =>
        !(shapeOf(compact(d.number)) === shapeOf(compact(name))) &&
        uploadDebits.every(
          (debit) =>
            samePartner(debit.counterpartyName ?? "", d.supplierName, 0.5) &&
            exact(amountGap(debit, d.gross, d.currency), d.currency) &&
            inWindow(debit.bookingDate, d.date),
        ),
    );
    const found = byNumber.length > 0 ? byNumber : byRule;
    if (found.length !== 1) continue;
    taken.add(found[0]!);
    absorbed.set(found[0]!, [...(absorbed.get(found[0]!) ?? []), upload]);
  }

  const gone = new Set([...absorbed.values()].flat());
  return documents.flatMap((d) => {
    if (gone.has(d)) return [];
    const uploads = absorbed.get(d);
    if (!uploads) return [d];
    return [
      {
        ...d,
        aliasIds: [...(d.aliasIds ?? []), ...uploads.map((u) => u.id)],
        // a sor saját eredetije marad; ha nincs (NAV), a feltöltés az
        ...(d.hasOriginal ? {} : { originalId: uploads[0]!.id }),
        hasOriginal: true,
        identities: [
          ...new Set([
            ...(d.identities ?? []),
            ...uploads.flatMap((u) => u.identities ?? []),
          ]),
        ],
      },
    ];
  });
}

export function matchMonth(input: {
  debits: readonly MatchableDebit[];
  documents: readonly CandidateDocument[];
  /** terhelés -> kézzel párosított dokumentum(ok) azonosítója */
  manual: ReadonlyMap<string, readonly string[]>;
  /**
   * A „papíron megvan” jelölésű terhelések (acrobot 25322): a párosított
   * számla eredetije papíron van meg, tehát nem Eredeti hiányzik.
   */
  paperOriginals?: ReadonlySet<string>;
  /** A bank jóváírásai: a sztornózott vásárlás visszatérítése ezekből látszik. */
  credits?: readonly MatchableCredit[];
  /**
   * A beolvasott kivonatok utolsó napja (ÉÉÉÉ-HH-NN). A visszatérítés
   * határidejét ehhez méri, nem a mai naphoz: egy még be nem töltött kivonat
   * nem jelent elmaradt visszatérítést. Nélküle semmi sem „elmaradt”.
   */
  asOf?: string;
}): Map<string, MatchOutcome> {
  const byId = new Map<string, CandidateDocument>();
  for (const d of input.documents) {
    byId.set(d.id, d);
    for (const alias of d.aliasIds ?? []) byId.set(alias, d);
  }
  const used = new Set<string>();
  const outcomes = new Map<string, MatchOutcome>();
  const free = () => input.documents.filter((d) => !used.has(d.id));
  const knownNumbers = new Set(
    input.documents.flatMap((d) =>
      [d.number, ...(d.references ?? [])].map((n) => compact(n)),
    ),
  );

  // 0. a kézi párosítás elsőbbsége: ezek a dokumentumok senki másé
  for (const debit of input.debits) {
    const ids = input.manual.get(debit.id);
    if (!ids?.length) continue;
    const documents = [...new Set(ids.flatMap((id) => byId.get(id) ?? []))];
    documents.forEach((d) => used.add(d.id));
    outcomes.set(debit.id, {
      state: stateOf(documents),
      documents,
      matchedBy: "MANUAL",
      reason: "kézzel párosítva",
      candidates: [],
    });
  }

  // 0b. A BEGYŰJTŐ ÁLTAL A FIZETÉS(EK)HEZ KÖTÖTT SZÁMLA (acrobot 25691): az
  // összeg és a partner a begyűjtéskor már egyezett, és több fizetésnél csak
  // így kerülhet egy számla mindegyikhez. Csak ha MINDEGYIK fizetés szabad.
  for (const document of input.documents) {
    const ids = document.cardPaymentIds ?? [];
    if (!ids.length || used.has(document.id)) continue;
    const debits = ids.map((id) => input.debits.find((d) => d.id === id));
    if (debits.some((d) => !d || outcomes.has(d.id))) continue;
    used.add(document.id);
    for (const debit of debits as MatchableDebit[])
      outcomes.set(debit.id, {
        state: stateOf([document]),
        documents: [document],
        matchedBy: "RULE",
        reason:
          ids.length > 1
            ? `a számla végösszege ${ids.length} kártyás fizetés összege`
            : "a számla összege és kiállítója a kártyás fizetésé",
        candidates: [],
        // a halmaz egy párosítás: a tagjai egymás miatt nem kétszer fizetettek
        pairing: `set:${document.id}`,
      });
  }

  const ordered = [...input.debits].sort(
    (x, y) =>
      x.bookingDate.localeCompare(y.bookingDate) || x.id.localeCompare(y.id),
  );
  const open = ordered.filter((debit) => {
    if (outcomes.has(debit.id)) return false;
    if (!NO_INVOICE_CATEGORIES.has(debit.category)) return true;
    outcomes.set(debit.id, {
      state: "NO_INVOICE_NEEDED",
      documents: [],
      matchedBy: null,
      reason: "nem kell számla",
      candidates: [],
    });
    return false;
  });
  const window = (debit: MatchableDebit) =>
    free().filter((d) => inWindow(debit.bookingDate, d.date));
  const partnerDocs = (debit: MatchableDebit, threshold: number) =>
    window(debit).filter(
      (d) =>
        debit.counterpartyName &&
        samePartner(d.supplierName, debit.counterpartyName, threshold),
    );
  const found = (
    debit: MatchableDebit,
    documents: CandidateDocument[],
    reason: string,
    /** a gyűjtőszámla-szabályok közös párosítása; alapból a terhelés maga */
    pairing?: string,
  ) => {
    documents.forEach((d) => used.add(d.id));
    outcomes.set(debit.id, {
      state: stateOf(documents),
      documents,
      matchedBy: "RULE",
      reason,
      candidates: [],
      ...(pairing ? { pairing } : {}),
    });
  };
  /** A név szerint megnevezett, de egy elírás-gyanús pontos fizetésnek hagyott számlák. */
  const withheld = new Map<string, CandidateDocument[]>();
  const typoTwin = (debit: MatchableDebit, document: CandidateDocument) => {
    const shape = shapeOf(compact(document.number));
    const fits = (other: MatchableDebit, d: CandidateDocument) =>
      samePartner(d.supplierName, other.counterpartyName ?? "", 0.5) &&
      inWindow(other.bookingDate, d.date) &&
      exact(amountGap(other, d.gross, d.currency), d.currency);
    return open.some(
      (other) =>
        other.id !== debit.id &&
        !outcomes.has(other.id) &&
        other.counterpartyName !== null &&
        fits(other, document) &&
        // csak ha EZ az egyetlen pontos számlája: ha másik is van, nem ezt
        // kell elvenni (mérve: Hanna 2026-01-06, két 53 651 Ft-os számla)
        free().filter((d) => fits(other, d)).length === 1 &&
        narrativeSpans(other.narrative).some(
          (span) =>
            shapeOf(span.text) === shape && !knownNumbers.has(span.text),
        ),
    );
  };
  /**
   * 1, ha a közlemény egy hónapot nevez meg, és a számla nem arra a hónapra
   * szól. A hónap utolsó 3 napján kelt számla a KÖVETKEZŐ hónapé: a havidíjat
   * a hónap elején számlázzák, és néha egy-két nappal előbb (mérve: a B-O 2001
   * júniusi számlája 05-31-én kelt; e nélkül a „május” fizetés vitte el, és a
   * „június” a 05-01-i májusit kapta, mindkettő rosszul).
   */
  const monthMiss = (debit: MatchableDebit, document: CandidateDocument) => {
    const month = namedMonth(debit.narrative, debit.bookingDate);
    return month !== null && billedMonth(document.date) !== month ? 1 : 0;
  };
  const closest = (debit: MatchableDebit, documents: CandidateDocument[]) =>
    [...documents].sort(
      (a, b) =>
        proformaLast(a, b) ||
        dayDistance(a.date, debit.bookingDate) -
          dayDistance(b.date, debit.bookingDate) ||
        a.id.localeCompare(b.id),
    )[0]!;

  // A RÉTEGEK SORRENDJE A LÉNYEG: minden terhelés előbb a PONTOS egyezést
  // kapja meg, és csak utána jön a kerekítés. Enélkül egy korábbi fizetés a
  // tűrésen belül elvinné egy későbbi fizetés pontos számláját (mérve: a
  // 07-15-i 1999 Ft-os Tesla-fizetés vitte el a 08-07-i 1998 Ft-os számláját).
  for (const debit of open) {
    if (outcomes.has(debit.id)) continue;
    // 1. a számla száma a közleményben: MINDEN megnevezett számla (acrobot 25610)
    const spans = narrativeSpans(debit.narrative);
    const named: { document: CandidateDocument; span: NarrativeSpan }[] = [];
    for (const d of free()) {
      const span = spanNaming(debit, d, spans);
      if (span) named.push({ document: d, span });
    }
    // A PROFORMA CSAK TARTALÉK (acrobot 25607, Aquarioom 2026-09-29): a
    // közlemény a rendelés számát nevezi meg (CM9201), ami a proforma száma,
    // a valódi számla (FA00009139) más számot visel. Ha a partnertől van
    // pontos összegű valódi számla az ablakban, a proforma kimarad, és a
    // terhelés a további szabályokhoz megy.
    const realInvoice = partnerDocs(debit, 0.5).some(
      (d) =>
        d.kind === "INVOICE" &&
        exact(amountGap(debit, d.gross, d.currency), d.currency),
    );
    if (realInvoice)
      for (let i = named.length - 1; i >= 0; i--)
        if (named[i]!.document.kind === "PROFORMA") named.splice(i, 1);
    // ELÍRÁS-GYANÚ (acrobot 25655, Fluidra 2026-07-30): a közlemény helyesen
    // nevezi meg a számlát (KS26/04727), de az összeg nem illik hozzá, és
    // ugyanattól a partnertől egy MÁSIK fizetés pontosan a számla összegét
    // fizeti, egy nem létező, ugyanolyan alakú számmal (KS26/04724, elírás).
    // Ilyenkor a pontos összegű fizetés kapja a számlát, ez pedig Nem
    // párosodott marad, a számlával a jelöltjei között.
    if (
      named.length &&
      invoiceDifference(
        debit,
        named.map((n) => n.document),
      )
    )
      for (let i = named.length - 1; i >= 0; i--) {
        const document = named[i]!.document;
        if (!typoTwin(debit, document)) continue;
        withheld.set(debit.id, [...(withheld.get(debit.id) ?? []), document]);
        named.splice(i, 1);
      }
    if (named.length === 0) continue;
    const documents = named.map((n) => n.document);
    found(debit, documents, "a számla száma a közleményben");
    const missing = [
      ...documents.filter((d) => !d.hasOriginal).map((d) => d.number),
      ...namedWithoutDocument(spans, named, knownNumbers),
    ];
    const difference = invoiceDifference(debit, documents);
    const outcome = outcomes.get(debit.id)!;
    outcomes.set(debit.id, {
      ...outcome,
      // a megnevezett, de dokumentum nélküli szám miatt a tétel nem Megvan
      state:
        outcome.state === "FOUND" && missing.length > 0
          ? "ORIGINAL_MISSING"
          : outcome.state,
      ...(missing.length > 0 ? { missingNumbers: missing } : {}),
      ...(difference ? { amountDifference: difference } : {}),
    });
  }
  for (const debit of open) {
    if (outcomes.has(debit.id)) continue;
    // 2. a partner számlaszáma a szállító bankszámlája, pontos összeggel
    const account = (debit.counterpartyAccount ?? "").replace(/[\s-]/g, "");
    const byAccount = account
      ? window(debit).filter(
          (d) =>
            d.supplierAccounts.includes(account) &&
            exact(amountGap(debit, d.gross, d.currency), d.currency),
        )
      : [];
    if (byAccount.length)
      found(
        debit,
        [closest(debit, byAccount)],
        "a szállító bankszámlájára ment, egyező összeggel",
      );
  }
  // 3. pontos összeg + partner + dátumablak, GLOBÁLIS RANGSORRAL: a kisebb
  // eltérés, azon belül a közelebbi dátum nyer. Időrendben a 07-15-i 1999 Ft-os
  // fizetés 1 Ft-tal belefért volna a 08-05-i 1998 Ft-os számlába, és elvette
  // volna a 08-07-i, pontosan 1998 Ft-os fizetés elől (mérve).
  const pairs = open
    .filter((debit) => !outcomes.has(debit.id))
    .flatMap((debit) =>
      partnerDocs(debit, 0.5).flatMap((d) => {
        const gap = amountGap(debit, d.gross, d.currency);
        return exact(gap, d.currency)
          ? [
              {
                debit,
                document: d,
                gap: gap!,
                // a közleményben megnevezett hónap számlája előbb (B-O 2001)
                month: monthMiss(debit, d),
                days: dayDistance(d.date, debit.bookingDate),
              },
            ]
          : [];
      }),
    )
    .sort(
      (x, y) =>
        proformaLast(x.document, y.document) ||
        x.gap.comparedTo(y.gap) ||
        x.month - y.month ||
        x.days - y.days ||
        x.debit.bookingDate.localeCompare(y.debit.bookingDate) ||
        x.document.id.localeCompare(y.document.id),
    );
  for (const pair of pairs) {
    if (outcomes.has(pair.debit.id) || used.has(pair.document.id)) continue;
    found(
      pair.debit,
      [pair.document],
      "egyező összeg és partner a dátumablakban",
    );
  }
  // 3b. GYŰJTŐSZÁMLA: egy partner kártyás fizetéseinek havi összege egyetlen,
  // a következő hónap elején kelt számla. Ez az „egy számla egy terhelés”
  // szabály szűk kivétele: csak pontos összeg, egy kártya, egy vásárlási hónap,
  // legalább két fizetés, és egyetlen illeszkedő számla.
  for (const group of monthlyCardGroups(
    open.filter((debit) => !outcomes.has(debit.id)),
  )) {
    const sum = group.debits.reduce(
      (total, debit) => total.plus(debit.amount),
      new Prisma.Decimal(0),
    );
    const invoices = partnerDocs(group.debits[0]!, 0.5).filter(
      (d) =>
        d.gross !== null &&
        d.currency === group.debits[0]!.currency &&
        d.gross.equals(sum) &&
        d.date.slice(0, 7) === group.nextMonth &&
        Number(d.date.slice(8, 10)) <= MONTHLY_INVOICE_LAST_DAY,
    );
    if (invoices.length !== 1) continue;
    for (const debit of group.debits)
      found(
        debit,
        [invoices[0]!],
        `gyűjtőszámla: ${group.debits.length} kártyás fizetés havi összege`,
        `group:${invoices[0]!.id}`,
      );
  }
  // 3c. GYŰJTŐSZÁMLA KIS MARADÉKKAL: a pontos kör után, a megmaradt számlákra
  // (két kártyánál a pontosan egyező kártya előbb elviszi a sajátját)
  for (const group of monthlyCardGroups(
    open.filter((debit) => !outcomes.has(debit.id)),
  )) {
    const first = group.debits[0]!;
    const sum = group.debits.reduce(
      (total, debit) => total.plus(debit.amount),
      new Prisma.Decimal(0),
    );
    const largest = Prisma.Decimal.max(...group.debits.map((d) => d.amount));
    const invoices = partnerDocs(first, 0.5).filter((d) => {
      if (
        d.gross === null ||
        d.currency !== first.currency ||
        d.date.slice(0, 7) !== group.nextMonth ||
        Number(d.date.slice(8, 10)) > MONTHLY_INVOICE_LAST_DAY
      )
        return false;
      const remainder = d.gross.minus(sum);
      return (
        remainder.gt(0) &&
        remainder.lte(largest) &&
        remainder.lte(d.gross.times(MONTHLY_REMAINDER_SHARE))
      );
    });
    if (invoices.length !== 1) continue;
    const invoice = invoices[0]!;
    const difference = {
      amount: sum.minus(invoice.gross!),
      currency: invoice.currency,
    };
    for (const debit of group.debits) {
      found(
        debit,
        [invoice],
        `gyűjtőszámla: ${group.debits.length} kártyás fizetés havi összege, ` +
          `a számla többlete ${invoice.gross!.minus(sum).toFixed(0)} ${invoice.currency}, könyveletlen tétel lehet`,
        `group:${invoice.id}`,
      );
      outcomes.set(debit.id, {
        ...outcomes.get(debit.id)!,
        amountDifference: difference,
      });
    }
  }
  // 3d. KÁRTYÁS LEÍRÓ, MÁS KIÁLLÍTÓNÉV (barracuda esetlistája, OBI: a bank
  // „OBI 042 KISTARCSA”-t ír, a számla „OBI HUNGARY RETAIL KFT.”). A hasonlósági
  // arány itt alacsony, de HÁROM független egyezés együtt elég: a márka (az
  // első szó, legalább 3 betű), a pontos összeg, és a számla kelte a vásárlás
  // napja a közlemény elejéről. Csak ha EGY ilyen számla van.
  for (const debit of open) {
    if (outcomes.has(debit.id)) continue;
    const purchase = cardPurchaseDay(debit.narrative);
    const brand = firstWord(debit.counterpartyName ?? "");
    if (!purchase || !brand) continue;
    const invoices = window(debit).filter(
      (d) =>
        d.date === purchase &&
        firstWord(d.supplierName) === brand &&
        exact(amountGap(debit, d.gross, d.currency), d.currency),
    );
    if (invoices.length === 1)
      found(
        debit,
        invoices,
        "kártyás vásárlás: a márka, az összeg és a vásárlás napja egyezik",
      );
  }
  // 3e. SZTORNÓZOTT VÁSÁRLÁS (barracuda esetlistája, Tesla; acrobot 25933): a
  // partner jóváírót adott ki, aminek az abszolút értéke a terhelés, és a
  // kelte a vásárlás után legfeljebb 15 nappal van. Az eredeti számlára nem
  // támaszkodik: a NAV-sora 0 bruttót hordoz. Csak ha EGY ilyen jóváíró van.
  // Számla nem kell; a visszatérítés zárja le, és ha a jóváíró keltétől 30
  // napig nem jön meg, a tétel nem marad csendben a Nem kell számla alatt.
  const usedCredits = new Set<string>();
  for (const debit of open) {
    if (outcomes.has(debit.id)) continue;
    const purchase = cardPurchaseDay(debit.narrative) ?? debit.bookingDate;
    const brand = firstWord(debit.counterpartyName ?? "");
    const sameSeller = (name: string | null) =>
      !!name &&
      ((!!debit.counterpartyName &&
        samePartner(name, debit.counterpartyName, 0.6)) ||
        (brand !== null && firstWord(name) === brand));
    const notes = free().filter(
      (d) =>
        d.gross !== null &&
        d.gross.isNegative() &&
        d.date >= purchase &&
        d.date <= addDays(purchase, CREDIT_NOTE_DAYS) &&
        sameSeller(d.supplierName) &&
        exact(amountGap(debit, d.gross.abs(), d.currency), d.currency),
    );
    if (notes.length !== 1) continue;
    const note = notes[0]!;
    used.add(note.id);
    // AZ EREDETI SZÁMLA a jóváíró mellé (acrobot 25981: a könyvelőnek mindkettő
    // kell, egy sorban): ugyanattól az eladótól, a vásárlás napján kelt, és a
    // bruttója 0, mert a NAV-sor a sztornó után így áll (mérve: Tesla
    // 4042A0000031808). A teljes összegű eredetit ide nem keresi: azt a 3. és a
    // 3d. szabály már előbb párosította volna. Csak ha EGY ilyen van; különben a
    // jóváíró egyedül.
    const originals = free().filter(
      (d) =>
        d.kind === "INVOICE" &&
        d.date === purchase &&
        d.gross !== null &&
        d.gross.isZero() &&
        sameSeller(d.supplierName),
    );
    const original = originals.length === 1 ? originals[0]! : null;
    if (original) used.add(original.id);
    const refund = (input.credits ?? [])
      .filter(
        (c) =>
          !usedCredits.has(c.id) &&
          c.currency === debit.currency &&
          c.amount.equals(debit.amount) &&
          c.bookingDate >= purchase &&
          (sameSeller(c.counterpartyName) ||
            sameSeller(cardMerchant(c.narrative))),
      )
      .sort(
        (a, b) =>
          a.bookingDate.localeCompare(b.bookingDate) ||
          a.id.localeCompare(b.id),
      )[0];
    if (refund) usedCredits.add(refund.id);
    const due = addDays(note.date, REFUND_DAYS);
    const late = !refund && input.asOf !== undefined && input.asOf > due;
    outcomes.set(debit.id, {
      state: refund
        ? "NO_INVOICE_NEEDED"
        : late
          ? "REFUND_MISSING"
          : "REFUND_EXPECTED",
      documents: original ? [original, note] : [note],
      matchedBy: "RULE",
      reason: refund
        ? `sztornózva (${note.number}), a visszatérítés megjött: ${refund.bookingDate}`
        : late
          ? `sztornózva (${note.number}), a visszatérítés elmaradt (határidő: ${due})`
          : `sztornózva (${note.number}), visszatérítés várható (határidő: ${due})`,
      candidates: [],
      refund: {
        amount: debit.amount,
        currency: debit.currency,
        creditNoteNumber: note.number,
        due,
        receivedOn: refund?.bookingDate ?? null,
      },
    });
  }
  // 3f. KÁRTYÁS VÁSÁRLÁS, A SZÁLLÍTÓ NEVE NÉLKÜL (acrobot 26084; Balázs: a
  // kártyán „Tesland” áll, a számla a MEDIAVOX Multimedia Kft.-é, Apple Pay-en
  // át). A kereskedő neve itt nem segít, ezért HÁROM független egyezés kell: a
  // pontos összeg, a vásárlás napja (±1 nap: a kiállítás és a terhelés napja
  // eltérhet) és a számla KÁRTYÁS fizetési módja. Csak ha EGY ilyen számla van,
  // és arra csak EGY ilyen terhelés pályázik; különben nem találgatunk.
  const cardFits = (debit: MatchableDebit, d: CandidateDocument) => {
    const purchase = cardPurchaseDay(debit.narrative);
    return (
      purchase !== null &&
      d.kind === "INVOICE" &&
      d.cardPaid === true &&
      dayDistance(d.date, purchase) <= 1 &&
      exact(amountGap(debit, d.gross, d.currency), d.currency)
    );
  };
  for (const debit of open) {
    if (outcomes.has(debit.id)) continue;
    const invoices = free().filter((d) => cardFits(debit, d));
    if (invoices.length !== 1) continue;
    const rivals = open.filter(
      (other) => !outcomes.has(other.id) && cardFits(other, invoices[0]!),
    );
    if (rivals.length === 1)
      found(
        debit,
        invoices,
        `kártyás vásárlás más néven („${debit.counterpartyName ?? ""}”): az összeg, a vásárlás napja és a kártyás fizetési mód egyezik`,
      );
  }
  // 3g. A MEGTANULT KERESKEDŐNÉV (acrobot 26084: „tanulja meg a Tesland ->
  // MEDIAVOX aliast”). Ha egy kártyás kereskedő (a márkája, az első szó) egy
  // párosításban (a 3f., kézzel, vagy bármelyik szabállyal) egy szállító
  // számláját kapta, a
  // kereskedő többi terhelése annak a szállítónak a pontos összegű számláját
  // kapja a szokásos ablakban. Tárolás nélkül: minden számítás a párosításokból
  // újra tanulja, tehát egy visszavont kézi párosítás a tanulságot is viszi.
  const learned = new Map<string, Map<string, string>>();
  for (const debit of input.debits) {
    const outcome = outcomes.get(debit.id);
    const brand = firstWord(debit.counterpartyName ?? "");
    if (
      !outcome ||
      !brand ||
      !cardPurchaseDay(debit.narrative) ||
      (outcome.state !== "FOUND" && outcome.state !== "ORIGINAL_MISSING")
    )
      continue;
    for (const d of outcome.documents) {
      const names = learned.get(brand) ?? new Map<string, string>();
      names.set(normalizeName(d.supplierName), d.supplierName);
      learned.set(brand, names);
    }
  }
  for (const debit of open) {
    if (outcomes.has(debit.id) || !cardPurchaseDay(debit.narrative)) continue;
    const brand = firstWord(debit.counterpartyName ?? "");
    const names = brand ? learned.get(brand) : undefined;
    if (!names) continue;
    const invoices = window(debit).filter(
      (d) =>
        d.kind === "INVOICE" &&
        names.has(normalizeName(d.supplierName)) &&
        exact(amountGap(debit, d.gross, d.currency), d.currency),
    );
    if (invoices.length === 1)
      found(
        debit,
        invoices,
        `kártyás vásárlás: a kereskedő („${debit.counterpartyName ?? ""}”) egy másik párosítás szerint a(z) ${invoices[0]!.supplierName} számláját hozza`,
      );
  }
  for (const debit of open) {
    if (outcomes.has(debit.id)) continue;
    // 4. kerekítéssel (2-5 Ft), csak ha EGY jelölt van: többől nem választunk
    const anyRounding = partnerDocs(debit, 0.5).filter((d) =>
      rounded(amountGap(debit, d.gross, d.currency), d.currency),
    );
    // a valódi számla mellett a proforma nem tesz kétértelművé
    const roundings = anyRounding.some((d) => d.kind !== "PROFORMA")
      ? anyRounding.filter((d) => d.kind !== "PROFORMA")
      : anyRounding;
    if (roundings.length === 1)
      found(
        debit,
        roundings,
        "egyező összeg kerekítési eltéréssel (5 Ft-on belül)",
      );
  }
  for (const debit of open) {
    if (outcomes.has(debit.id)) continue;
    const candidates = partnerDocs(debit, 0.6);
    // A „van-e számla a partnertől” kérdés az ÖSSZES számlára szól, a más
    // fizetés által már elvittekre is (a második Alza-fizetés számlája
    // létezik, csak az elsőé lett): Nem párosodott, nem Nincs számla.
    const partnerHasDocuments = input.documents.some(
      (d) =>
        inWindow(debit.bookingDate, d.date) &&
        debit.counterpartyName &&
        samePartner(d.supplierName, debit.counterpartyName, 0.6),
    );
    // 5. több számla egy utalásban: legfeljebb 5 elemű részhalmaz, egyértelműen
    const fitting = subsets(
      partnerDocs(debit, 0.5)
        .filter((d) => d.gross !== null)
        .slice(0, 12),
      5,
    ).filter(
      (set) =>
        set.every((d) => d.currency === set[0]!.currency) &&
        exact(
          amountGap(
            debit,
            set.reduce((sum, d) => sum.plus(d.gross!), new Prisma.Decimal(0)),
            set[0]!.currency,
          ),
          set[0]!.currency,
        ),
    );
    if (fitting.length === 1) {
      found(debit, fitting[0]!, `${fitting[0]!.length} számla egy utalásban`);
      continue;
    }
    const ambiguousRounding =
      partnerDocs(debit, 0.5).filter((d) =>
        rounded(amountGap(debit, d.gross, d.currency), d.currency),
      ).length > 1;
    const kept = withheld.get(debit.id) ?? [];
    // BIZTOSÍTÁS (barracuda esetlistája, 2. csoport): a díjhoz díjértesítő jár,
    // vagy a biztosító számlája; a partner más számlái (az OTP banki díjai)
    // nem ehhez valók, tehát a „van számla a partnertől” itt félrevezet
    const insurance =
      debit.category === "INSURANCE" &&
      !kept.length &&
      fitting.length <= 1 &&
      !ambiguousRounding;
    outcomes.set(debit.id, {
      state: partnerHasDocuments && !insurance ? "NOT_MATCHED" : "NO_INVOICE",
      documents: [],
      matchedBy: null,
      reason: kept.length
        ? `a közlemény a ${kept.map((d) => d.number).join(", ")} számlát nevezi meg, ` +
          "de az összegét egy másik fizetés pontosan fizeti (elírás-gyanú): kézi döntés"
        : fitting.length > 1
          ? "több számla-összeállítás is kiadja az összeget: kézi választás"
          : ambiguousRounding
            ? "több kerekítési találat: kézi választás"
            : insurance
              ? "biztosítás: a díjértesítő (vagy a biztosító számlája) hiányzik"
              : partnerHasDocuments
                ? "a partnertől van számla, de ez a fizetés nem párosodott"
                : "a partnertől nincs számla a forrásokban",
      // a neki hagyott számla jelöltként látszik, akkor is, ha már a másiké
      candidates: [...kept, ...candidates.filter((c) => !kept.includes(c))],
    });
  }
  for (const id of input.paperOriginals ?? []) {
    const outcome = outcomes.get(id);
    if (outcome?.state === "ORIGINAL_MISSING")
      outcomes.set(id, {
        ...outcome,
        state: "FOUND",
        reason: `${outcome.reason}; az eredeti papíron megvan`,
      });
    // DIGITÁLIS SZÁMLA NÉLKÜL (acrobot 25745, Balázs: az Aqua-Light külföldi
    // számlája csak papíron van meg; NAV-sor nincs, tehát a tétel nem
    // párosodhatott): a jelölés a hiánylistáról is leveszi, és a könyvelői
    // csomag „papíron megvan”-ként sorolja
    else if (
      outcome?.state === "NOT_MATCHED" ||
      outcome?.state === "NO_INVOICE"
    )
      outcomes.set(id, {
        ...outcome,
        state: "FOUND",
        documents: [],
        // az eredeti indok marad (acrobot 25762): látszik, hogy volt-e jelölt
        reason: `${outcome.reason}; nincs digitális számla, az eredeti papíron megvan`,
      });
  }
  markDoublePaid(outcomes);
  return outcomes;
}

/** Ezek az állapotok számítanának rendezettnek; a kettős fizetés felülírja őket. */
const SETTLED_LIKE: ReadonlySet<ItemState> = new Set([
  "FOUND",
  "ORIGINAL_MISSING",
  "NOT_MATCHED",
]);

/**
 * KÉTSZER FIZETETT SZÁMLA (acrobot 25636, éles: a Sopro KB-2855/2026 két
 * 172 006 Ft-os terheléshez, ugyanaz a PDF kétszer feltöltve). Ha ugyanaz a
 * számla (azonos fájl vagy számlaszám) KÉT KÜLÖNBÖZŐ PÁROSÍTÁSBAN szerepel,
 * egyik sem Megvan: mindkettő a másikat nevezi meg.
 *
 * Egy gyűjtőszámla-párosítás (egy havi számla a kártya összes fizetéséhez,
 * acrobot 25708) EGY párosítás: a tagjai egymás miatt nem kétszer fizetettek.
 * Mérve 2026-10-01: e nélkül egy Parkl-hónap minden fizetése DOUBLE_PAID lett.
 */
function markDoublePaid(outcomes: Map<string, MatchOutcome>): void {
  // azonosság -> párosítás -> a párosítás terhelései
  const pairingsOf = new Map<string, Map<string, string[]>>();
  for (const [debitId, outcome] of outcomes)
    for (const document of outcome.documents)
      for (const identity of document.identities ?? []) {
        const pairings =
          pairingsOf.get(identity) ?? new Map<string, string[]>();
        const pairing = outcome.pairing ?? debitId;
        pairings.set(pairing, [...(pairings.get(pairing) ?? []), debitId]);
        pairingsOf.set(identity, pairings);
      }
  const others = new Map<string, Set<string>>();
  for (const pairings of pairingsOf.values()) {
    if (pairings.size < 2) continue;
    for (const [pairing, debits] of pairings)
      for (const debitId of debits)
        for (const [otherPairing, otherDebits] of pairings)
          if (otherPairing !== pairing)
            for (const other of otherDebits)
              others.set(
                debitId,
                new Set([...(others.get(debitId) ?? []), other]),
              );
  }
  for (const [debitId, with_] of others) {
    const outcome = outcomes.get(debitId)!;
    if (!SETTLED_LIKE.has(outcome.state)) continue;
    outcomes.set(debitId, {
      ...outcome,
      state: "DOUBLE_PAID",
      doublePaidWith: [...with_].sort(),
      reason: `${outcome.reason}; ugyanez a számla egy másik terheléshez is párosítva`,
    });
  }
}
