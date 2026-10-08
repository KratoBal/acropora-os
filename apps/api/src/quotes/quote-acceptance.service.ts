import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type {
  AuthenticatedUser,
  CancelQuoteInput,
  PostponeQuoteInput,
  QuoteAcceptanceSourceValue,
  QuoteCloseReasonValue,
  QuoteDetailDto,
  RecordQuoteAcceptanceInput,
  RejectQuoteInput,
  RevokeQuoteAcceptanceInput,
} from "@acropora/types";

import { quoteDto } from "./quote-dto.mapper.js";
import { budapestToday } from "./quote-publish.service.js";
import { QuotesRepository } from "./quotes.repository.js";

/**
 * THE QUOTE'S OUTCOME (#1582 P4a): the customer's yes recorded by hand, its
 * revocation, and the three ways a quote closes without one (rejected with a
 * reason, postponed to a date, cancelled by us).
 *
 * Every step runs under the quote's row lock and writes its QuoteEvent and
 * audit row in the same transaction. A quote is OPEN in DRAFT, SENT and
 * POSTPONED; an accepted one must be revoked first; REJECTED and CANCELLED
 * are final in P4a (reopening is not in the plan).
 *
 * The database backs the rules: at most one live acceptance per quote (a
 * partial unique index), the accepted version belongs to the quote (a
 * composite FK), and the status agrees with acceptedVersionId,
 * postponedUntil and closeReason (CHECKs).
 */

type Tx = Prisma.TransactionClient;

const OPEN = new Set(["DRAFT", "SENT", "POSTPONED"]);
const SOURCES = new Set<QuoteAcceptanceSourceValue>([
  "PHONE",
  "EMAIL",
  "IN_PERSON",
  "OTHER_MANUAL",
]);
const REASONS = new Set<QuoteCloseReasonValue>([
  "PRICE",
  "COMPETITOR",
  "PROJECT_CANCELLED",
  "PROJECT_POSTPONED",
  "NO_RESPONSE",
  "SCOPE_CHANGED",
  "OTHER",
]);

/** A real calendar day as YYYY-MM-DD, or null. */
function day(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

/** Optional free text: trimmed, empty is null, longer than `max` is refused. */
function text(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string")
    throw new BadRequestException(`Érvénytelen ${label}.`);
  const trimmed = value.trim();
  if (trimmed.length > max)
    throw new BadRequestException(`A(z) ${label} legfeljebb ${max} karakter.`);
  return trimmed || null;
}

function reason(value: unknown): QuoteCloseReasonValue {
  if (!REASONS.has(value as QuoteCloseReasonValue))
    throw new BadRequestException("Érvénytelen ok.");
  return value as QuoteCloseReasonValue;
}

async function lockQuote(tx: Tx, quoteId: string) {
  const rows = await tx.$queryRaw<
    Array<{ status: string; quoteNumber: string }>
  >(
    Prisma.sql`SELECT "status", "quoteNumber" FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`,
  );
  if (!rows.length) throw new NotFoundException("Az ajánlat nem található.");
  return rows[0]!;
}

function assertOpen(status: string, action: string) {
  if (status === "ACCEPTED")
    throw new ConflictException(
      `Elfogadott ajánlat nem ${action}: előbb vond vissza az elfogadást.`,
    );
  if (!OPEN.has(status))
    throw new ConflictException(
      `Lezárt (elutasított vagy visszavont) ajánlat nem ${action}.`,
    );
}

function isUniqueViolation(e: unknown) {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
  );
}

@Injectable()
export class QuoteAcceptanceService {
  private readonly database = prisma;

  constructor(private readonly repository: QuotesRepository) {}

  private async detail(
    quoteId: string,
    user: AuthenticatedUser,
  ): Promise<QuoteDetailDto> {
    const row = await this.repository.find(quoteId);
    if (!row) throw new NotFoundException("Az ajánlat nem található.");
    return quoteDto(row, user);
  }

  /** A retry with a known request id: the same acceptance, or a 409. */
  private async replay(
    quoteId: string,
    requestId: string | null,
    user: AuthenticatedUser,
  ): Promise<QuoteDetailDto | null> {
    if (!requestId) return null;
    const existing = await this.database.quoteAcceptance.findUnique({
      where: { requestId },
      select: { quoteId: true },
    });
    if (!existing) return null;
    if (existing.quoteId !== quoteId)
      throw new ConflictException(
        "Ez a kérés-azonosító egy másik ajánlathoz tartozik.",
      );
    return this.detail(quoteId, user);
  }

  async accept(
    quoteId: string,
    input: RecordQuoteAcceptanceInput,
    user: AuthenticatedUser,
  ): Promise<QuoteDetailDto> {
    if (!SOURCES.has(input.source))
      throw new BadRequestException("Érvénytelen forrás.");
    const acceptedAt = day(input.acceptedAt);
    if (!acceptedAt)
      throw new BadRequestException("Érvénytelen elfogadási dátum.");
    if (acceptedAt > budapestToday())
      throw new BadRequestException("Az elfogadás dátuma nem lehet jövőbeli.");
    if (typeof input.versionId !== "string" || !input.versionId)
      throw new BadRequestException("A verzió megadása kötelező.");
    const name = text(input.acceptedByName, 200, "név");
    const email = text(input.acceptedByEmail, 200, "email-cím");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new BadRequestException("Érvénytelen email-cím.");
    const note = text(input.note, 2000, "megjegyzés");
    const selected = input.selectedOptionalItemIds ?? [];
    if (
      !Array.isArray(selected) ||
      selected.length > 500 ||
      selected.some((id) => typeof id !== "string") ||
      new Set(selected).size !== selected.length
    )
      throw new BadRequestException("Érvénytelen opcionális tétel-lista.");
    const requestId = text(input.requestId, 100, "kérés-azonosító");

    const replayed = await this.replay(quoteId, requestId, user);
    if (replayed) return replayed;

    try {
      await this.database.$transaction(async (tx) => {
        const quote = await lockQuote(tx, quoteId);
        assertOpen(quote.status, "fogadható el");
        const version = await tx.quoteVersion.findFirst({
          where: { id: input.versionId, quoteId },
          select: {
            status: true,
            versionNumber: true,
            items: { where: { isOptional: true }, select: { id: true } },
          },
        });
        if (!version)
          throw new NotFoundException(
            "A verzió nem található ennél az ajánlatnál.",
          );
        if (version.status === "SUPERSEDED")
          throw new ConflictException("Felülírt verzió nem fogadható el.");
        if (version.status !== "PUBLISHED")
          throw new ConflictException("Csak publikált verzió fogadható el.");
        const optional = new Set(version.items.map((i) => i.id));
        if (selected.some((id) => !optional.has(id)))
          throw new BadRequestException(
            "Csak ennek a verziónak az opcionális tételei választhatók.",
          );
        const acceptance = await tx.quoteAcceptance.create({
          data: {
            quoteId,
            quoteVersionId: input.versionId,
            source: input.source,
            acceptedAt: new Date(`${acceptedAt}T00:00:00Z`),
            acceptedByName: name,
            acceptedByEmail: email,
            recordedByUserId: user.id,
            selectedOptionalItemIds: selected,
            note,
            requestId,
          },
        });
        await tx.quote.update({
          where: { id: quoteId },
          data: {
            status: "ACCEPTED",
            acceptedVersionId: input.versionId,
            postponedUntil: null,
            closeReason: null,
            closeNote: null,
          },
        });
        await tx.quoteEvent.create({
          data: {
            quoteId,
            versionId: input.versionId,
            kind: "ACCEPTED",
            actorUserId: user.id,
            payload: {
              versionNumber: version.versionNumber,
              source: input.source,
              ...(requestId ? { requestId } : {}),
            },
          },
        });
        await tx.domainEvent.create({
          data: {
            id: randomUUID(),
            eventType: "quote.accepted",
            aggregateType: "Quote",
            aggregateId: quoteId,
            actorUserId: user.id,
            payload: {
              quoteNumber: quote.quoteNumber,
              versionNumber: version.versionNumber,
              acceptanceId: acceptance.id,
            },
            occurredAt: new Date(),
            schemaVersion: 1,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "quote.accepted",
            entityType: "Quote",
            entityId: quoteId,
            userId: user.id,
            metadata: {
              acceptanceId: acceptance.id,
              versionNumber: version.versionNumber,
              source: input.source,
            },
          },
        });
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // a concurrent retry with the same request id won the race
      const replay = await this.replay(quoteId, requestId, user);
      if (replay) return replay;
      // the other click (or person) recorded an acceptance first
      throw new ConflictException("Az ajánlatnak már van élő elfogadása.");
    }
    return this.detail(quoteId, user);
  }

  async revoke(
    quoteId: string,
    acceptanceId: string,
    input: RevokeQuoteAcceptanceInput,
    user: AuthenticatedUser,
  ): Promise<QuoteDetailDto> {
    const why = text(input.reason, 500, "indoklás");
    if (!why)
      throw new BadRequestException("A visszavonás indoklása kötelező.");
    await this.database.$transaction(async (tx) => {
      await lockQuote(tx, quoteId);
      const acceptance = await tx.quoteAcceptance.findFirst({
        where: { id: acceptanceId, quoteId },
        select: {
          revokedAt: true,
          version: { select: { versionNumber: true } },
        },
      });
      if (!acceptance)
        throw new NotFoundException(
          "Az elfogadás nem található ennél az ajánlatnál.",
        );
      if (acceptance.revokedAt)
        throw new ConflictException("Ez az elfogadás már vissza van vonva.");
      // P6 writes this event when the project starts from the quote
      if (
        await tx.quoteEvent.count({
          where: { quoteId, kind: "HANDOFF_EXECUTED" },
        })
      )
        throw new ConflictException(
          "A projekt már elindult ebből az ajánlatból, az elfogadás nem vonható vissza.",
        );
      await tx.quoteAcceptance.update({
        where: { id: acceptanceId },
        data: {
          revokedAt: new Date(),
          revokedById: user.id,
          revokeReason: why,
        },
      });
      // back to where it was before the yes: SENT once it went out (P3)
      const sent = await tx.quoteEvent.count({
        where: { quoteId, kind: "SENT" },
      });
      await tx.quote.update({
        where: { id: quoteId },
        data: { status: sent ? "SENT" : "DRAFT", acceptedVersionId: null },
      });
      await tx.quoteEvent.create({
        data: {
          quoteId,
          kind: "ACCEPTANCE_REVOKED",
          actorUserId: user.id,
          payload: { versionNumber: acceptance.version.versionNumber },
        },
      });
      await tx.auditLog.create({
        data: {
          action: "quote.acceptance_revoked",
          entityType: "Quote",
          entityId: quoteId,
          userId: user.id,
          metadata: { acceptanceId },
        },
      });
    });
    return this.detail(quoteId, user);
  }

  /** The three closing steps share one shape: lock, check open, write. */
  private async close(
    quoteId: string,
    user: AuthenticatedUser,
    action: string,
    kind: "REJECTED" | "POSTPONED" | "CANCELLED",
    data: Prisma.QuoteUpdateInput,
    payload: Record<string, string>,
  ): Promise<QuoteDetailDto> {
    await this.database.$transaction(async (tx) => {
      const quote = await lockQuote(tx, quoteId);
      assertOpen(quote.status, action);
      await tx.quote.update({ where: { id: quoteId }, data });
      await tx.quoteEvent.create({
        data: {
          quoteId,
          kind,
          actorUserId: user.id,
          payload: Object.keys(payload).length ? payload : Prisma.DbNull,
        },
      });
      await tx.auditLog.create({
        data: {
          action: `quote.${kind.toLowerCase()}`,
          entityType: "Quote",
          entityId: quoteId,
          userId: user.id,
          metadata: payload,
        },
      });
    });
    return this.detail(quoteId, user);
  }

  reject(quoteId: string, input: RejectQuoteInput, user: AuthenticatedUser) {
    const closeReason = reason(input.reason);
    return this.close(
      quoteId,
      user,
      "utasítható el",
      "REJECTED",
      {
        status: "REJECTED",
        closeReason,
        closeNote: text(input.note, 2000, "megjegyzés"),
        postponedUntil: null,
      },
      { closeReason },
    );
  }

  postpone(
    quoteId: string,
    input: PostponeQuoteInput,
    user: AuthenticatedUser,
  ) {
    const until = day(input.until);
    if (!until) throw new BadRequestException("Érvénytelen dátum.");
    if (until < budapestToday())
      throw new BadRequestException("A halasztás dátuma nem lehet múltbeli.");
    return this.close(
      quoteId,
      user,
      "halasztható",
      "POSTPONED",
      {
        status: "POSTPONED",
        postponedUntil: new Date(`${until}T00:00:00Z`),
        closeReason: null,
        closeNote: text(input.note, 2000, "megjegyzés"),
      },
      { postponedUntil: until },
    );
  }

  cancel(quoteId: string, input: CancelQuoteInput, user: AuthenticatedUser) {
    const closeReason =
      input.reason === undefined || input.reason === null
        ? null
        : reason(input.reason);
    return this.close(
      quoteId,
      user,
      "vonható vissza",
      "CANCELLED",
      {
        status: "CANCELLED",
        closeReason,
        closeNote: text(input.note, 2000, "megjegyzés"),
        postponedUntil: null,
      },
      closeReason ? { closeReason } : {},
    );
  }
}
