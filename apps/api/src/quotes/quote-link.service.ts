import { createHash, randomBytes } from "node:crypto";

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type {
  AuthenticatedUser,
  QuoteAcceptanceLinkDto,
  QuoteAcceptanceLinkIssuedDto,
} from "@acropora/types";

import { budapestToday } from "./quote-publish.service.js";

/** The token's SHA-256, hex: the only form of it the database keeps. */
export function linkTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const OPEN = new Set(["DRAFT", "SENT", "POSTPONED"]);

/** The end of the validity day: the link works through `validUntil`. */
function endOfDay(validUntil: Date): Date {
  return new Date(validUntil.getTime() + 86_400_000);
}

const linkDto = (link: {
  id: string;
  quoteVersionId: string;
  expiresAt: Date;
  firstOpenedAt: Date | null;
  createdAt: Date;
}): QuoteAcceptanceLinkDto => ({
  id: link.id,
  versionId: link.quoteVersionId,
  expiresAt: link.expiresAt.toISOString(),
  firstOpenedAt: link.firstOpenedAt?.toISOString() ?? null,
  createdAt: link.createdAt.toISOString(),
});

/**
 * THE PUBLIC ACCEPTANCE LINK, ISSUED AND REVOKED (#1582 P4b). A link belongs
 * to one published version and works until the end of its validity day.
 * The token (32 random bytes, base64url) is shown once, in the issue answer;
 * the database keeps its SHA-256. Issuing again replaces the live link (the
 * old address stops working), since a token that is not kept cannot be shown
 * twice. Every step writes its QuoteEvent and audit row.
 */
@Injectable()
export class QuoteLinkService {
  private readonly database = prisma;

  async current(
    quoteId: string,
    versionId: string,
  ): Promise<QuoteAcceptanceLinkDto | null> {
    const link = await this.database.quoteAcceptanceLink.findFirst({
      where: { quoteId, quoteVersionId: versionId, revokedAt: null },
    });
    return link ? linkDto(link) : null;
  }

  async issue(
    quoteId: string,
    versionId: string,
    user: AuthenticatedUser,
  ): Promise<QuoteAcceptanceLinkIssuedDto> {
    const token = randomBytes(32).toString("base64url");
    const link = await this.database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string }>>(
        Prisma.sql`SELECT "status" FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`,
      );
      if (!rows.length)
        throw new NotFoundException("Az ajánlat nem található.");
      if (!OPEN.has(rows[0]!.status))
        throw new ConflictException(
          "Elfogadott vagy lezárt ajánlathoz nem adható ki elfogadó link.",
        );
      const version = await tx.quoteVersion.findFirst({
        where: { id: versionId, quoteId },
        select: { status: true, validUntil: true, versionNumber: true },
      });
      if (!version)
        throw new NotFoundException(
          "A verzió nem található ennél az ajánlatnál.",
        );
      if (version.status !== "PUBLISHED")
        throw new ConflictException(
          "Elfogadó link csak publikált, érvényes verzióhoz adható ki.",
        );
      if (version.validUntil.toISOString().slice(0, 10) < budapestToday())
        throw new ConflictException(
          "Lejárt érvényességű verzióhoz nem adható ki elfogadó link.",
        );
      const now = new Date();
      const replaced = await tx.quoteAcceptanceLink.updateMany({
        where: { quoteVersionId: versionId, revokedAt: null },
        data: { revokedAt: now },
      });
      const created = await tx.quoteAcceptanceLink.create({
        data: {
          quoteId,
          quoteVersionId: versionId,
          tokenHash: linkTokenHash(token),
          expiresAt: endOfDay(version.validUntil),
          createdById: user.id,
        },
      });
      await tx.quoteEvent.create({
        data: {
          quoteId,
          versionId,
          kind: "LINK_ISSUED",
          actorUserId: user.id,
          payload: {
            versionNumber: version.versionNumber,
            linkId: created.id,
            replaced: replaced.count,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          action: "quote.acceptance_link.issued",
          entityType: "Quote",
          entityId: quoteId,
          userId: user.id,
          metadata: {
            linkId: created.id,
            versionNumber: version.versionNumber,
            replaced: replaced.count,
          },
        },
      });
      return created;
    });
    return { ...linkDto(link), path: `/ajanlat/${token}` };
  }

  async revoke(
    quoteId: string,
    versionId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.database.$transaction(async (tx) => {
      const link = await tx.quoteAcceptanceLink.findFirst({
        where: { quoteId, quoteVersionId: versionId, revokedAt: null },
        select: { id: true },
      });
      if (!link)
        throw new NotFoundException("Ehhez a verzióhoz nincs élő link.");
      const revoked = await tx.quoteAcceptanceLink.updateMany({
        where: { id: link.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1)
        throw new NotFoundException("Ehhez a verzióhoz nincs élő link.");
      await tx.quoteEvent.create({
        data: {
          quoteId,
          versionId,
          kind: "LINK_REVOKED",
          actorUserId: user.id,
          payload: { linkId: link.id },
        },
      });
      await tx.auditLog.create({
        data: {
          action: "quote.acceptance_link.revoked",
          entityType: "Quote",
          entityId: quoteId,
          userId: user.id,
          metadata: { linkId: link.id },
        },
      });
    });
  }
}
