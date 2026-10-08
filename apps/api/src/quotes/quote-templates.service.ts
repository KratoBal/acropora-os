import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  parseQuoteRichText,
  type AuthenticatedUser,
  type QuoteBlockKindValue,
  type QuotePriceDisplay,
  type QuoteTemplateDto,
  type QuoteTemplateInput,
  type QuoteTemplatePatch,
} from "@acropora/types";

import { templateInput, textInput } from "./quote-editor-input.js";

/**
 * THE TEMPLATE MANAGER (#1582, Balázs 2026-10-08: "Sablon semmi"). The P1
 * plan gave the picker and the snippet library, not the templates' own
 * editor; this is it, on the snippet manager's pattern. The blocks and the
 * milestones stay JSON on `QuoteTemplate` (C3: no template-block table), and
 * both are checked with the editor's rules (`templateInput`), so a saved
 * template always builds a valid version 1. Archived, never deleted: a
 * version still names its template.
 */

const PRICE_DISPLAYS: readonly QuotePriceDisplay[] = ["NET", "GROSS", "BOTH"];

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  blocks: true,
  milestones: true,
  priceDisplay: true,
  defaultValidityDays: true,
  archivedAt: true,
  updatedAt: true,
} satisfies Prisma.QuoteTemplateSelect;

type TemplateRow = Prisma.QuoteTemplateGetPayload<{
  select: typeof TEMPLATE_SELECT;
}>;

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/** A stored template, read leniently: a broken row lists, it does not throw. */
export function templateDto(row: TemplateRow): QuoteTemplateDto {
  return {
    id: row.id,
    name: row.name,
    priceDisplay: (PRICE_DISPLAYS.includes(
      row.priceDisplay as QuotePriceDisplay,
    )
      ? row.priceDisplay
      : "NET") as QuotePriceDisplay,
    defaultValidityDays: row.defaultValidityDays,
    blocks: (Array.isArray(row.blocks) ? row.blocks : []).flatMap((raw) => {
      const b = record(raw);
      if (!b || typeof b.kind !== "string") return [];
      return [
        {
          kind: b.kind as QuoteBlockKindValue,
          title: typeof b.title === "string" ? b.title : null,
          content: b.content ? parseQuoteRichText(b.content) : null,
          keepWithNext: b.keepWithNext === true,
          startOnNewPage: b.startOnNewPage === true,
        },
      ];
    }),
    milestones: (Array.isArray(row.milestones) ? row.milestones : []).flatMap(
      (raw) => {
        const m = record(raw);
        return m && typeof m.label === "string" && typeof m.percent === "string"
          ? [{ label: m.label, percent: m.percent }]
          : [];
      },
    ),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validityDays(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 365
  )
    throw new BadRequestException(
      "Az alapértelmezett érvényesség 1 és 365 nap közötti egész szám.",
    );
  return value;
}

function priceDisplay(value: unknown): QuotePriceDisplay {
  if (!PRICE_DISPLAYS.includes(value as QuotePriceDisplay))
    throw new BadRequestException("Érvénytelen ár-megjelenítés.");
  return value as QuotePriceDisplay;
}

/** The blocks and milestones as stored: the editor's rules, JSON-safe. */
export function templateBody(input: { blocks: unknown; milestones: unknown }): {
  blocks: Prisma.InputJsonValue;
  milestones: Prisma.InputJsonValue;
} {
  const checked = templateInput(input);
  return {
    blocks: checked.blocks.map((b) => ({
      kind: b.kind,
      title: b.title,
      // a JSON array holds a plain null, not the column-level DbNull
      content: b.content === Prisma.DbNull ? null : b.content,
      keepWithNext: b.keepWithNext,
      startOnNewPage: b.startOnNewPage,
    })) as Prisma.InputJsonValue,
    milestones: checked.milestones.map((m) => ({
      label: m.label,
      percent: m.percent.toString(),
    })),
  };
}

@Injectable()
export class QuoteTemplatesService {
  private readonly database = prisma;

  async list(includeArchived: boolean): Promise<QuoteTemplateDto[]> {
    const rows = await this.database.quoteTemplate.findMany({
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: TEMPLATE_SELECT,
    });
    return rows.map(templateDto);
  }

  async create(
    input: QuoteTemplateInput,
    user: AuthenticatedUser,
  ): Promise<QuoteTemplateDto> {
    const data = {
      name: textInput(input.name, "Név", 120)!,
      priceDisplay: priceDisplay(input.priceDisplay),
      defaultValidityDays: validityDays(input.defaultValidityDays),
      ...templateBody(input),
    };
    return this.database.$transaction(async (tx) => {
      const row = await tx.quoteTemplate.create({
        data: { ...data, createdById: user.id, updatedById: user.id },
        select: TEMPLATE_SELECT,
      });
      await tx.auditLog.create({
        data: {
          action: "quote_template.created",
          entityType: "QuoteTemplate",
          entityId: row.id,
          userId: user.id,
          metadata: { blockCount: input.blocks?.length ?? 0 },
        },
      });
      return templateDto(row);
    });
  }

  async update(
    id: string,
    patch: QuoteTemplatePatch,
    user: AuthenticatedUser,
  ): Promise<QuoteTemplateDto> {
    return this.database.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ archivedAt: Date | null; blocks: unknown; milestones: unknown }>
      >(
        Prisma.sql`SELECT "archivedAt", "blocks", "milestones" FROM "QuoteTemplate" WHERE "id" = ${id} FOR UPDATE`,
      );
      const current = locked[0];
      if (!current) throw new NotFoundException("A sablon nem található.");
      if (current.archivedAt)
        throw new ConflictException("Archivált sablon nem módosítható.");
      const data: Prisma.QuoteTemplateUpdateInput = {};
      if (patch.name !== undefined)
        data.name = textInput(patch.name, "Név", 120)!;
      if (patch.priceDisplay !== undefined)
        data.priceDisplay = priceDisplay(patch.priceDisplay);
      if (patch.defaultValidityDays !== undefined)
        data.defaultValidityDays = validityDays(patch.defaultValidityDays);
      if (patch.blocks !== undefined || patch.milestones !== undefined)
        Object.assign(
          data,
          templateBody({
            blocks: patch.blocks ?? [],
            milestones: patch.milestones ?? current.milestones,
          }),
        );
      const row = await tx.quoteTemplate.update({
        where: { id },
        data: { ...data, updatedBy: { connect: { id: user.id } } },
        select: TEMPLATE_SELECT,
      });
      await tx.auditLog.create({
        data: {
          action: "quote_template.updated",
          entityType: "QuoteTemplate",
          entityId: id,
          userId: user.id,
          metadata: { fields: Object.keys(data) },
        },
      });
      return templateDto(row);
    });
  }

  async archive(
    id: string,
    user: AuthenticatedUser,
  ): Promise<QuoteTemplateDto> {
    return this.database.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>(
        Prisma.sql`SELECT "archivedAt" FROM "QuoteTemplate" WHERE "id" = ${id} FOR UPDATE`,
      );
      if (!locked.length)
        throw new NotFoundException("A sablon nem található.");
      if (locked[0]!.archivedAt)
        return templateDto(
          await tx.quoteTemplate.findUniqueOrThrow({
            where: { id },
            select: TEMPLATE_SELECT,
          }),
        );
      const row = await tx.quoteTemplate.update({
        where: { id },
        data: { archivedAt: new Date(), updatedById: user.id },
        select: TEMPLATE_SELECT,
      });
      await tx.auditLog.create({
        data: {
          action: "quote_template.archived",
          entityType: "QuoteTemplate",
          entityId: id,
          userId: user.id,
          metadata: {},
        },
      });
      return templateDto(row);
    });
  }
}
