import { createHmac } from "node:crypto";

import {
  FAMILY_NAMES,
  GIVEN_NAMES,
  STREET_NAMES,
  STREET_TYPES,
} from "./pseudonym-names.js";

/**
 * THE PSEUDONYMIZATION ENGINE (stage anonymization chain, slice S1; card 07b56a1f; plan 2026-10-12 section 3.1 points 2 and 3).
 * PURE FUNCTIONS: no database, no file, no clock. A key goes in, and the same real value always comes out as the same fake
 * one, in every table and every run that uses that key: relations, matching logic and exact duplicates stay testable on the
 * stage. Another key gives other fakes, and the fake does not let anyone recover the real value without the key.
 *
 * HOW: every fake is drawn from a stream of `HMAC-SHA256(key, domain | attempt | normalized real value | counter)` bytes
 * (`Stream`), with an unbiased `below(n)`. The NORMALIZED value is what is hashed (case, spacing and separators fold away), so
 * "+36 30 123 4567" and "06301234567" give the same fake subscriber digits.
 *
 * FORMAT-VALID, AND WHAT THAT MEANS HERE (every rule is sourced; none is guessed):
 *   - e-mail: `u<12 base32 characters>@teszt.acropora.invalid`, an undeliverable domain (the plan, 3.2).
 *   - IBAN: the ISO 13616 mod-97 check digits (the standard's own method). A Hungarian IBAN also gets its two national
 *     check digits: the bank-and-branch block and the account block are weighted 9-7-3-1 repeated, and the check digit makes the
 *     weighted sum a multiple of ten. Verified against the registry's published example HU42117730161111101800000000 (both
 *     blocks sum to a multiple of ten; see the test). The bank code (first three digits) is kept: it names the institution.
 *   - personal tax id (adoazonosito jel, 10 digits): first digit 8, digits 2-6 the days from 1867-01-01 to a birth date, 7-9 a
 *     serial, the 10th digit the sum of (position x digit) over the first nine, mod 11. SOURCE: secondary articles that agree
 *     (penzcentrum.hu and others); the legal text (1996. evi XX. torveny, annex 1) was NOT retrieved, and the sources do not say
 *     what happens when the remainder is 10: such a serial is skipped here, so the output is never ambiguous.
 *   - company tax number (adoszam 8-1-2): the 8-digit core is replaced, the VAT code and the county code are kept. The core's
 *     8th digit is the check digit of the first seven, weighted 9-7-3-1-9-7-3 (the sum plus the check digit is a multiple of
 *     ten). MEASURED, not quoted (barracuda's request, #2320): the rule holds on all four public company tax numbers checked
 *     (OTP Bank and Richter Gedeon from their own filings, Magyar Telekom from an official 2010 notice, MOL from a company
 *     directory); a wrong rule would pass four numbers by chance once in ten thousand. The application itself does not validate
 *     a tax number's shape, so this is faithfulness to the real format, not a requirement of the app.
 *   - phone, street address, parcel number: a plausible Hungarian shape (the area code kept, the subscriber digits replaced;
 *     a street from the synthetic list; a carrier parcel number substituted character class for character class). A carrier
 *     parcel number may carry a check digit that this does not reproduce.
 *
 * NO REAL CHARACTER SURVIVES A FALLBACK (barracuda, #2320): a field named "phone" or "bank account" can hold text ("Kovacs Peter,
 * titkarsag", a name typed into the wrong field). Whatever does not parse as the expected form goes through `shape`, which
 * replaces EVERY digit and EVERY letter (accented ones too: a name's word lengths, spaces and accents are a fingerprint) with a
 * DIFFERENT digit or letter, and a value that does parse has its leftover letters replaced the same way. Only separators and
 * a country prefix (HU, DE ...) are kept.
 *   - names: synthetic Hungarian family and given names from `pseudonym-names.ts`, in Hungarian order (family name first).
 *
 * COLLISIONS: a fake can coincide with another real value's fake (most visible in the 8-digit tax core: about 10^7 values).
 * `findCollisions` finds them by index; the caller (S3) re-draws with `attempt + 1`, which stays deterministic.
 */

export const FAKE_EMAIL_DOMAIN = "teszt.acropora.invalid";
export const MIN_KEY_BYTES = 32;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const WEIGHTS_9731 = [9, 7, 3, 1] as const;

/** A deterministic byte stream: HMAC blocks keyed by the secret, separated by domain, attempt and the normalized value. */
class Stream {
  private block: Buffer = Buffer.alloc(0);
  private position = 0;
  private counter = 0;

  constructor(
    private readonly key: Buffer,
    private readonly domain: string,
    private readonly input: string,
    private readonly attempt: number,
  ) {}

  private byte(): number {
    if (this.position >= this.block.length) {
      this.block = createHmac("sha256", this.key)
        .update(
          `${this.domain}\u0000${this.attempt}\u0000${this.input}\u0000${this.counter}`,
        )
        .digest();
      this.counter += 1;
      this.position = 0;
    }
    return this.block[this.position++]!;
  }

  private uint32(): number {
    return (
      this.byte() * 0x1000000 +
      this.byte() * 0x10000 +
      this.byte() * 0x100 +
      this.byte()
    );
  }

  /** Uniform in [0, n), without modulo bias. */
  below(n: number): number {
    if (!Number.isInteger(n) || n <= 0)
      throw new Error("below(n) needs a positive integer");
    const limit = Math.floor(0x100000000 / n) * n;
    let value = this.uint32();
    while (value >= limit) value = this.uint32();
    return value % n;
  }

  digits(count: number): string {
    let out = "";
    for (let i = 0; i < count; i += 1) out += String(this.below(10));
    return out;
  }

  pick<T>(list: readonly T[]): T {
    return list[this.below(list.length)]!;
  }
}

const normalizeText = (value: string): string =>
  value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

const digitsOf = (value: string): string => value.replace(/\D/g, "");

/** Replaces the digits of `real`, in order, with `digits`; every other character stays where it is. */
function fillDigits(real: string, digits: string): string {
  let index = 0;
  return real.replace(/\d/g, () => digits[index++] ?? "0");
}

/** The sum of the digits weighted 9-7-3-1, the weights repeating from the first digit. */
function weightedSum9731(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    sum += Number(digits[i]) * WEIGHTS_9731[i % 4]!;
  }
  return sum;
}

/** The check digit that makes the weighted sum of `digits` plus itself a multiple of ten. */
export const check9731 = (digits: string): string =>
  String((10 - (weightedSum9731(digits) % 10)) % 10);

/** ISO 13616 mod-97 check digits for a country code and a BBAN (letters count as 10..35). */
export function ibanCheckDigits(country: string, bban: string): string {
  const moved = `${bban}${country}00`.toUpperCase();
  let remainder = 0;
  for (const char of moved) {
    const value = /[0-9]/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value)
      remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return String(98 - remainder).padStart(2, "0");
}

const daysSince1867 = (year: number, month: number, day: number): number =>
  Math.round((Date.UTC(year, month, day) - Date.UTC(1867, 0, 1)) / 86_400_000);

/** The check digit of the 10-digit personal tax id: sum of (position x digit) over the first nine, mod 11 (10 = unusable). */
const personalTaxIdCheck = (first9: string): number => {
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += (i + 1) * Number(first9[i]);
  return sum % 11;
};

export interface Pseudonymizer {
  email(real: string): string;
  familyName(real: string): string;
  givenName(real: string): string;
  /** A full name in Hungarian order (family name first); a leading title (Dr., ifj. ...) is kept. */
  personName(real: string): string;
  /** `attempt` re-draws after a collision. A value that is not a phone number is replaced character for character. */
  phone(real: string, attempt?: number): string;
  /** `attempt` re-draws after a collision (see `findCollisions`). */
  companyTaxNumber(real: string, attempt?: number): string;
  euTaxNumber(real: string, attempt?: number): string;
  personalTaxId(real: string, attempt?: number): string;
  iban(real: string): string;
  /** A Hungarian domestic account number: 16 or 24 digits, written with or without dashes. */
  bankAccountNumber(real: string): string;
  streetAddress(real: string): string;
  /** An IP address (v4 or v6) to a documentation-range address (RFC 5737 / RFC 3849): it can never be a real host. */
  ipAddress(real: string): string;
  /** A carrier parcel number: character class for character class, other characters kept. */
  parcelNumber(real: string): string;
}

/** A Hungarian BBAN (24 digits) to its fake: the bank code is kept, the branch and the account are drawn, the checks recomputed. */
function fakeHuBban(key: Buffer, real24: string): string {
  const stream = new Stream(key, "huBban", real24, 0);
  const head7 = real24.slice(0, 3) + stream.digits(4);
  const block1 = head7 + check9731(head7);
  if (/^0{8}$/.test(real24.slice(16))) {
    // two 8-digit blocks, each with its own check digit, and an all-zero third block
    const account7 = stream.digits(7);
    return block1 + account7 + check9731(account7) + "00000000";
  }
  // one 16-digit account number: fifteen digits and one check digit, weighted 9-7-3-1 across all sixteen
  const account15 = stream.digits(15);
  return block1 + account15 + check9731(account15);
}

export function createPseudonymizer(
  secret: string | Uint8Array,
): Pseudonymizer {
  const key = Buffer.from(secret);
  if (key.length < MIN_KEY_BYTES) {
    throw new Error(
      `the pseudonymization key must be at least ${MIN_KEY_BYTES} bytes`,
    );
  }
  const stream = (domain: string, input: string, attempt = 0) =>
    new Stream(key, domain, input, attempt);

  const replaceChar = (s: Stream, char: string): string => {
    if (/[0-9]/.test(char)) return String((Number(char) + 1 + s.below(9)) % 10);
    const upper = char !== char.toLowerCase();
    const base = upper ? 65 : 97;
    const code = char.charCodeAt(0);
    const index = code >= base && code < base + 26 ? code - base : -1;
    // an ASCII letter becomes a DIFFERENT letter of its case; an accented or other letter becomes any ASCII letter
    const next = index >= 0 ? (index + 1 + s.below(25)) % 26 : s.below(26);
    return String.fromCharCode(base + next);
  };

  /** Every digit and every letter replaced by a different one of its class; every other character stays. */
  const shape = (domain: string, real: string): string => {
    const s = stream(domain, real.trim().toUpperCase());
    return real.replace(/[0-9]|\p{L}/gu, (char) => replaceChar(s, char));
  };

  /** The letters of a parsed value replaced (a leading two-letter country prefix may be kept). */
  const lettersGone = (
    domain: string,
    real: string,
    value: string,
    keepPrefix = false,
  ): string => {
    if (!/\p{L}/u.test(value)) return value;
    const prefix = keepPrefix
      ? (/^\s*[A-Za-z]{2}(?=\s?\d)/.exec(value)?.[0] ?? "")
      : "";
    const s = stream(domain, real.trim().toUpperCase());
    return (
      prefix +
      value
        .slice(prefix.length)
        .replace(/\p{L}/gu, (char) => replaceChar(s, char))
    );
  };

  const companyCore = (core8: string, attempt: number): string => {
    const s = stream("huTaxCore", core8, attempt);
    const first7 = String(1 + s.below(9)) + s.digits(6);
    return first7 + check9731(first7);
  };

  const familyName = (real: string): string =>
    stream("familyName", normalizeText(real)).pick(FAMILY_NAMES);
  const givenName = (real: string): string =>
    stream("givenName", normalizeText(real)).pick(GIVEN_NAMES);

  const companyTaxNumber = (real: string, attempt = 0): string => {
    const digits = digitsOf(real);
    if (digits.length < 8) return shape("taxShort", real);
    return lettersGone(
      "taxLetters",
      real,
      fillDigits(
        real,
        companyCore(digits.slice(0, 8), attempt) + digits.slice(8),
      ),
      true,
    );
  };

  return {
    email(real) {
      const normalized = normalizeText(real);
      if (!normalized) return "";
      const s = stream("email", normalized);
      let local = "u";
      for (let i = 0; i < 12; i += 1) local += BASE32[s.below(32)];
      return `${local}@${FAKE_EMAIL_DOMAIN}`;
    },

    familyName,
    givenName,

    personName(real) {
      const tokens = real.normalize("NFC").trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return "";
      const titles: string[] = [];
      while (
        tokens.length > 1 &&
        /^(dr\.?|id\.|ifj\.|özv\.|prof\.)$/i.test(tokens[0]!)
      ) {
        titles.push(tokens.shift()!);
      }
      const family = familyName(tokens[0]!);
      const given =
        tokens.length > 1 ? givenName(tokens.slice(1).join(" ")) : "";
      return [...titles, family, given].filter(Boolean).join(" ");
    },

    phone(real, attempt = 0) {
      const digits = digitsOf(real);
      if (digits.length < 6) return shape("phoneShort", real);
      const startsPlus = real.trim().startsWith("+");
      let skip: number;
      let national: string;
      if (digits.startsWith("0036")) {
        skip = 4;
        national = digits.slice(4);
      } else if (startsPlus && digits.startsWith("36")) {
        skip = 2;
        national = digits.slice(2);
      } else if (digits.startsWith("06")) {
        skip = 2;
        national = digits.slice(2);
      } else if (startsPlus) {
        // another country code: keep two digits, replace the rest
        skip = 2;
        national = digits.slice(2);
      } else {
        skip = 0;
        national = digits;
      }
      const foreign = startsPlus && !digits.startsWith("36");
      let area = 0;
      if (!foreign) {
        if (/^(20|30|31|50|70)/.test(national)) area = 2;
        else if (national.startsWith("1")) area = 1;
        else area = 2;
      }
      let keep = skip + area;
      if (keep >= digits.length - 3) keep = Math.max(0, digits.length - 4);
      const subscriber = digits.length - keep;
      const fake = stream("phone", national, attempt).digits(subscriber);
      return lettersGone(
        "phoneLetters",
        real,
        fillDigits(real, digits.slice(0, keep) + fake),
      );
    },

    companyTaxNumber,

    euTaxNumber(real, attempt = 0) {
      const compact = real.replace(/\s+/g, "").toUpperCase();
      const country = compact.slice(0, 2);
      if (!/^[A-Z]{2}/.test(compact)) return shape("euVat", real);
      if (country === "HU") return companyTaxNumber(real, attempt);
      // the country prefix stays, the rest is substituted character class for character class
      const parts = /^(\s*[A-Za-z]{2})([\s\S]*)$/.exec(real);
      return parts
        ? parts[1]! + shape(`euVat:${country}`, parts[2]!)
        : shape("euVat", real);
    },

    personalTaxId(real, attempt = 0) {
      const digits = digitsOf(real);
      if (digits.length !== 10) return shape("taxId", real);
      const s = stream("huTaxId", digits, attempt);
      const from = daysSince1867(1940, 0, 1);
      const to = daysSince1867(2005, 11, 31);
      const days = from + s.below(to - from + 1);
      for (;;) {
        const first9 = `8${String(days).padStart(5, "0")}${String(s.below(1000)).padStart(3, "0")}`;
        const check = personalTaxIdCheck(first9);
        if (check < 10)
          return lettersGone(
            "taxIdLetters",
            real,
            fillDigits(real, first9 + String(check)),
          );
      }
    },

    iban(real) {
      const compact = real.replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(compact))
        return shape("iban", real);
      const country = compact.slice(0, 2);
      const bban = compact.slice(4);
      let fakeBban: string;
      if (country === "HU" && /^\d{24}$/.test(bban)) {
        fakeBban = fakeHuBban(key, bban);
      } else {
        const s = stream(`iban:${country}`, bban);
        fakeBban = [...bban]
          .map((char) =>
            /\d/.test(char)
              ? String(s.below(10))
              : String.fromCharCode(65 + s.below(26)),
          )
          .join("");
      }
      const fake = `${country}${ibanCheckDigits(country, fakeBban)}${fakeBban}`;
      return /\s/.test(real.trim())
        ? (fake.match(/.{1,4}/g) ?? [fake]).join(" ")
        : fake;
    },

    bankAccountNumber(real) {
      const digits = digitsOf(real);
      if (digits.length !== 16 && digits.length !== 24)
        return shape("bankAccount", real);
      const real24 = digits.length === 16 ? `${digits}00000000` : digits;
      const fake24 = fakeHuBban(key, real24);
      return lettersGone(
        "accountLetters",
        real,
        fillDigits(real, digits.length === 16 ? fake24.slice(0, 16) : fake24),
      );
    },

    streetAddress(real) {
      const normalized = normalizeText(real);
      if (!normalized) return "";
      const s = stream("street", normalized);
      return `${s.pick(STREET_NAMES)} ${s.pick(STREET_TYPES)} ${1 + s.below(150)}.`;
    },

    parcelNumber(real) {
      return shape("parcel", real);
    },

    ipAddress(real) {
      const value = real.trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
        const s = stream("ip4", value);
        return `${s.pick(["192.0.2", "198.51.100", "203.0.113"])}.${1 + s.below(254)}`;
      }
      const s = stream("ip6", value.toLowerCase());
      return `2001:db8::${(1 + s.below(65534)).toString(16)}:${(1 + s.below(65534)).toString(16)}`;
    },
  };
}

/**
 * The national digits of a phone number: the country prefix (0036, +36, 06) and every separator removed, so the two writings of
 * one number ("+36 30 123 4567", "06301234567") are ONE real value. Pass it to `findCollisions` for phone numbers; the default
 * normalizer would count the two writings as two values that share a fake, a false collision.
 */
export function normalizePhone(value: string): string {
  const digits = digitsOf(value);
  if (digits.startsWith("0036")) return digits.slice(4);
  if (value.trim().startsWith("+") && digits.startsWith("36"))
    return digits.slice(2);
  if (digits.startsWith("06")) return digits.slice(2);
  return digits;
}

/**
 * The groups of real values that share one fake (a collision), as INDEXES into `values`, never the values themselves: a real
 * value must not end up in a log or a report. Values that normalize to the same text are one value, not a collision.
 */
export function findCollisions(
  values: readonly string[],
  fake: (value: string) => string,
  normalize: (value: string) => string = normalizeText,
  /**
   * What two FAKES must share to collide. A fake keeps the real value's writing (a phone's "+36" or "06", its separators), so
   * two fakes of different writings can be the same number: pass `normalizePhone` here too for phone numbers.
   */
  normalizeFake: (fake: string) => string = (value) => value,
): { fake: string; indexes: number[] }[] {
  const firstByReal = new Map<string, number>();
  const byFake = new Map<string, { fake: string; indexes: number[] }>();
  values.forEach((value, index) => {
    const real = normalize(value);
    if (firstByReal.has(real)) return;
    firstByReal.set(real, index);
    const made = fake(value);
    const slot = normalizeFake(made);
    const group = byFake.get(slot) ?? { fake: made, indexes: [] };
    group.indexes.push(index);
    byFake.set(slot, group);
  });
  return [...byFake.values()].filter((group) => group.indexes.length > 1);
}

/**
 * WHICH ENGINE METHOD SERVES WHICH REGISTER KIND. Every `pseudonymize` kind of `anonymization-register.ts` must have a line
 * here (the test enforces it), so a new pseudonymized kind cannot be added without deciding how it is produced. `s2` is the
 * text and JSON scrubber of the next slice.
 */
export const PSEUDONYMIZED_KINDS = {
  email: "email",
  personName: "personName",
  phone: "phone",
  bankAccount: "iban | bankAccountNumber",
  streetAddress: "streetAddress",
  parcelNumber: "parcelNumber",
  partyName: "personName (natural-person rows)",
  partyTaxNumber: "companyTaxNumber | euTaxNumber | personalTaxId (by shape)",
  freeText: "s2",
  json: "s2",
} as const;
