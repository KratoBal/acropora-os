import { randomBytes, randomUUID } from "node:crypto";

import {
  ANONYMIZATION_KINDS,
  type AnonymizationKind,
} from "../anonymization-register.js";
import type { FieldDecision } from "../anonymization-register-check.js";
import type { Pseudonymizer } from "./pseudonymizer.js";
import { foldText, type TextScrubber } from "./text-scrubber.js";

/**
 * THE REGISTER-DRIVEN ROW TRANSFORMER (stage anonymization chain, slice S3; card 07b56a1f; plan 2026-10-12 sections 3.1 point 4 and
 * 3.2). PURE: one row object and the register's decisions in, the anonymized row out. No database, no file, no clock (the one
 * source of randomness is injectable). The caller reads rows, calls `transformRow`, writes the result (S5).
 *
 * WHAT DECIDES A VALUE: the DECISION of its field (`checkRegister(...).decisions`, which already folds in the structural rules: a
 * generated id is kept, a foreign key inherits its target's decision), and the register kind's ACTION:
 *   keep          the value as it is;
 *   pseudonymize  the S1 engine / S2 scrubbers (by kind: e-mail, name, phone, bank account, street, parcel number, free text, JSON);
 *   replace       a value that does not depend on the original (the stage-only password hash, a fresh token, a neutral file or
 *                 message placeholder);
 *   delete        NULL, or, for a field that MUST hold a value, the whole ROW is dropped (the register's own wording; a session or a
 *                 device token without its token is nothing).
 * A kind with a `naturalPersonRows` action uses it for a NATURAL PERSON's row (a private person or a sole trader); the other
 * rows use the kind's own action. THE ROW IS A NATURAL PERSON unless the evidence says it is a company (`classifyRow`): a
 * sole-trader marker in a name ("e.v."), a personal tax id, or a PERSON type each decide it; only a COMPANY type, an
 * organisation marker in a name (Kft., Zrt. ...) or a company-shaped tax number say company; no evidence at all is a natural
 * person, because the plan says an uncertain case is pseudonymized (the cost of a wrong guess is a fake name, not a leak).
 *
 * TWO LOCKS ON AN UNDECIDED FIELD, independent of each other: the register check (CI) requires a decision for every text, JSON and
 * bytes column, and the transformer itself lets a field without a decision pass ONLY if its schema type is a number, a boolean, a
 * date or an enum (`outOfScopeFields`), whatever the value looks like. If the CI step ever lapses, a new text column stops the run.
 * FAIL CLOSED: a row field with no decision that is not a known schema field (a typo, a stale column) is an error, and so is a
 * value of a type its kind cannot handle; the message names the field and the type, never the value. A schema field of a type
 * the register does not cover (a date, a number, an enum) passes unchanged (the register's scope is by type; see its header).
 *
 * WHAT THIS DOES NOT DO (named, so nobody assumes it): it does not keep a UNIQUE column unique (two rows whose fakes collide, or
 * a pseudonymized `@unique` column whose fakes collide); the runner (S5) uses `findCollisions` and the engine's `attempt`
 * re-draw. A replaced `@unique` password hash does NOT get one shared value: it gets a fresh token (`uniqueFields`). It does not touch other rows (a dropped
 * row's dependents) and it never reads a database.
 */

export interface RowTransformerOptions {
  /** `checkRegister(schema, ANONYMIZATION_REGISTER).decisions`. */
  decisions: ReadonlyMap<string, FieldDecision>;
  /** `requiredFieldKeys(schema)`: the fields that cannot be NULL. */
  requiredFields: ReadonlySet<string>;
  /** `schemaFieldKeys(schema)`: every field of the schema, of any type. */
  knownFields: ReadonlySet<string>;
  /**
   * `outOfScopeFieldKeys(schema)`: the fields whose schema type is a number, a boolean, a date or an enum. THE SECOND LOCK: a field
   * with no decision passes only if it is in this set; a text, JSON or bytes field with no decision is an error even if the
   * register check would never have let it be undecided. Required, so the lock cannot be left out by omission.
   */
  outOfScopeFields: ReadonlySet<string>;
  /**
   * `uniqueFieldKeys(schema)`: the fields with their own `@unique`. A password hash in such a field (a confirmation token's hash)
   * must not become ONE stage-only value for every row, so it gets a fresh token like the other replaced tokens.
   */
  uniqueFields?: ReadonlySet<string>;
  engine: Pseudonymizer;
  text: TextScrubber;
  json: { scrubJson(value: unknown): unknown };
  /** The hash of the stage-only password; needed only when a `passwordHash` field is met. */
  stagePasswordHash?: string;
  /** A fresh token like the original (the default draws random bytes). Injectable, so a test can fix it. */
  randomToken?: (original: string) => string;
  /** The register's kinds (the default is the real table); a test passes a changed one. */
  kinds?: Readonly<Record<string, AnonymizationKind>>;
}

export type RowResult =
  | { dropped: false; row: Record<string, unknown> }
  | { dropped: true; field: string; reason: string };

export interface RowTransformer {
  transformRow(
    model: string,
    row: Readonly<Record<string, unknown>>,
  ): RowResult;
  /** Counts of changed values by kind, and of dropped rows. Counts only. */
  readonly stats: Readonly<Record<string, number>>;
}

const PLACEHOLDER_TEXT =
  "A fájl tartalma a stage-en nem érhető el (anonimizált másolat).";
const PLACEHOLDER_BYTES = Buffer.from(PLACEHOLDER_TEXT, "utf8");
const PLACEHOLDER_MESSAGE =
  "[A levél eredeti szövege a stage-en nem érhető el.]";

const TYPE_KEYS = new Set([
  "type",
  "customertype",
  "buyercustomertype",
  "partytype",
  "partnertype",
]);

const normalizeKey = (key: string): string =>
  foldText(key).replace(/[^a-z0-9]/g, "");
const digitsOf = (value: string): string => value.replace(/\D/g, "");

const isPersonalTaxId = (value: string): boolean =>
  /^8\d{9}$/.test(digitsOf(value)) && digitsOf(value).length === 10;
const isCompanyTaxShape = (value: string): boolean =>
  /^\d{11}$/.test(digitsOf(value)) ||
  /^[A-Za-z]{2}\d{6,}/.test(value.replace(/\s+/g, ""));
const isSoleTrader = (name: string): boolean =>
  /(^|[\s,(])e\.?\s?v\.?(?=$|[\s,)])|egyeni vallalkozo/.test(foldText(name));
const hasOrganizationMarker = (name: string): boolean =>
  /(^|[\s,(])(kft|zrt|nyrt|bt|kkt|rt|kht|gmbh|ltd|llc|inc|srl|s r o|sp z o o|ag|kg|egyesulet|alapitvany|szovetkezet|kozhasznu)($|[\s,.)])/.test(
    foldText(name).replace(/\./g, " ").replace(/\s+/g, " "),
  );

/** Whether a row describes a natural person (see the header); `true` when the evidence does not say company. */
export function classifyRow(
  typeValue: string | null,
  names: readonly string[],
  taxNumbers: readonly string[],
): boolean {
  if (names.some(isSoleTrader)) return true;
  if (taxNumbers.some(isPersonalTaxId)) return true;
  const type = typeValue === null ? null : foldText(typeValue);
  if (type === "person") return true;
  if (type === "company") return false;
  if (names.some(hasOrganizationMarker)) return false;
  if (taxNumbers.some(isCompanyTaxShape)) return false;
  return true;
}

/**
 * Whether a row of `model` describes a natural person, from its party fields and type field (see the header); the same
 * decision `transformRow` makes. The runner (S5) uses it to build the residual dictionary from natural persons only.
 */
export function isNaturalPersonRow(
  model: string,
  row: Readonly<Record<string, unknown>>,
  decisions: ReadonlyMap<string, FieldDecision>,
): boolean {
  let typeValue: string | null = null;
  const names: string[] = [];
  const taxNumbers: string[] = [];
  for (const [field, value] of Object.entries(row)) {
    if (typeof value !== "string" || value === "") continue;
    const kind = decisions.get(`${model}.${field}`)?.kind;
    if (kind === "partyName") names.push(value);
    else if (kind === "partyTaxNumber") taxNumbers.push(value);
    else if (TYPE_KEYS.has(normalizeKey(field))) typeValue = value;
  }
  return classifyRow(typeValue, names, taxNumbers);
}

/** The kinds this transformer pseudonymizes, and replaces: every kind with that action must be named (the test enforces it). */
export const PSEUDONYMIZED_KIND_NAMES = [
  "email",
  "personName",
  "phone",
  "bankAccount",
  "streetAddress",
  "parcelNumber",
  "freeText",
  "json",
  "partyName",
  "partyTaxNumber",
] as const;
export const REPLACED_KIND_NAMES = [
  "passwordHash",
  "opaqueToken",
  "fileContent",
  "rawMessage",
] as const;

const describeType = (value: unknown): string =>
  Buffer.isBuffer(value)
    ? "Buffer"
    : Array.isArray(value)
      ? "array"
      : value instanceof Date
        ? "Date"
        : typeof value;

export function createRowTransformer(
  options: RowTransformerOptions,
): RowTransformer {
  const {
    decisions,
    requiredFields,
    knownFields,
    outOfScopeFields,
    engine,
    text,
    json,
  } = options;
  const kinds: Readonly<Record<string, AnonymizationKind>> =
    options.kinds ?? ANONYMIZATION_KINDS;
  const stats: Record<string, number> = {};
  const count = (name: string) => {
    stats[name] = (stats[name] ?? 0) + 1;
  };

  const taxByShape = (value: string): string => {
    const compact = value.replace(/[\s-]/g, "");
    if (/^8\d{9}$/.test(compact)) return engine.personalTaxId(value);
    if (/^[A-Za-z]{2}/.test(compact)) return engine.euTaxNumber(value);
    return engine.companyTaxNumber(value);
  };

  /** A company's fake name (used only when the owner decides company data is pseudonymized too). */
  const companyName = (value: string): string =>
    `${engine.familyName(value)} ${engine.givenName(value)} Kft.`;

  const pseudonymizers: Record<
    string,
    (value: string, natural: boolean) => string
  > = {
    email: (v) => engine.email(v),
    personName: (v) => engine.personName(v),
    phone: (v) => engine.phone(v),
    bankAccount: (v) =>
      /^[A-Za-z]{2}\d{2}/.test(v.replace(/\s+/g, ""))
        ? engine.iban(v)
        : engine.bankAccountNumber(v),
    streetAddress: (v) => engine.streetAddress(v),
    parcelNumber: (v) => engine.parcelNumber(v),
    freeText: (v) => text.scrubText(v),
    partyName: (v, natural) =>
      natural ? engine.personName(v) : companyName(v),
    partyTaxNumber: (v) => taxByShape(v),
  };

  const token = (original: string): string => {
    if (options.randomToken) return options.randomToken(original);
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        original,
      )
    )
      return randomUUID();
    const fresh = randomBytes(Math.max(8, original.length)).toString(
      "base64url",
    );
    return fresh.slice(0, Math.max(8, original.length));
  };

  const replace = (kindName: string, key: string, value: unknown): unknown => {
    switch (kindName) {
      case "passwordHash":
        if (options.uniqueFields?.has(key) && typeof value === "string")
          return token(value);
        if (options.stagePasswordHash === undefined) {
          throw new Error(
            `${key}: a password hash field needs the stage-only password hash (stagePasswordHash)`,
          );
        }
        return options.stagePasswordHash;
      case "opaqueToken":
        if (typeof value !== "string")
          throw new Error(
            `${key}: a token must be a string, got ${describeType(value)}`,
          );
        return token(value);
      case "fileContent":
        if (typeof value === "string") return PLACEHOLDER_TEXT;
        if (Buffer.isBuffer(value) || value instanceof Uint8Array)
          return Buffer.from(PLACEHOLDER_BYTES);
        throw new Error(
          `${key}: file content must be a string or bytes, got ${describeType(value)}`,
        );
      case "rawMessage":
        if (typeof value !== "string")
          throw new Error(
            `${key}: a message body must be a string, got ${describeType(value)}`,
          );
        return PLACEHOLDER_MESSAGE;
      default:
        throw new Error(
          `${key}: kind "${kindName}" has the replace action but no replacement`,
        );
    }
  };

  const pseudonymize = (
    kindName: string,
    key: string,
    value: unknown,
    natural: boolean,
  ): unknown => {
    if (kindName === "json") return json.scrubJson(value);
    const handler = pseudonymizers[kindName];
    if (!handler)
      throw new Error(
        `${key}: kind "${kindName}" has the pseudonymize action but no handler`,
      );
    if (typeof value === "string")
      return value === "" ? value : handler(value, natural);
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      return (value as string[]).map((item) =>
        item === "" ? item : handler(item, natural),
      );
    }
    throw new Error(
      `${key}: a "${kindName}" value must be text, got ${describeType(value)}`,
    );
  };

  return {
    transformRow(model, row) {
      const out: Record<string, unknown> = {};
      let natural: boolean | undefined;
      const isNatural = (): boolean => {
        natural ??= isNaturalPersonRow(model, row, decisions);
        return natural;
      };

      for (const [field, value] of Object.entries(row)) {
        const key = `${model}.${field}`;
        const decision = decisions.get(key);
        if (!decision) {
          if (!knownFields.has(key)) {
            throw new Error(
              `${key}: not a field of the schema (a typo, or a column the register has not seen)`,
            );
          }
          if (!outOfScopeFields.has(key)) {
            throw new Error(
              `${key}: a ${describeType(value)} value in a text, JSON or bytes field that has no anonymization decision`,
            );
          }
          out[field] = value; // a type the register does not cover: a date, a number, a boolean, an enum
          continue;
        }
        if (value === null || value === undefined) {
          out[field] = value;
          continue;
        }
        const kind = kinds[decision.kind];
        if (!kind)
          throw new Error(
            `${key}: the decision names kind "${decision.kind}", which does not exist`,
          );
        const action =
          kind.naturalPersonRows !== undefined && isNatural()
            ? kind.naturalPersonRows
            : kind.action;

        if (action === "keep") {
          out[field] = value;
        } else if (action === "delete") {
          if (requiredFields.has(key)) {
            count("droppedRow");
            return {
              dropped: true,
              field: key,
              reason: `${key} is deleted and cannot be NULL: the row goes`,
            };
          }
          out[field] = Array.isArray(value) ? [] : null;
          count(decision.kind);
        } else if (action === "replace") {
          out[field] = replace(decision.kind, key, value);
          count(decision.kind);
        } else {
          out[field] = pseudonymize(decision.kind, key, value, isNatural());
          count(decision.kind);
        }
      }
      return { dropped: false, row: out };
    },
    get stats() {
      return { ...stats };
    },
  };
}
