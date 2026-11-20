/**
 * PAYMENT INTERMEDIARIES (acrobot 58103 and 58107, Balázs 2026-11-20): some payments name the intermediary on the bank
 * statement, never the issuer of the invoice. DijNet is the measured case (`SIMPLEP*dijnet`: the utilities, the waste
 * and the sewage companies all show up as the same partner), a parcel locker payment is the other (`PCSOMAG356`: the
 * invoice is issued by the web shop behind it). The issuer-name rules cannot see the invoice, and the payment stays
 * "no invoice" although the invoice is there.
 *
 * A mapping says: a payment whose counterparty or narrative matches `payment` is paid for an invoice of an issuer that
 * matches one of `issuers`. It replaces the issuer-name requirement; the amount and the invoice date (on or before the
 * payment) still decide (`matchMonth`, rule 3d). The mapping comes from the environment, never from the code: the
 * names of the issuers are company data, and this code is a public base.
 *
 * `MISSING_INVOICES_PAYMENT_INTERMEDIARIES` is a JSON array: `[{"payment":"<regex>","issuers":["<regex>", ...]}]`.
 * Every pattern is case-insensitive and is matched against the ACCENT-FOLDED text, so the patterns are written
 * without accents.
 */

export interface PaymentIntermediary {
  /** matched against the payment's counterparty name and narrative */
  payment: RegExp;
  /** matched against the supplier name of an invoice */
  issuers: readonly RegExp[];
}

export interface PaymentIntermediaryParse {
  intermediaries: PaymentIntermediary[];
  /** what was skipped and why: a bad entry never takes the others down, but it is not silent */
  problems: string[];
}

/** Longest pattern accepted: a configuration line, not a program. */
const MAX_PATTERN_LENGTH = 200;
const MAX_ENTRIES = 50;

/**
 * Accents removed (ő, ű included): the form both sides of a pattern are compared in. Case is NOT touched here: the
 * patterns carry regex escapes (`\S`, `\W`), and lower-casing them would turn them into the opposite class. The
 * `i` flag does the case.
 */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

function pattern(value: unknown, where: string, problems: string[]) {
  if (typeof value !== "string" || !value.trim()) {
    problems.push(`${where}: not a non-empty text`);
    return null;
  }
  if (value.length > MAX_PATTERN_LENGTH) {
    problems.push(`${where}: longer than ${MAX_PATTERN_LENGTH} characters`);
    return null;
  }
  try {
    return new RegExp(foldText(value), "i");
  } catch {
    problems.push(`${where}: not a valid regular expression`);
    return null;
  }
}

export function parsePaymentIntermediaries(
  raw: string | undefined,
): PaymentIntermediaryParse {
  const problems: string[] = [];
  const intermediaries: PaymentIntermediary[] = [];
  if (!raw?.trim()) return { intermediaries, problems };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { intermediaries, problems: ["not valid JSON"] };
  }
  if (!Array.isArray(parsed))
    return { intermediaries, problems: ["not a JSON array"] };
  parsed.slice(0, MAX_ENTRIES).forEach((entry: unknown, index) => {
    const where = `entry ${index + 1}`;
    if (!entry || typeof entry !== "object") {
      problems.push(`${where}: not an object`);
      return;
    }
    const { payment, issuers } = entry as {
      payment?: unknown;
      issuers?: unknown;
    };
    const paymentPattern = pattern(payment, `${where} payment`, problems);
    if (!Array.isArray(issuers) || !issuers.length) {
      problems.push(`${where} issuers: not a non-empty list`);
      return;
    }
    const issuerPatterns = issuers.flatMap((issuer, at) => {
      const compiled = pattern(issuer, `${where} issuers[${at}]`, problems);
      return compiled ? [compiled] : [];
    });
    if (paymentPattern && issuerPatterns.length)
      intermediaries.push({ payment: paymentPattern, issuers: issuerPatterns });
  });
  if (parsed.length > MAX_ENTRIES)
    problems.push(`only the first ${MAX_ENTRIES} entries are read`);
  return { intermediaries, problems };
}

/** The issuer patterns of every mapping whose payment pattern matches this payment; empty: not an intermediary payment. */
export function issuersForPayment(
  intermediaries: readonly PaymentIntermediary[],
  payment: { counterpartyName: string | null; narrative: string },
): readonly RegExp[] {
  const text = foldText(
    `${payment.counterpartyName ?? ""} ${payment.narrative}`,
  );
  return intermediaries
    .filter((rule) => rule.payment.test(text))
    .flatMap((rule) => rule.issuers);
}

export const isIntermediaryIssuer = (
  issuers: readonly RegExp[],
  supplierName: string,
): boolean => {
  const folded = foldText(supplierName);
  return issuers.some((issuer) => issuer.test(folded));
};
