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
 *   6. a proforma nem számla.
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
  | "NOT_MATCHED"
  | "NO_INVOICE"
  | "NOT_COMPANY"
  | "PROFORMA_ONLY"
  | "NO_INVOICE_NEEDED";

export interface MatchOutcome {
  state: ItemState;
  documents: CandidateDocument[];
  matchedBy: "RULE" | "MANUAL" | null;
  /** A döntő szabály mondata; a hiánylista kiírja. */
  reason: string;
  /** A drawer jelöltjei: a partner ablakba eső dokumentumai. */
  candidates: CandidateDocument[];
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

const dayDistance = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

const compact = (s: string) => s.replace(/\s/g, "").toLowerCase();

function stateOf(documents: CandidateDocument[]): ItemState {
  if (documents.some((d) => d.kind === "PROFORMA")) return "PROFORMA_ONLY";
  if (documents.some((d) => d.payee === "NOT_COMPANY")) return "NOT_COMPANY";
  // a vevő nem ellenőrizhető: a brief szerint csak a Kft-re szóló számla
  // Megvan, tehát ez a drawerben kézzel jelölendő, addig Nem párosodott
  if (documents.some((d) => d.payee === "UNKNOWN")) return "NOT_MATCHED";
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

export function matchMonth(input: {
  debits: readonly MatchableDebit[];
  documents: readonly CandidateDocument[];
  /** terhelés -> kézzel párosított dokumentum(ok) azonosítója */
  manual: ReadonlyMap<string, readonly string[]>;
}): Map<string, MatchOutcome> {
  const byId = new Map(input.documents.map((d) => [d.id, d]));
  const used = new Set<string>();
  const outcomes = new Map<string, MatchOutcome>();
  const free = () => input.documents.filter((d) => !used.has(d.id));

  // 0. a kézi párosítás elsőbbsége: ezek a dokumentumok senki másé
  for (const debit of input.debits) {
    const ids = input.manual.get(debit.id);
    if (!ids?.length) continue;
    const documents = ids.flatMap((id) => byId.get(id) ?? []);
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
  ) => {
    documents.forEach((d) => used.add(d.id));
    outcomes.set(debit.id, {
      state: stateOf(documents),
      documents,
      matchedBy: "RULE",
      reason,
      candidates: [],
    });
  };
  const closest = (debit: MatchableDebit, documents: CandidateDocument[]) =>
    [...documents].sort(
      (a, b) =>
        dayDistance(a.date, debit.bookingDate) -
          dayDistance(b.date, debit.bookingDate) || a.id.localeCompare(b.id),
    )[0]!;

  // A RÉTEGEK SORRENDJE A LÉNYEG: minden terhelés előbb a PONTOS egyezést
  // kapja meg, és csak utána jön a kerekítés. Enélkül egy korábbi fizetés a
  // tűrésen belül elvinné egy későbbi fizetés pontos számláját (mérve: a
  // 07-15-i 1999 Ft-os Tesla-fizetés vitte el a 08-07-i 1998 Ft-os számláját).
  for (const debit of open) {
    if (outcomes.has(debit.id)) continue;
    // 1. a számla száma a közleményben
    const byNumber = free().find(
      (d) =>
        d.number.replace(/\s/g, "").length >= 5 &&
        compact(debit.narrative).includes(compact(d.number)),
    );
    if (byNumber) found(debit, [byNumber], "a számla száma a közleményben");
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
  for (const debit of open) {
    if (outcomes.has(debit.id)) continue;
    // 4. kerekítéssel (2-5 Ft), csak ha EGY jelölt van: többől nem választunk
    const roundings = partnerDocs(debit, 0.5).filter((d) =>
      rounded(amountGap(debit, d.gross, d.currency), d.currency),
    );
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
    outcomes.set(debit.id, {
      state: partnerHasDocuments ? "NOT_MATCHED" : "NO_INVOICE",
      documents: [],
      matchedBy: null,
      reason:
        fitting.length > 1
          ? "több számla-összeállítás is kiadja az összeget: kézi választás"
          : ambiguousRounding
            ? "több kerekítési találat: kézi választás"
            : partnerHasDocuments
              ? "a partnertől van számla, de ez a fizetés nem párosodott"
              : "a partnertől nincs számla a forrásokban",
      candidates,
    });
  }
  return outcomes;
}
