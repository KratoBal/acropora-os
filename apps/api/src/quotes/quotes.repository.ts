import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { CreateQuoteInput, UpdateQuoteInput } from "@acropora/types";
import { QUOTE_DETAIL_INCLUDE } from "./quote-dto.mapper.js";
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
export class QuoteWriteConflict extends Error {}
@Injectable()
export class QuotesRepository {
  find(id: string) {
    return prisma.quote.findUnique({
      where: { id },
      include: QUOTE_DETAIL_INCLUDE,
    });
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
  async create(input: CreateQuoteInput, actorUserId: string) {
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
          payload: { quoteNumber, versionNumber: 1 },
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
