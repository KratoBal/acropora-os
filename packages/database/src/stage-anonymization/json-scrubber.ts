import { foldText, type TextScrubber } from "./text-scrubber.js";
import type { Pseudonymizer } from "./pseudonymizer.js";

/**
 * THE JSON SCRUBBER (stage anonymization chain, slice S2; card 07b56a1f; plan 2026-10-12 section 3.2, the "JSON" row): a
 * recursive walk with key-name rules. PURE: a JSON value in, a new JSON value out (the input is never changed).
 *
 * TWO LAYERS, because a key name says what a value IS and a pattern says what it LOOKS like:
 *   1. KEY RULES decide the structured values a pattern cannot see: a bare name ("Teszt Elek"), a street, a tax number, a phone
 *      without a prefix. The rules are in `DEFAULT_JSON_RULES`, in order, first match wins. A NAME is only a person's name under
 *      a person-like ancestor key (buyer, customer, contact, recipient, signer ...): a `name` under an invoice line is a product
 *      name and stays. A name of a COMPANY stays too (the owner's decision on company data is open and the register keeps
 *      them), unless `companyNames: "pseudonymize"` is given: the row is recognised by a sibling `type`, `customerType`,
 *      `buyerCustomerType` or `partyType` that says COMPANY.
 *   2. EVERY OTHER STRING goes through the text scrubber (patterns and the name dictionary), whatever its key: an e-mail or a
 *      known name inside any string is replaced. Numbers, booleans and null are business data and stay.
 * Keys that carry credentials or network addresses are DELETED from the object (password, token, secret, apiKey, authorization,
 * ip), as the register's `secret` and `ipAddress` kinds say.
 *
 * WHAT THE DEFAULTS DO NOT KNOW: a key named in none of the rules, holding a bare personal value that no pattern can see (a name
 * under an unusual key), survives. S3 binds the rules per register field and may add rules (`extraRules`); S4's residual check
 * is the net under both.
 */

export interface JsonRuleContext {
  /** The normalized keys from the root to this key (excluding it). */
  ancestors: readonly string[];
  /** The object holding the key, to read a sibling (the customer type). */
  parent: Readonly<Record<string, unknown>>;
}

export interface JsonKeyRule {
  /** The normalized key (lower case, accents and punctuation removed). */
  test(key: string, context: JsonRuleContext): boolean;
  /** The new value, or `undefined` to delete the key. */
  apply(value: string, context: JsonRuleContext): string | undefined;
}

export interface JsonScrubOptions {
  /** `keep` (default): a company's name stays, as the register's open decision keeps it. */
  companyNames?: "keep" | "pseudonymize";
  /** Rules tried BEFORE the defaults. */
  extraRules?: readonly JsonKeyRule[];
}

const normalizeKey = (key: string): string =>
  foldText(key).replace(/[^a-z0-9]/g, "");

const PERSON_CONTEXT =
  /(buyer|customer|contact|recipient|signer|reporter|accepter|accepted|issuer|person|owner|user|vevo|ugyfel|partner|supplier|party|author|assignee|bejelento|alairo)/;

const COMPANY_TYPES = new Set([
  "company",
  "organization",
  "organisation",
  "business",
  "legal",
]);
const TYPE_KEYS = [
  "type",
  "customertype",
  "buyercustomertype",
  "partytype",
  "partnertype",
];

const isCompanyRow = (parent: Readonly<Record<string, unknown>>): boolean =>
  Object.entries(parent).some(
    ([key, value]) =>
      TYPE_KEYS.includes(normalizeKey(key)) &&
      typeof value === "string" &&
      COMPANY_TYPES.has(foldText(value)),
  );

/**
 * CREDENTIAL AND NETWORK KEYS ARE DELETED BY A PART OF THE NAME, NOT BY AN EXACT NAME (barracuda, #2322). The keys of real JSON are
 * varied (resetToken, sessionToken, clientSecret, x-api-key, setCookie, privateKey, refresh_token_hash, x-forwarded-for ...); the
 * key is normalized (case, accents, hyphens and underscores gone) and deleted when it CONTAINS one of these parts. A live token or
 * secret that reaches the stage is usable against production, and the stage is open to more people than production is, so the
 * rule errs on the side of deleting: an innocent "tokenCount" goes too, a leaked key does not stay.
 */
export const CREDENTIAL_KEY =
  /(password|passwd|passphrase|token|secret|apikey|authorization|cookie|signature|privatekey|credential|bearer|jwt)/;
export const NETWORK_KEY =
  /(^ip$|ipaddr|clientip|remoteaddr|forwardedfor|realip|ipv4|ipv6)/;

/** Whether a NORMALIZED key (see `normalizeKey`) names a credential or a network address. */
export const isDeletedKey = (normalizedKey: string): boolean =>
  CREDENTIAL_KEY.test(normalizedKey) || NETWORK_KEY.test(normalizedKey);

export function createJsonScrubber(
  engine: Pseudonymizer,
  text: TextScrubber,
  options: JsonScrubOptions = {},
): { scrubJson(value: unknown): unknown } {
  const companyNames = options.companyNames ?? "keep";

  const taxByShape = (value: string): string => {
    const compact = value.replace(/[\s-]/g, "");
    if (/^8\d{9}$/.test(compact)) return engine.personalTaxId(value);
    if (/^[A-Za-z]{2}/.test(compact)) return engine.euTaxNumber(value);
    return engine.companyTaxNumber(value);
  };

  const addressString = (value: string): string => {
    const parts = /^(\d{4})\s+([^,]+),\s*(.+)$/.exec(value.trim());
    return parts
      ? `${parts[1]} ${parts[2]}, ${engine.streetAddress(parts[3]!)}`
      : engine.streetAddress(value);
  };

  const rules: JsonKeyRule[] = [
    ...(options.extraRules ?? []),
    {
      test: (k) => /(^email$|email$|^emailaddress$|emailaddr)/.test(k),
      apply: (v) => engine.email(v),
    },
    {
      test: (k) =>
        /^(phone|tel|telefon|mobile|mobil|telefonszam|phonenumber|mobilephone|mobilszam)$/.test(
          k,
        ),
      apply: (v) => engine.phone(v),
    },
    {
      test: (k) =>
        /(iban|bankaccount|accountnumber|szamlaszam|bankszamla)/.test(k),
      apply: (v) =>
        /^[A-Za-z]{2}\d{2}/.test(v.replace(/\s+/g, ""))
          ? engine.iban(v)
          : engine.bankAccountNumber(v),
    },
    {
      test: (k) =>
        /(taxnumber|vatnumber|adoszam|euvat|taxid|vatid|adoazonosito)/.test(k),
      apply: taxByShape,
    },
    {
      test: (k) =>
        /(parcelnumber|trackingnumber|packagenumber|csomagszam|clfoxid|parcelid)/.test(
          k,
        ),
      apply: (v) => engine.parcelNumber(v),
    },
    {
      test: (k) => /^(firstname|keresztnev|givenname)$/.test(k),
      apply: (v) => engine.givenName(v),
    },
    {
      test: (k) =>
        /^(lastname|surname|csaladnev|vezeteknev|familyname)$/.test(k),
      apply: (v) => engine.familyName(v),
    },
    {
      test: (k) =>
        /^(street|streetaddress|addressline|addressline1|utca|utcahazszam)$/.test(
          k,
        ),
      apply: (v) => engine.streetAddress(v),
    },
    {
      test: (k) => /^(address|cim|lakcim|szallitasicim|szamlazasicim)$/.test(k),
      apply: addressString,
    },
    {
      test: (k) =>
        /(contactname|contactperson|signername|buyername|customername|recipientname|reportername|acceptername|issuername|username|kapcsolattarto)/.test(
          k,
        ),
      apply: (v, c) =>
        isCompanyRow(c.parent) && companyNames === "keep"
          ? v
          : engine.personName(v),
    },
    {
      test: (k, c) =>
        /^(name|fullname|displayname|nev)$/.test(k) &&
        c.ancestors.some((a) => PERSON_CONTEXT.test(a)),
      apply: (v, c) =>
        isCompanyRow(c.parent) && companyNames === "keep"
          ? v
          : engine.personName(v),
    },
  ];

  const walk = (
    value: unknown,
    ancestors: readonly string[],
    parent: Readonly<Record<string, unknown>> | null,
  ): unknown => {
    if (typeof value === "string") return text.scrubText(value);
    if (Array.isArray(value))
      return value.map((item) => walk(item, ancestors, parent));
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [rawKey, child] of Object.entries(object)) {
        const key = normalizeKey(rawKey);
        if (isDeletedKey(key)) continue;
        if (typeof child === "string" && child !== "") {
          const context: JsonRuleContext = { ancestors, parent: object };
          const rule = rules.find((r) => r.test(key, context));
          if (rule) {
            const made = rule.apply(child, context);
            if (made !== undefined) out[rawKey] = made;
            continue;
          }
        }
        out[rawKey] = walk(child, [...ancestors, key], object);
      }
      return out;
    }
    return value;
  };

  return { scrubJson: (value) => walk(value, [], null) };
}
