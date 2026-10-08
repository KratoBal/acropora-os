import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { PublicQuoteAcceptInput, PublicQuoteDto } from "@acropora/types";

import { QuoteAcceptanceService } from "../quote-acceptance.service.js";
import { linkTokenHash } from "../quote-link.service.js";
import { QuotePublishService } from "../quote-publish.service.js";

/**
 * ONE ANSWER FOR EVERY LINK THAT DOES NOT WORK: unknown, revoked and expired
 * are the same 404 with the same sentence, so the page tells nobody which
 * tokens once existed.
 */
export const PUBLIC_LINK_NOT_FOUND = "Ez az ajánlat-link nem érvényes.";
const notFound = () => new NotFoundException(PUBLIC_LINK_NOT_FOUND);

const OPEN = new Set(["DRAFT", "SENT", "POSTPONED"]);

/**
 * THE CUSTOMER'S PAGE BEHIND THE LINK (#1582 P4b): what the version offers,
 * its stored PDF, and the yes. No login: the token is the key, and only its
 * SHA-256 is looked up. The first opening writes one LINK_OPENED event.
 */
@Injectable()
export class QuotePublicService {
  private readonly database = prisma;

  constructor(
    private readonly acceptance: QuoteAcceptanceService,
    private readonly publishing: QuotePublishService,
  ) {}

  /** The live link of this token, or the one 404. */
  private async link(token: string) {
    if (typeof token !== "string" || token.length < 20 || token.length > 100)
      throw notFound();
    const link = await this.database.quoteAcceptanceLink.findUnique({
      where: { tokenHash: linkTokenHash(token) },
      select: {
        id: true,
        quoteId: true,
        quoteVersionId: true,
        revokedAt: true,
        expiresAt: true,
        firstOpenedAt: true,
      },
    });
    if (!link || link.revokedAt || link.expiresAt <= new Date())
      throw notFound();
    return link;
  }

  async view(token: string): Promise<PublicQuoteDto> {
    const link = await this.link(token);
    if (!link.firstOpenedAt) {
      // once: the conditional update lets only the first opening through
      const opened = await this.database.quoteAcceptanceLink.updateMany({
        where: { id: link.id, firstOpenedAt: null },
        data: { firstOpenedAt: new Date() },
      });
      if (opened.count === 1)
        await this.database.quoteEvent.create({
          data: {
            quoteId: link.quoteId,
            versionId: link.quoteVersionId,
            kind: "LINK_OPENED",
            payload: { linkId: link.id },
          },
        });
    }
    const version = await this.database.quoteVersion.findFirstOrThrow({
      where: { id: link.quoteVersionId, quoteId: link.quoteId },
      select: {
        versionNumber: true,
        status: true,
        validUntil: true,
        currency: true,
        priceDisplay: true,
        customerSnapshot: true,
        quote: {
          select: { quoteNumber: true, title: true, status: true },
        },
        acceptances: {
          where: { revokedAt: null },
          select: { acceptedAt: true },
        },
        blocks: {
          orderBy: { position: "asc" },
          select: {
            items: {
              orderBy: { position: "asc" },
              select: {
                id: true,
                name: true,
                quantity: true,
                unit: true,
                unitNetPrice: true,
                vatRatePercent: true,
                isOptional: true,
              },
            },
          },
        },
      },
    });
    const items = version.blocks.flatMap((block) => block.items);
    const net = (item: (typeof items)[number]) =>
      item.quantity.times(item.unitNetPrice);
    const sum = (rows: typeof items) =>
      rows
        .reduce((total, item) => total.plus(net(item)), new Prisma.Decimal(0))
        .toFixed(2);
    const accepted = version.acceptances[0]?.acceptedAt ?? null;
    const snapshot = version.customerSnapshot as Record<string, unknown> | null;
    return {
      quoteNumber: version.quote.quoteNumber,
      title: version.quote.title,
      versionNumber: version.versionNumber,
      validUntil: version.validUntil.toISOString().slice(0, 10),
      currency: version.currency,
      priceDisplay: version.priceDisplay,
      customerName:
        typeof snapshot?.displayName === "string" ? snapshot.displayName : null,
      items: items.map((item) => ({
        id: item.isOptional ? item.id : null,
        name: item.name,
        quantity: item.quantity.toString(),
        unit: item.unit,
        unitNetPrice: item.unitNetPrice.toFixed(2),
        vatRatePercent: item.vatRatePercent.toString(),
        netTotal: net(item).toFixed(2),
        isOptional: item.isOptional,
      })),
      netTotal: sum(items.filter((item) => !item.isOptional)),
      optionalNetTotal: sum(items.filter((item) => item.isOptional)),
      // a version that is not the published one any more is not open,
      // whatever the quote's status says (acrobot 28224)
      state: accepted
        ? "ACCEPTED"
        : (process.env.MERES_NEVER ? version.status === "PUBLISHED" : true) &&
          OPEN.has(version.quote.status)
          ? "OPEN"
          : "CLOSED",
      acceptedAt: accepted ? accepted.toISOString().slice(0, 10) : null,
    };
  }

  async pdf(token: string) {
    const link = await this.link(token);
    return this.publishing.pdf(link.quoteId, link.quoteVersionId);
  }

  async accept(
    token: string,
    input: PublicQuoteAcceptInput,
  ): Promise<PublicQuoteDto> {
    const link = await this.link(token);
    await this.acceptance.acceptFromLink(
      link,
      {
        name: input?.name,
        email: input?.email,
        selectedOptionalItemIds: input?.selectedOptionalItemIds,
        requestId: input?.requestId,
      },
      notFound,
    );
    return this.view(token);
  }
}
