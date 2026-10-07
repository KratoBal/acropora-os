import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  validateQuoteRichText,
  type QuoteBlockKindValue,
  type QuoteMilestoneInput,
  type QuoteRichText,
} from "@acropora/types";

/**
 * THE EDITOR'S INPUT RULES (#1582 P1), in one place. The DTO classes check the
 * shape; these check the meaning (a decimal within the column, a text within
 * the subset, milestones that add up) and answer in Hungarian.
 */

const DECIMAL = /^-?\d+([.,]\d+)?$/;

/** A decimal string within a `Decimal(precision, scale)` column. */
export function decimalInput(
  value: string | null | undefined,
  field: string,
  rule: {
    scale: number;
    integerDigits: number;
    min: number;
    minExclusive?: boolean;
    max?: number;
  },
): Prisma.Decimal {
  if (typeof value !== "string" || !DECIMAL.test(value.trim()))
    throw new BadRequestException(`${field}: érvénytelen szám.`);
  const d = new Prisma.Decimal(value.trim().replace(",", "."));
  if (d.decimalPlaces() > rule.scale)
    throw new BadRequestException(
      `${field}: legfeljebb ${rule.scale} tizedesjegy lehet.`,
    );
  if (d.abs().truncated().toFixed(0).length > rule.integerDigits)
    throw new BadRequestException(`${field}: túl nagy szám.`);
  if (rule.minExclusive ? d.lte(rule.min) : d.lt(rule.min))
    throw new BadRequestException(
      `${field}: ${rule.minExclusive ? "nagyobb" : "nem kisebb"} kell legyen, mint ${rule.min}.`,
    );
  if (rule.max !== undefined && d.gt(rule.max))
    throw new BadRequestException(`${field}: legfeljebb ${rule.max} lehet.`);
  return d;
}

export const quantityInput = (
  v: string | null | undefined,
  field = "Mennyiség",
) =>
  decimalInput(v, field, {
    scale: 6,
    integerDigits: 13,
    min: 0,
    minExclusive: true,
  });
export const moneyInput = (v: string | null | undefined, field = "Egységár") =>
  decimalInput(v, field, { scale: 4, integerDigits: 15, min: 0 });
export const vatInput = (v: string | null | undefined) =>
  decimalInput(v, "ÁFA-kulcs", {
    scale: 2,
    integerDigits: 3,
    min: 0,
    max: 100,
  });
export const percentInput = (v: string | null | undefined) =>
  decimalInput(v, "Százalék", {
    scale: 2,
    integerDigits: 3,
    min: 0,
    minExclusive: true,
    max: 100,
  });

/** A trimmed, non-empty text up to `max`; `null` only when allowed. */
export function textInput(
  value: string | null | undefined,
  field: string,
  max: number,
  optional = false,
): string | null {
  const t = typeof value === "string" ? value.trim() : "";
  if (!t) {
    if (optional) return null;
    throw new BadRequestException(`${field}: kötelező.`);
  }
  if (t.length > max)
    throw new BadRequestException(`${field}: legfeljebb ${max} karakter.`);
  return t;
}

/** A stored quote text: the shared subset with a `doc` root (C9, decision 5). */
export function richTextInput(value: unknown): QuoteRichText {
  const result = validateQuoteRichText(value);
  if (!result.ok) throw new BadRequestException(result.reason);
  return result.value;
}

/**
 * Payment milestones: labelled, positive, and summing to exactly 100 (the
 * deposit and the PDF schedule read these rows). An empty list is allowed: a
 * draft may have no schedule yet.
 */
export function milestonesInput(
  list: QuoteMilestoneInput[] | null | undefined,
): Array<{ label: string; percent: Prisma.Decimal }> {
  if (!Array.isArray(list))
    throw new BadRequestException("A mérföldkövek listája hiányzik.");
  if (list.length > 20)
    throw new BadRequestException("Legfeljebb 20 mérföldkő lehet.");
  const rows = list.map((m, i) => ({
    label: textInput(m?.label, `${i + 1}. mérföldkő neve`, 120)!,
    percent: percentInput(m?.percent),
  }));
  if (rows.length) {
    const sum = rows.reduce((s, r) => s.plus(r.percent), new Prisma.Decimal(0));
    if (!sum.eq(100))
      throw new BadRequestException(
        `A mérföldkövek összege ${sum.toString()}%, 100% kell legyen.`,
      );
  }
  return rows;
}

/** `YYYY-MM-DD`, a real calendar day. */
export function dayInput(value: string | undefined, field: string): Date {
  const d =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00Z`)
      : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value)
    throw new BadRequestException(`${field}: érvénytelen dátum.`);
  return d;
}

/** Block kinds whose content is the quote text subset. */
const TEXT_KINDS = new Set<QuoteBlockKindValue>([
  "TEXT",
  "TERMS",
  "SECTION",
  "OPTIONS",
  "SUMMARY",
]);
/** Kinds that must carry text. */
const TEXT_REQUIRED = new Set<QuoteBlockKindValue>(["TEXT", "TERMS"]);

/**
 * The stored content of a block of this kind (editor and template alike): the
 * quote text subset for text kinds, nothing for a page break; images are not
 * creatable in P1 (no upload path yet).
 */
export function blockContent(kind: QuoteBlockKindValue, content: unknown) {
  if (kind === "IMAGE")
    throw new BadRequestException(
      "Kép blokk a P1-ben nem hozható létre (a képfeltöltés később jön).",
    );
  if (kind === "PAGE_BREAK") {
    if (content !== undefined && content !== null)
      throw new BadRequestException("Az oldaltörésnek nincs tartalma.");
    return Prisma.DbNull;
  }
  if (content === undefined || content === null) {
    if (TEXT_REQUIRED.has(kind))
      throw new BadRequestException("A szöveges blokk tartalma kötelező.");
    return Prisma.DbNull;
  }
  if (!TEXT_KINDS.has(kind))
    throw new BadRequestException("Ennek a blokknak nincs szöveges tartalma.");
  return richTextInput(content) as unknown as Prisma.InputJsonValue;
}

export interface TemplateBlock {
  kind: QuoteBlockKindValue;
  title: string | null;
  content: ReturnType<typeof blockContent>;
  keepWithNext: boolean;
  startOnNewPage: boolean;
}

const BLOCK_KINDS: readonly QuoteBlockKindValue[] = [
  "TEXT",
  "SECTION",
  "OPTIONS",
  "SUMMARY",
  "TERMS",
  "IMAGE",
  "PAGE_BREAK",
];

/**
 * A TEMPLATE'S JSON, CHECKED WITH THE EDITOR'S RULES (#1582 C3, P1 decision 1).
 * `QuoteTemplate.blocks` is `[{ kind, title?, content?, keepWithNext?,
 * startOnNewPage? }]` (text only, no items), `milestones` is
 * `[{ label, percent }]`. A broken template is a 400, never a half-built quote.
 */
export function templateInput(template: {
  blocks: unknown;
  milestones: unknown;
}): {
  blocks: TemplateBlock[];
  milestones: Array<{ label: string; percent: Prisma.Decimal }>;
} {
  if (!Array.isArray(template.blocks) || template.blocks.length > 100)
    throw new BadRequestException("A sablon blokkjai hibásak.");
  const blocks = template.blocks.map((raw, i) => {
    const b =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    if (!b || !BLOCK_KINDS.includes(b.kind as QuoteBlockKindValue))
      throw new BadRequestException(`A sablon ${i + 1}. blokkja hibás.`);
    const kind = b.kind as QuoteBlockKindValue;
    return {
      kind,
      title: textInput(
        typeof b.title === "string" ? b.title : null,
        "Cím",
        200,
        true,
      ),
      content: blockContent(kind, b.content),
      keepWithNext: b.keepWithNext === true,
      startOnNewPage: b.startOnNewPage === true,
    };
  });
  const milestones = milestonesInput(
    (Array.isArray(template.milestones)
      ? template.milestones
      : []) as QuoteMilestoneInput[],
  );
  return { blocks, milestones };
}
