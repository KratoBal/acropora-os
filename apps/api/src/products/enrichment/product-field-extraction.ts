import { aiChatConfig } from "../../integrations/ai-chat/ai-chat.config.js";
import { aiPost, type AiCallDeps } from "./ai-call.js";
import type { ExtractedValue } from "./page-extract.js";

/**
 * WHAT THE PRODUCT IS FOR AND WHO MAKES IT, THROUGH ACROPORA AI, CHECKED HERE AGAIN (T4.4 S1b, card 8639ac2a, task
 * t-20261114-jev-s1b-termekmezo-kivonat). The S1 gate of the water-treatment set needs `application` and
 * `manufacturerInfo`; the pilot-20 run did not even look at them, and the manufacturers' pages state neither in a form a
 * deterministic reader can take (a heading for the use on 4 of 15 pages, a maker block on 1; the maker stands on the
 * brand's imprint page, which the run reads as a manufacturer page of its own).
 *
 * The AI service (`POST /v1/product-field-extractions`, acropora-ai-agent) answers with values on verbatim anchors, and
 * refuses an anchor its page does not hold. This side does not trust that, as in `dosing-extraction.ts`: before a value
 * becomes a JEV candidate, the anchor is in THIS page's visible text (spacing aside), and every part of the value (the
 * use; the maker's name, address and e-mail) is in the anchor. Anything else gives no value, only a note on the fetch.
 */

export const AI_PRODUCT_FIELDS_PATH_ENV = "ACROPORA_AI_PRODUCT_FIELDS_PATH";

export const PRODUCT_FIELD_KEYS = ["application", "manufacturerInfo"] as const;
export type ProductFieldKey = (typeof PRODUCT_FIELD_KEYS)[number];

export type ProductFieldAnswerValue =
  | { field: "application"; value: string; anchor: string }
  | {
      field: "manufacturerInfo";
      /**
       * MAKER: the company that makes the products; RESPONSIBLE: the one the page names as responsible for them (acrobot
       * 52443: for a maker outside the EU the GPSR block needs both, so the candidate shows both, with their roles).
       */
      role: ManufacturerRole;
      name: string;
      address: string;
      email: string | null;
      anchor: string;
    };

export const MANUFACTURER_ROLES = ["MAKER", "RESPONSIBLE"] as const;
export type ManufacturerRole = (typeof MANUFACTURER_ROLES)[number];
const ROLE_LABEL: Record<ManufacturerRole, string> = {
  MAKER: "Gyártó",
  RESPONSIBLE: "Felelős",
};

export type ProductFieldAnswer =
  | {
      kind: "ANSWER";
      fields: ProductFieldAnswerValue[];
      /** The AI service's own refusals, field by field: a short code and a count detail, never page text. */
      refused: string[];
    }
  /** The AI service's guard refused the whole answer. */
  | { kind: "REFUSED"; refusal: string }
  | { kind: "UNAVAILABLE"; reason: string };

export interface ProductFieldExtractor {
  extract(input: {
    productName: string;
    pageText: string;
    fields: ProductFieldKey[];
  }): Promise<ProductFieldAnswer>;
}

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const CODE = /^[A-Z_]{2,48}$/;
const DETAIL =
  /^(?:anchor|value|name|address|email) \d{1,4}\/\d{1,4} (?:U\+[0-9A-F]{4,6}|-)$/;

/** The answer's body as the AI service sends it; anything else is UNAVAILABLE. Only known shapes are taken. */
export function productFieldAnswerOf(body: unknown): ProductFieldAnswer {
  if (typeof body !== "object" || body === null)
    return { kind: "UNAVAILABLE", reason: "no JSON body" };
  const b = body as Record<string, unknown>;
  if (typeof b.refusal === "string")
    return { kind: "REFUSED", refusal: b.refusal.slice(0, 64) };
  if (!Array.isArray(b.fields))
    return { kind: "UNAVAILABLE", reason: "no fields" };
  const fields: ProductFieldAnswerValue[] = [];
  for (const raw of b.fields as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const f = raw as Record<string, unknown>;
    const anchor = str(f.anchor);
    if (anchor === null) continue;
    if (f.field === "application") {
      const value = str(f.value);
      if (value !== null) fields.push({ field: "application", value, anchor });
    } else if (f.field === "manufacturerInfo") {
      const name = str(f.name);
      const address = str(f.address);
      const role = (MANUFACTURER_ROLES as readonly unknown[]).includes(f.role)
        ? (f.role as ManufacturerRole)
        : null;
      if (name !== null && address !== null && role !== null)
        fields.push({
          field: "manufacturerInfo",
          role,
          name,
          address,
          email: str(f.email),
          anchor,
        });
    }
  }
  const refused = Array.isArray(b.refusedFields)
    ? (b.refusedFields as unknown[]).flatMap((raw) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        if (
          !(PRODUCT_FIELD_KEYS as readonly unknown[]).includes(r.field) ||
          typeof r.refusal !== "string" ||
          !CODE.test(r.refusal)
        )
          return [];
        const detail =
          typeof r.detail === "string" && DETAIL.test(r.detail)
            ? ` ${r.detail}`
            : "";
        return [`${String(r.field)} ${r.refusal}${detail}`];
      })
    : [];
  return { kind: "ANSWER", fields, refused };
}

/** The AI service over HTTP, as the dosing extractor: the token is held by this process only, never written out. */
export class HttpProductFieldExtractor implements ProductFieldExtractor {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly path: string,
    private readonly deps: AiCallDeps = {},
  ) {}

  async extract(input: {
    productName: string;
    pageText: string;
    fields: ProductFieldKey[];
  }): Promise<ProductFieldAnswer> {
    const result = await aiPost(
      `${this.baseUrl}/${this.path.replace(/^\/+/, "")}`,
      this.token,
      input,
      this.deps,
    );
    if (!result.ok) return { kind: "UNAVAILABLE", reason: result.reason };
    return productFieldAnswerOf(result.body);
  }
}

/** The extractor from the environment, or `null`: no path, no AI config, no call. */
export function productFieldExtractorFromEnv(
  environment: NodeJS.ProcessEnv,
): ProductFieldExtractor | null {
  const path = environment[AI_PRODUCT_FIELDS_PATH_ENV]?.trim();
  const config = aiChatConfig(environment);
  return path && config
    ? new HttpProductFieldExtractor(config.baseUrl, config.token, path)
    : null;
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

/** The longest a value is stored as a candidate; the AI service caps the anchor at 400. */
const MAX_VALUE = 400;

/**
 * THE MAKER'S ADDRESS, AT LEAST ITS SHAPE (barracuda on acropora-ai-agent #88): the value check is a substring check, so a
 * cut address ("Példa utca 1") passes it, and the GPSR block needs a full postal address. A postcode-like number (3 to 6
 * digits, "CH-6331" and "91367" alike) and a place name (letters) must both stand in it. A UK postcode has no such number:
 * none of today's brands writes one; when one does, this note names it.
 */
const POSTCODE = /(?<![\p{L}\d])\d{3,6}(?!\d)/u;
/**
 * A copyright line is not an address (pilot-20, third run, 2026-11-14: "Felelős: Red Sea, © 2026 Red Sea. All rights
 * reserved" passed, the year looked like a postcode; barracuda had named the weakness on #2559).
 */
const COPYRIGHT =
  /©|\(c\)|copyright|all rights reserved|alle rechte|minden jog/iu;
/**
 * The address without the company name in front of it, when the page writes them together and the model copied both
 * (pilot-20, third run: "Korallenzucht.de Vertriebs GmbH, Korallenzucht.de Vertriebs GmbH Schlesierstr. 1 ...").
 */
function withoutName(address: string, name: string): string {
  const a = squash(address);
  const n = squash(name);
  return a.toLowerCase().startsWith(n.toLowerCase())
    ? a.slice(n.length).replace(/^[\s,;:-]+/, "") || a
    : a;
}
const PLACE = /\p{L}{3,}/u;

/**
 * A COMPANY NAME WITH ITS LEGAL FORM, to count how many the page names (barracuda on #88: the Tropic Marin imprint names
 * Tropic Marin AG as responsible and Dr. Biener GmbH as the producer; which one the GPSR block needs is a legal question,
 * not the model's). Counted only; the names stay on the page.
 */
const COMPANY =
  /(\p{Lu}[\p{L}\d&.'-]*(?:\s+[\p{L}\d&.'-]+){0,4})\s+(GmbH|AG|KG|Ltd\.?|LLC|Inc\.?|S\.r\.l\.|SRL|S\.p\.A\.|B\.V\.|Sp\. z o\.o\.|Kft\.?|Zrt\.?|SAS|SA|AB|Oy)(?![\p{L}])/gu;
function companiesOn(page: string): number {
  return new Set(
    [...page.matchAll(COMPANY)].map((m) => `${m[1]} ${m[2]}`.toLowerCase()),
  ).size;
}

export interface ProductFieldStatement {
  values: ExtractedValue[];
  /** Why no value, one line per reason; shown with the fetch. */
  notes: string[];
}

/**
 * The AI's answer, checked against this page's visible text, as the run's candidates. `manufacturerInfo` is stored as
 * one text with the roles, "Gyártó: name, address, e-mail; Felelős: name, address", the parts as the page writes them.
 * It is never accepted without a person (`AUTO_ACCEPT_FIELDS` does not hold it; a spec keeps it so).
 */
export function productFieldStatement(
  answer: ProductFieldAnswer,
  pageText: string,
): ProductFieldStatement {
  if (answer.kind === "UNAVAILABLE")
    return {
      values: [],
      notes: [`termékmezők (AI): nem elérhető (${answer.reason})`],
    };
  if (answer.kind === "REFUSED")
    return {
      values: [],
      notes: [`termékmezők (AI): az AI őre elutasította (${answer.refusal})`],
    };
  const page = squash(pageText);
  const values: ExtractedValue[] = [];
  const notes = answer.refused.map(
    (r) => `termékmezők (AI): az AI őre elutasította (${r})`,
  );
  // every part on its anchor, every anchor on this page
  const onPage = (anchor: string, parts: string[]) => {
    const a = squash(anchor);
    if (!page.includes(a)) return "a horgony nincs a lapon";
    if (!parts.every((p) => a.includes(squash(p))))
      return "az érték nincs a horgonyban";
    return null;
  };
  const excerpt = (anchors: string[]) =>
    `AI-horgony = ${JSON.stringify(anchors.map(squash).join(" | ").slice(0, 200))}`;

  // what it is for: one answer per page; a second is not a choice for this side to make
  const uses = answer.fields.filter((f) => f.field === "application");
  if (uses.length > 1)
    notes.push("termékmezők (AI): application kétszer, egyik sem");
  else if (uses.length === 1) {
    const use = uses[0]!;
    const problem = onPage(use.anchor, [use.value]);
    const raw = squash(use.value);
    if (problem) notes.push(`termékmezők (AI): application: ${problem}`);
    else if (raw.length > MAX_VALUE)
      notes.push("termékmezők (AI): application: túl hosszú");
    else
      values.push({
        field: "application",
        raw,
        excerpt: excerpt([use.anchor]),
      });
  }

  // who makes it: at most one company per role, all of them sound, or no value (half a GPSR block misleads)
  const makers = answer.fields.filter(
    (f): f is Extract<ProductFieldAnswerValue, { field: "manufacturerInfo" }> =>
      f.field === "manufacturerInfo",
  );
  if (makers.length > 0) {
    const roles = makers.map((m) => m.role);
    const problems: string[] = [];
    if (new Set(roles).size !== roles.length)
      problems.push("egy szerephez két cég");
    // the AI service refused one of the companies: the others alone would be half a GPSR block
    if (answer.refused.some((r) => r.startsWith("manufacturerInfo ")))
      problems.push("az AI egy céget elutasított, a többi egyedül nem érték");
    for (const m of makers) {
      const parts = [m.name, m.address, ...(m.email === null ? [] : [m.email])];
      const problem = onPage(m.anchor, parts);
      if (problem) problems.push(`${ROLE_LABEL[m.role]}: ${problem}`);
      else if (COPYRIGHT.test(m.address))
        problems.push(`${ROLE_LABEL[m.role]}: a cím egy copyright-sor`);
      // the shape on the address without the company name: a number in the name ("Aqua 2000 GmbH") is no postcode
      // (barracuda on #2560)
      else if (!(
        POSTCODE.test(withoutName(m.address, m.name)) &&
        PLACE.test(withoutName(m.address, m.name))
      ))
        problems.push(
          `${ROLE_LABEL[m.role]}: a címben nincs irányítószám és település`,
        );
    }
    const ordered = MANUFACTURER_ROLES.flatMap((role) =>
      makers.filter((m) => m.role === role),
    );
    const raw = ordered
      .map(
        (m) =>
          `${ROLE_LABEL[m.role]}: ${[m.name, withoutName(m.address, m.name), ...(m.email === null ? [] : [m.email])].map(squash).join(", ")}`,
      )
      .join("; ");
    if (problems.length === 0 && raw.length > MAX_VALUE)
      problems.push("túl hosszú");
    if (problems.length > 0)
      notes.push(`termékmezők (AI): manufacturerInfo: ${problems.join("; ")}`);
    else {
      values.push({
        field: "manufacturerInfo",
        raw,
        excerpt: excerpt(ordered.map((m) => m.anchor)),
      });
      // more companies on the page than the answer names: a person looks (the GPSR block may need another one)
      const companies = companiesOn(pageText);
      if (companies > makers.length)
        notes.push(
          `termékmezők (AI): manufacturerInfo: a lapon ${companies} cég áll, a válasz ${makers.length}-t nevez`,
        );
    }
  }
  return { values, notes };
}
