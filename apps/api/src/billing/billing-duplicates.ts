import { invoiceNumberKey } from "./external-billing-one-row.js";

/**
 * THE SAME INVOICE TWICE, ACROSS SOURCES (acrobot 26208 and 26210; Balázs
 * 2026-10-05 09:07 UTC: "innentől ez legyen ellenőrizve. A bejövőknél se
 * legyen ilyen."). Pure, so every rule is measured without a database; the
 * read-only check (`billing-duplicates.cli.ts`) and the one-off merge
 * (`external-billing-merge.cli.ts`) both stand on it.
 */

/** The first eight digits of a Hungarian tax number: the taxpayer itself. */
export const taxBase = (value: string | null | undefined): string =>
  (value ?? "").replace(/\D/g, "").slice(0, 8);

/** A group of rows that are one invoice, with the key that made them one. */
export interface DuplicateGroup<T> {
  key: string;
  rows: T[];
}

function groupsOf<T>(
  rows: readonly T[],
  keyOf: (row: T) => string | null,
): DuplicateGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, rows: group }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * OUTGOING: our own invoices, so the issuer is always us and the number alone
 * is the identity. More than one row per number is a duplicate, whatever the
 * sources.
 */
export function outgoingDuplicates<T extends { documentNumber: string }>(
  rows: readonly T[],
): DuplicateGroup<T>[] {
  return groupsOf(rows, (row) => invoiceNumberKey(row.documentNumber) || null);
}

/**
 * INCOMING: a number is unique only for its supplier, so the key is the
 * number and the supplier's tax base (the name when it has no tax number).
 */
export function incomingKey(
  number: string,
  supplierTaxNumber: string | null | undefined,
  supplierName: string,
): string | null {
  const numberKey = invoiceNumberKey(number);
  if (!numberKey) return null;
  const who = taxBase(supplierTaxNumber) || supplierName.trim().toLowerCase();
  return who ? `${numberKey}|${who}` : null;
}

export function incomingDuplicates<
  T extends {
    documentNumber: string;
    supplierTaxNumber: string | null;
    supplierName: string;
  },
>(rows: readonly T[]): DuplicateGroup<T>[] {
  return groupsOf(rows, (row) =>
    incomingKey(row.documentNumber, row.supplierTaxNumber, row.supplierName),
  );
}

/** The edit distance of two short strings (insert, delete, replace). */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1)
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * A MISTYPED NUMBER, SUSPECTED (card 2408d6ad, barracuda's #1644 review). A
 * purchase recorded by hand with a typo in the supplier's number does not
 * share the key of the same invoice from Számlázz.hu or the mailbox, so the
 * two stand as two rows. Flagged: a PURCHASE row and a row from another
 * source with the same supplier, issue date, currency and gross, whose
 * numbers (in the key form) differ by at most two characters. A suspicion,
 * not a duplicate: two invoices of one day can share an amount.
 */
export function incomingTypoSuspects<
  T extends {
    source: string;
    documentNumber: string;
    supplierTaxNumber: string | null;
    supplierName: string;
    issueDate: Date;
    currency: string;
    grossAmount: { toFixed(digits: number): string };
  },
>(rows: readonly T[]): DuplicateGroup<T>[] {
  const sameInvoice = (row: T) =>
    [
      taxBase(row.supplierTaxNumber) || row.supplierName.trim().toLowerCase(),
      row.issueDate.toISOString().slice(0, 10),
      row.currency,
      row.grossAmount.toFixed(2),
    ].join("|");
  const purchases = rows.filter((row) => row.source === "PURCHASE");
  const others = new Map<string, T[]>();
  for (const row of rows)
    if (row.source !== "PURCHASE")
      others.set(sameInvoice(row), [
        ...(others.get(sameInvoice(row)) ?? []),
        row,
      ]);
  const groups: DuplicateGroup<T>[] = [];
  for (const purchase of purchases) {
    const number = invoiceNumberKey(purchase.documentNumber);
    for (const other of others.get(sameInvoice(purchase)) ?? []) {
      const distance = editDistance(
        number,
        invoiceNumberKey(other.documentNumber),
      );
      if (distance > 0 && distance <= 2)
        groups.push({
          key: `${sameInvoice(purchase)}|${purchase.documentNumber}~${other.documentNumber}`,
          rows: [purchase, other],
        });
    }
  }
  return groups.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * THE MISSING-INVOICE CANDIDATES, AFTER THEIR OWN MERGE (`mergeSameInvoice`):
 * an `inv:` identity on two candidates is one invoice counted twice there,
 * in the list, the pairing and the accountant's export alike.
 */
export function candidateDuplicates<
  T extends { id: string; identities?: readonly string[] },
>(candidates: readonly T[]): DuplicateGroup<T>[] {
  const owners = new Map<string, T[]>();
  for (const candidate of candidates)
    for (const identity of new Set(candidate.identities ?? []))
      if (identity.startsWith("inv:"))
        owners.set(identity, [...(owners.get(identity) ?? []), candidate]);
  return [...owners.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, rows]) => ({ key, rows }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export interface ExternalMergeRow {
  id: string;
  source: string;
  externalId: string;
  documentNumber: string;
  issueDate: Date;
  currency: string;
  grossAmount: { toFixed(digits: number): string };
  pdfStorageKey: string | null;
  ebizExternalId: string | null;
}

export type ExternalMergePlan =
  | {
      kind: "MERGE";
      number: string;
      szamlazz: ExternalMergeRow;
      ebiz: ExternalMergeRow;
    }
  | {
      kind: "DIFFERS";
      number: string;
      rows: ExternalMergeRow[];
      reason: string;
    }
  | { kind: "OTHER"; number: string; rows: ExternalMergeRow[] };

/**
 * WHAT THE ONE-OFF MERGE WOULD DO WITH EACH OUTGOING DUPLICATE. Only the
 * expected shape is merged: one Számlázz.hu row and one eBIZ row, with the
 * same issue date, currency and gross. Anything else is listed and left for a
 * person: two rows that disagree may not be the same invoice after all.
 */
export function planExternalMerges(
  rows: readonly ExternalMergeRow[],
): ExternalMergePlan[] {
  return outgoingDuplicates(rows).map(({ key, rows: group }) => {
    const szamlazz = group.filter((row) => row.source === "SZAMLAZZ");
    const ebiz = group.filter((row) => row.source === "EBIZ");
    if (
      group.length !== 2 ||
      szamlazz.length !== 1 ||
      ebiz.length !== 1 ||
      szamlazz[0]!.ebizExternalId !== null
    )
      return { kind: "OTHER", number: key, rows: group };
    const [s, e] = [szamlazz[0]!, ebiz[0]!];
    const differs = [
      s.issueDate.getTime() !== e.issueDate.getTime() && "kelt",
      s.currency.toUpperCase() !== e.currency.toUpperCase() && "pénznem",
      s.grossAmount.toFixed(2) !== e.grossAmount.toFixed(2) && "bruttó",
    ].filter(Boolean);
    return differs.length > 0
      ? {
          kind: "DIFFERS",
          number: key,
          rows: group,
          reason: `eltér: ${differs.join(", ")}`,
        }
      : { kind: "MERGE", number: key, szamlazz: s, ebiz: e };
  });
}
