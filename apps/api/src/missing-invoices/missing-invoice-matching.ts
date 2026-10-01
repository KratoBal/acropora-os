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
  "NAV" | "MAILBOX" | "UPLOAD" | "DRIVE" | "SETTLEMENT" | "PREMIUM_NOTICE";

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

export type ItemState =
  | "FOUND"
  | "ORIGINAL_MISSING"
  | "NOT_MATCHED"
  | "NO_INVOICE"
  | "NOT_COMPANY"
  | "PROFORMA_ONLY"
  | "DOUBLE_PAID"
  | "NO_INVOICE_NEEDED";

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
}

const GENERIC =
  /\b(hungária|hungaria|magyarország|magyarorszag|online|digital|technologies|international|kereskedelmi|korlátolt|korlatolt|felelősségű|felelossegu|társaság|tarsasag|kft|zrt|nyrt|bt|gmbh|ltd|limited|inc|llc|bv|srl|sas|doo|ag)\b/g;

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
  return first(x) === first(y) && sequenceRatio(x, y) >= threshold;
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

/** A valódi számla előbb, a proforma utána: a proforma tartalék (acrobot 25607). */
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
function spanNaming(
  debit: MatchableDebit,
  document: CandidateDocument,
  spans: readonly NarrativeSpan[],
): NarrativeSpan | null {
  // a számla száma MELLETT a hivatkozásai is (#1323: a Fauna Marin közleménye a
  // rendelésszámot nevezi meg), ugyanazzal az egész-szó szabállyal
  for (const raw of [document.number, ...(document.references ?? [])]) {
    const number = compact(raw);
    if (number.length < 5) continue;
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
    outcomes.set(debit.id, {
      state: partnerHasDocuments ? "NOT_MATCHED" : "NO_INVOICE",
      documents: [],
      matchedBy: null,
      reason: kept.length
        ? `a közlemény a ${kept.map((d) => d.number).join(", ")} számlát nevezi meg, ` +
          "de az összegét egy másik fizetés pontosan fizeti (elírás-gyanú): kézi döntés"
        : fitting.length > 1
          ? "több számla-összeállítás is kiadja az összeget: kézi választás"
          : ambiguousRounding
            ? "több kerekítési találat: kézi választás"
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
