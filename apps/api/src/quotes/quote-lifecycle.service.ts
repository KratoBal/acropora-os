import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { nextQuoteNumber } from "./quote-number.js";
import { copyVersionContent } from "./quote-version-editor.js";

/** Closed quotes: no new version, no reopening; a copy as a new quote is the way on. */
const CLOSED_STATUSES = new Set(["ACCEPTED", "REJECTED", "CANCELLED"]);

/** A copy's validity when the source's has already passed. */
const COPY_VALID_DAYS = 30;

function budapestToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
  }).format(new Date());
}

function plusDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * THE TWO LIFE-CYCLE MOVES THE QUOTE MODULE LACKED (Luca, card 5937bdf2,
 * 2026-11-02): deleting a draft that was never published, and copying a closed
 * quote as a new editable one.
 *
 * Every relation under a quote is `onDelete: Restrict` on purpose (a published
 * quote, its acceptance and its handoff are records), so a delete is explicit
 * and only for a quote nothing else has ever referred to.
 */
@Injectable()
export class QuoteLifecycleService {
  private readonly database = prisma;

  /**
   * DELETE A DRAFT: only a quote that was never published or sent (status
   * DRAFT, every version a DRAFT), with no acceptance, acceptance link, mail,
   * handoff or project, and no event but its creation. Hard delete in one
   * transaction, with one audit row that keeps the number, the title and who
   * deleted it. Anything else is a cancellation, not a deletion.
   */
  async deleteDraft(quoteId: string, user: AuthenticatedUser) {
    return this.database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string }>>(
        Prisma.sql`SELECT "status" FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`,
      );
      if (!rows.length)
        throw new NotFoundException("Az ajánlat nem található.");
      const quote = await tx.quote.findUniqueOrThrow({
        where: { id: quoteId },
        select: {
          quoteNumber: true,
          title: true,
          status: true,
          project: { select: { id: true } },
          handoff: { select: { id: true } },
          versions: { select: { id: true, status: true } },
          events: { select: { kind: true } },
          _count: {
            select: {
              acceptances: true,
              acceptanceLinks: true,
              mailDeliveries: true,
            },
          },
        },
      });
      const why =
        quote.status !== "DRAFT"
          ? "Csak tervezet állapotú ajánlat törölhető; a többi lemondható."
          : quote.versions.some((v) => v.status !== "DRAFT")
            ? "Publikált ajánlat nem törölhető; lemondható."
            : quote._count.acceptances ||
                quote._count.acceptanceLinks ||
                quote._count.mailDeliveries ||
                quote.handoff ||
                quote.project ||
                quote.events.some((e) => e.kind !== "CREATED")
              ? "Küldött vagy elfogadásra kiadott ajánlat nem törölhető; lemondható."
              : null;
      if (why) throw new ConflictException(why);
      const versionIds = quote.versions.map((v) => v.id);
      await tx.quoteBomItem.deleteMany({
        where: { versionId: { in: versionIds } },
      });
      await tx.quoteItem.deleteMany({
        where: { versionId: { in: versionIds } },
      });
      await tx.quoteBlock.deleteMany({
        where: { versionId: { in: versionIds } },
      });
      await tx.quotePaymentMilestone.deleteMany({
        where: { versionId: { in: versionIds } },
      });
      await tx.quoteEvent.deleteMany({ where: { quoteId } });
      await tx.quoteVersion.deleteMany({ where: { id: { in: versionIds } } });
      await tx.quote.delete({ where: { id: quoteId } });
      await tx.auditLog.create({
        data: {
          action: "quote.draft_deleted",
          entityType: "Quote",
          entityId: quoteId,
          userId: user.id,
          metadata: {
            quoteNumber: quote.quoteNumber,
            title: quote.title,
            versionCount: versionIds.length,
          },
        },
      });
      return { id: quoteId, quoteNumber: quote.quoteNumber };
    });
  }

  /**
   * A CLOSED QUOTE AS A NEW QUOTE: a new number, status DRAFT, version 1, a
   * deep copy of the latest PUBLISHED version (blocks, items, BOM lines with
   * their cost snapshots, milestones). The old quote is not touched. A source
   * validity that has passed becomes today plus 30 days, or the copy could not
   * be published.
   */
  async copyAsNew(quoteId: string, user: AuthenticatedUser) {
    return this.database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string }>>(
        Prisma.sql`SELECT "status" FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`,
      );
      if (!rows.length)
        throw new NotFoundException("Az ajánlat nem található.");
      const quote = await tx.quote.findUniqueOrThrow({
        where: { id: quoteId },
        select: {
          quoteNumber: true,
          title: true,
          status: true,
          customerId: true,
        },
      });
      if (!CLOSED_STATUSES.has(quote.status))
        throw new ConflictException(
          "Csak lezárt ajánlatból készíthető másolat; a nyitott ajánlathoz új verzió nyitható.",
        );
      const source = await tx.quoteVersion.findFirst({
        where: { quoteId, status: "PUBLISHED" },
        orderBy: { versionNumber: "desc" },
        include: {
          blocks: {
            orderBy: { position: "asc" },
            include: { items: { orderBy: { position: "asc" } } },
          },
          bomItems: { orderBy: [{ quoteItemId: "asc" }, { position: "asc" }] },
          milestones: { orderBy: { position: "asc" } },
        },
      });
      if (!source)
        throw new ConflictException(
          "Nincs publikált verzió, amiből másolat készíthető.",
        );
      const today = budapestToday();
      const sourceValid = source.validUntil.toISOString().slice(0, 10);
      const validUntil =
        sourceValid >= today ? sourceValid : plusDays(today, COPY_VALID_DAYS);
      const quoteNumber = await nextQuoteNumber(tx);
      const created = await tx.quote.create({
        data: {
          quoteNumber,
          title: `${quote.title} (másolat)`.slice(0, 200),
          customerId: quote.customerId,
          ownerUserId: user.id,
          createdById: user.id,
          versions: {
            create: {
              versionNumber: 1,
              validUntil: new Date(`${validUntil}T00:00:00Z`),
              currency: source.currency,
              priceDisplay: source.priceDisplay,
              customerSnapshot: source.customerSnapshot ?? Prisma.DbNull,
              templateId: source.templateId,
              createdFromVersionId: source.id,
              milestones: {
                create: source.milestones.map((m) => ({
                  position: m.position,
                  label: m.label,
                  percent: m.percent,
                })),
              },
            },
          },
        },
        select: { id: true, versions: { select: { id: true } } },
      });
      const versionId = created.versions[0]!.id;
      await copyVersionContent(tx, source, versionId);
      await tx.quoteEvent.create({
        data: {
          quoteId: created.id,
          versionId,
          kind: "CREATED",
          actorUserId: user.id,
          payload: {
            quoteNumber,
            versionNumber: 1,
            outcome: "COPY",
            copiedFromQuoteNumber: quote.quoteNumber,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          action: "quote.copied",
          entityType: "Quote",
          entityId: created.id,
          userId: user.id,
          metadata: {
            quoteNumber,
            copiedFromQuoteId: quoteId,
            copiedFromQuoteNumber: quote.quoteNumber,
          },
        },
      });
      return { id: created.id, quoteNumber };
    });
  }
}
