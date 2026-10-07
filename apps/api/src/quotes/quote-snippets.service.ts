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
  type QuoteMilestoneInput,
  type QuoteSnippetDto,
  type QuoteSnippetInput,
  type QuoteSnippetKindValue,
  type QuoteSnippetPatch,
} from "@acropora/types";

import {
  milestonesInput,
  richTextInput,
  textInput,
} from "./quote-editor-input.js";

/**
 * THE SNIPPET LIBRARY (#1582 C7, P1). A snippet is a text kept for reuse; an
 * insert COPIES it into the version (`QuoteVersionEditor.insertSnippet`), so
 * an edit here never reaches a quote already written. Archived, not deleted:
 * a block still names its source.
 *
 * PAYMENT carries milestones, and only PAYMENT does (the table's CHECK says the
 * same; this answers it in Hungarian before the database has to).
 */

export const SNIPPET_KINDS: readonly QuoteSnippetKindValue[] = [
  "INTRO",
  "TEXT",
  "DELIVERY",
  "WARRANTY",
  "PAYMENT",
];

const SNIPPET_SELECT = {
  id: true,
  name: true,
  kind: true,
  content: true,
  milestones: true,
  archivedAt: true,
  updatedAt: true,
} satisfies Prisma.QuoteSnippetSelect;

type SnippetRow = Prisma.QuoteSnippetGetPayload<{
  select: typeof SNIPPET_SELECT;
}>;

export function snippetDto(row: SnippetRow): QuoteSnippetDto {
  const milestones = Array.isArray(row.milestones)
    ? (row.milestones as unknown[]).flatMap((m) => {
        const r =
          m && typeof m === "object" ? (m as Record<string, unknown>) : null;
        return r && typeof r.label === "string" && typeof r.percent === "string"
          ? [{ label: r.label, percent: r.percent }]
          : [];
      })
    : null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    content: parseQuoteRichText(row.content),
    milestones,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** PAYMENT needs a full schedule, the others none. */
export function snippetMilestones(
  kind: QuoteSnippetKindValue,
  list: QuoteMilestoneInput[] | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (kind !== "PAYMENT") {
    if (list !== undefined && list !== null)
      throw new BadRequestException(
        "Mérföldkövet csak fizetési feltétel szövegrészlet tartalmazhat.",
      );
    return Prisma.DbNull;
  }
  const rows = milestonesInput(list ?? null);
  if (!rows.length)
    throw new BadRequestException(
      "A fizetési feltétel szövegrészlethez mérföldkövek kellenek.",
    );
  return rows.map((r) => ({ label: r.label, percent: r.percent.toString() }));
}

@Injectable()
export class QuoteSnippetsService {
  private readonly database = prisma;

  async list(includeArchived: boolean): Promise<QuoteSnippetDto[]> {
    const rows = await this.database.quoteSnippet.findMany({
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: [{ kind: "asc" }, { name: "asc" }, { id: "asc" }],
      select: SNIPPET_SELECT,
    });
    return rows.map(snippetDto);
  }

  async create(
    input: QuoteSnippetInput,
    user: AuthenticatedUser,
  ): Promise<QuoteSnippetDto> {
    if (!SNIPPET_KINDS.includes(input.kind))
      throw new BadRequestException("Ismeretlen szövegrészlet-típus.");
    const data = {
      name: textInput(input.name, "Név", 120)!,
      kind: input.kind,
      content: richTextInput(input.content) as unknown as Prisma.InputJsonValue,
      milestones: snippetMilestones(input.kind, input.milestones),
    };
    return this.database.$transaction(async (tx) => {
      const row = await tx.quoteSnippet.create({
        data: { ...data, createdById: user.id, updatedById: user.id },
        select: SNIPPET_SELECT,
      });
      await tx.auditLog.create({
        data: {
          action: "quote_snippet.created",
          entityType: "QuoteSnippet",
          entityId: row.id,
          userId: user.id,
          metadata: { kind: row.kind },
        },
      });
      return snippetDto(row);
    });
  }

  async update(
    id: string,
    patch: QuoteSnippetPatch,
    user: AuthenticatedUser,
  ): Promise<QuoteSnippetDto> {
    return this.database.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ kind: QuoteSnippetKindValue; archivedAt: Date | null }>
      >(
        Prisma.sql`SELECT "kind", "archivedAt" FROM "QuoteSnippet" WHERE "id" = ${id} FOR UPDATE`,
      );
      const current = locked[0];
      if (!current)
        throw new NotFoundException("A szövegrészlet nem található.");
      if (current.archivedAt)
        throw new ConflictException("Archivált szövegrészlet nem módosítható.");
      const data: Prisma.QuoteSnippetUpdateInput = {};
      if (patch.name !== undefined)
        data.name = textInput(patch.name, "Név", 120)!;
      if (patch.content !== undefined)
        data.content = richTextInput(
          patch.content,
        ) as unknown as Prisma.InputJsonValue;
      if (patch.milestones !== undefined)
        data.milestones = snippetMilestones(current.kind, patch.milestones);
      const row = await tx.quoteSnippet.update({
        where: { id },
        data: { ...data, updatedBy: { connect: { id: user.id } } },
        select: SNIPPET_SELECT,
      });
      await tx.auditLog.create({
        data: {
          action: "quote_snippet.updated",
          entityType: "QuoteSnippet",
          entityId: id,
          userId: user.id,
          metadata: { fields: Object.keys(data) },
        },
      });
      return snippetDto(row);
    });
  }

  async archive(id: string, user: AuthenticatedUser): Promise<QuoteSnippetDto> {
    return this.database.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>(
        Prisma.sql`SELECT "archivedAt" FROM "QuoteSnippet" WHERE "id" = ${id} FOR UPDATE`,
      );
      if (!locked.length)
        throw new NotFoundException("A szövegrészlet nem található.");
      const row = locked[0]!.archivedAt
        ? await tx.quoteSnippet.findUniqueOrThrow({
            where: { id },
            select: SNIPPET_SELECT,
          })
        : await tx.quoteSnippet.update({
            where: { id },
            data: { archivedAt: new Date(), updatedById: user.id },
            select: SNIPPET_SELECT,
          });
      if (!locked[0]!.archivedAt)
        await tx.auditLog.create({
          data: {
            action: "quote_snippet.archived",
            entityType: "QuoteSnippet",
            entityId: id,
            userId: user.id,
            metadata: {},
          },
        });
      return snippetDto(row);
    });
  }
}
