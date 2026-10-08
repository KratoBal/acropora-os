import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { CreateQuoteInput, UpdateQuoteInput } from "@acropora/types";
import type { TemplateBlock } from "./quote-editor-input.js";
/** Bounded list projection: newest version summary only; no child collections or JSON. */
export const QUOTE_LIST_SELECT = {
  id: true,
  quoteNumber: true,
  title: true,
  status: true,
  customerId: true,
  ownerUserId: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { displayName: true } },
  createdBy: { select: { displayName: true } },
  versions: {
    orderBy: { versionNumber: "desc" },
    take: 1,
    select: {
      id: true,
      versionNumber: true,
      status: true,
      validUntil: true,
      currency: true,
      priceDisplay: true,
      publishedAt: true,
    },
  },
} satisfies Prisma.QuoteSelect;
export type QuoteListRow = Prisma.QuoteGetPayload<{
  select: typeof QUOTE_LIST_SELECT;
}>;
/** Only what names a linked variant on the internal detail (P1). */
const VARIANT_LABEL_SELECT = {
  sku: true,
  name: true,
  product: { select: { name: true } },
} satisfies Prisma.ProductVariantSelect;
/** The detail tree; the mapper decides per audience what leaves. */
/** P6: what the quote shows of the project started from it. */
export const HANDOFF_SUMMARY_SELECT = {
  executedAt: true,
  plan: true,
  executedBy: { select: { displayName: true } },
  project: { select: { id: true, projectNumber: true, name: true } },
} satisfies Prisma.QuoteProjectHandoffSelect;
export const QUOTE_DETAIL_INCLUDE = {
  versions: {
    orderBy: { versionNumber: "asc" },
    include: {
      blocks: {
        orderBy: { position: "asc" },
        include: {
          items: {
            orderBy: { position: "asc" },
            include: { variant: { select: VARIANT_LABEL_SELECT } },
          },
        },
      },
      bomItems: {
        orderBy: [{ quoteItemId: "asc" }, { position: "asc" }],
        include: { variant: { select: VARIANT_LABEL_SELECT } },
      },
      milestones: { orderBy: { position: "asc" } },
    },
  },
  events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  mailDeliveries: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      version: { select: { versionNumber: true } },
      initiatedBy: { select: { displayName: true } },
    },
  },
  acceptances: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      version: { select: { versionNumber: true } },
      recordedBy: { select: { displayName: true } },
      revokedBy: { select: { displayName: true } },
    },
  },
  customer: { select: { displayName: true } },
  owner: { select: { displayName: true } },
  createdBy: { select: { displayName: true } },
  handoff: { select: HANDOFF_SUMMARY_SELECT },
} satisfies Prisma.QuoteInclude;
export type QuoteRow = Prisma.QuoteGetPayload<{
  include: typeof QUOTE_DETAIL_INCLUDE;
}>;
export class QuoteWriteConflict extends Error {}
@Injectable()
export class QuotesRepository {
  find(id: string) {
    return prisma.quote.findUnique({
      where: { id },
      include: QUOTE_DETAIL_INCLUDE,
    });
  }
  template(id: string) {
    return prisma.quoteTemplate.findUnique({ where: { id } });
  }
  /** The template picker (P1): active templates, no JSON bodies. */
  templates() {
    return prisma.quoteTemplate.findMany({
      where: { archivedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        priceDisplay: true,
        defaultValidityDays: true,
      },
    });
  }
  /**
   * The offered (non-optional) net total per version, summed IN the database:
   * the list stays bounded (no item rows are loaded), and the sum is exact.
   */
  async netTotals(versionIds: string[]): Promise<Map<string, string>> {
    if (!versionIds.length) return new Map();
    const rows = await prisma.$queryRaw<
      Array<{ versionId: string; total: Prisma.Decimal | null }>
    >(
      Prisma.sql`SELECT "versionId", SUM("quantity" * "unitNetPrice") AS "total"
        FROM "QuoteItem"
        WHERE "versionId" IN (${Prisma.join(versionIds)}) AND NOT "isOptional"
        GROUP BY "versionId"`,
    );
    const totals = new Map(
      versionIds.map((id) => [id, new Prisma.Decimal(0).toFixed(4)]),
    );
    for (const r of rows)
      totals.set(
        r.versionId,
        new Prisma.Decimal(r.total ?? 0).toDecimalPlaces(4).toFixed(4),
      );
    return totals;
  }
  async list(page: number, pageSize: number, q?: string) {
    const where: Prisma.QuoteWhereInput = q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { quoteNumber: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};
    const [items, total] = await prisma.$transaction(
      [
        prisma.quote.findMany({
          where,
          select: QUOTE_LIST_SELECT,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.quote.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items, total };
  }
  /**
   * `template` (P1): the checked blocks and milestones of a `QuoteTemplate`,
   * copied into version 1; the version remembers the template.
   */
  async create(
    input: CreateQuoteInput,
    actorUserId: string,
    template?: {
      id: string;
      blocks: TemplateBlock[];
      milestones: Array<{ label: string; percent: Prisma.Decimal }>;
    },
  ) {
    return prisma.$transaction(async (tx) => {
      const [seq] = await tx.$queryRaw<Array<{ value: bigint }>>(
        Prisma.sql`SELECT nextval('"QuoteNumberSequence"') AS value`,
      );
      if (!seq) throw new Error("QUOTE_NUMBER_SEQUENCE_FAILED");
      const quoteNumber = `AJ-${new Intl.DateTimeFormat("en", { timeZone: "Europe/Budapest", year: "numeric" }).format(new Date())}-${seq.value.toString().padStart(4, "0")}`;
      const row = await tx.quote.create({
        data: {
          quoteNumber,
          title: input.title,
          customerId: input.customerId,
          ownerUserId: input.ownerUserId,
          createdById: actorUserId,
          versions: {
            create: {
              versionNumber: 1,
              validUntil: new Date(`${input.validUntil}T00:00:00Z`),
              currency: input.currency ?? "HUF",
              priceDisplay: input.priceDisplay ?? "NET",
              ...(template
                ? {
                    templateId: template.id,
                    blocks: {
                      create: template.blocks.map((b, position) => ({
                        position,
                        ...b,
                      })),
                    },
                    milestones: {
                      create: template.milestones.map((m, position) => ({
                        position,
                        ...m,
                      })),
                    },
                  }
                : {}),
            },
          },
        },
        select: QUOTE_LIST_SELECT,
      });
      await tx.quoteEvent.create({
        data: {
          quoteId: row.id,
          versionId: row.versions[0]!.id,
          kind: "CREATED",
          actorUserId,
          payload: {
            quoteNumber,
            versionNumber: 1,
            ...(template ? { outcome: "FROM_TEMPLATE" } : {}),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          action: "quote.created",
          entityType: "Quote",
          entityId: row.id,
          userId: actorUserId,
          metadata: { quoteNumber },
        },
      });
      return tx.quote.findUniqueOrThrow({
        where: { id: row.id },
        select: QUOTE_LIST_SELECT,
      });
    });
  }
  async update(id: string, input: UpdateQuoteInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>(
        Prisma.sql`SELECT "status" FROM "Quote" WHERE "id"=${id} FOR UPDATE`,
      );
      if (!locked.length) return null;
      if (locked[0]!.status !== "DRAFT") throw new QuoteWriteConflict();
      // Heads are editable only before publication; customer-visible snapshots stay untouched.
      if (
        await tx.quoteVersion.count({
          where: { quoteId: id, status: { not: "DRAFT" } },
        })
      )
        throw new QuoteWriteConflict();
      await tx.quote.update({ where: { id }, data: input });
      await tx.auditLog.create({
        data: {
          action: "quote.header_updated",
          entityType: "Quote",
          entityId: id,
          userId: actorUserId,
          metadata: { fields: Object.keys(input) },
        },
      });
      return tx.quote.findUniqueOrThrow({
        where: { id },
        select: QUOTE_LIST_SELECT,
      });
    });
  }
}
