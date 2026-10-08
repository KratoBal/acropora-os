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
  QuoteProformaResultDto,
} from "@acropora/types";

import { normalizeBillingDraft } from "../billing/billing-document-draft.js";
import { insertBillingDraft } from "../billing/billing-documents.repository.js";
import { retryOnSerializationConflict } from "../common/transaction-retry.util.js";
import { allocateMilestone } from "./quote-billing.js";

type Tx = Prisma.TransactionClient;

/**
 * THE ONE PLACE A QUOTE'S PROFORMA IS MADE (#1582 P7; barracuda's P7 point:
 * "a díjbekérő egy helyen keletkezzen"). The handoff calls it in its own
 * transaction for the first milestone; the quote's milestone list calls it
 * for any milestone.
 *
 * The draft is a PROFORMA through the billing's own normalizer and insert,
 * so its amounts and VAT are the billing's. Its lines come from
 * `allocateMilestone` (per VAT rate). It stays a DRAFT: issuing is the
 * billing page's step, and nothing here sends it.
 *
 * Once per milestone. A milestone that already has its proforma answers it.
 * Two at once both write a draft, but only one can claim the milestone (a
 * conditional update on `proformaInvoiceId IS NULL`); the other deletes its
 * own draft in its transaction and answers the winner's.
 */
export async function createMilestoneProforma(
  tx: Tx,
  args: { quoteId: string; milestoneId: string; userId: string },
): Promise<{ invoiceId: string; created: boolean }> {
  const quote = await tx.quote.findUnique({
    where: { id: args.quoteId },
    select: {
      quoteNumber: true,
      status: true,
      customerId: true,
      acceptedVersionId: true,
      project: { select: { id: true } },
    },
  });
  if (!quote) throw new NotFoundException("Az ajánlat nem található.");
  if (quote.status !== "ACCEPTED" || !quote.acceptedVersionId)
    throw new ConflictException(
      "Díjbekérő csak elfogadott ajánlatból készíthető.",
    );
  const milestone = await tx.quotePaymentMilestone.findFirst({
    where: { id: args.milestoneId, versionId: quote.acceptedVersionId },
    select: {
      label: true,
      percent: true,
      proformaInvoiceId: true,
      version: { select: { currency: true } },
    },
  });
  if (!milestone)
    throw new NotFoundException("Ez a mérföldkő nem az elfogadott verzióé.");
  if (milestone.proformaInvoiceId)
    return { invoiceId: milestone.proformaInvoiceId, created: false };
  if (milestone.version.currency !== "HUF")
    throw new ConflictException(
      "Díjbekérő ma csak forintos ajánlatból készíthető.",
    );
  if (!quote.customerId)
    throw new ConflictException(
      "Az ajánlathoz nincs partner rendelve, így díjbekérő nem készíthető.",
    );
  const customer = await tx.customer.findFirst({
    where: { id: quote.customerId, isActive: true, archivedAt: null },
    select: { displayName: true, companyName: true, taxNumber: true },
  });
  if (!customer)
    throw new ConflictException(
      "Az ajánlat partnere nem aktív, így díjbekérő nem készíthető.",
    );

  // the accepted lines: the offered ones and the options the customer asked
  const acceptance = await tx.quoteAcceptance.findFirst({
    where: {
      quoteId: args.quoteId,
      quoteVersionId: quote.acceptedVersionId,
      revokedAt: null,
    },
    select: { selectedOptionalItemIds: true },
  });
  const selected = new Set(acceptance?.selectedOptionalItemIds ?? []);
  const items = await tx.quoteItem.findMany({
    where: { versionId: quote.acceptedVersionId },
    select: {
      id: true,
      isOptional: true,
      quantity: true,
      unitNetPrice: true,
      vatRatePercent: true,
    },
  });
  const split = allocateMilestone(
    items
      .filter((i) => !i.isOptional || selected.has(i.id))
      .map((i) => ({
        net: i.quantity.times(i.unitNetPrice),
        vatRatePercent: i.vatRatePercent,
      })),
    milestone.percent,
  );
  if (split.negativeRates.length)
    throw new ConflictException(
      `A(z) ${split.negativeRates.join(", ")}% ÁFA-kulcson az elfogadott tételek összege negatív (kedvezmény más tétel nélkül), így a díjbekérő nem bontható kulcsonként. Készítsd el a Számlázásban kézzel.`,
    );
  if (!split.lines.length)
    throw new ConflictException(
      "Az elfogadott tételek összege nulla, nincs miből díjbekérőt készíteni.",
    );

  const percent = milestone.percent.toString().replace(/\.?0+$/, "");
  const normalized = normalizeBillingDraft(
    {
      documentType: "PROFORMA",
      invoiceFormat: null,
      customerId: quote.customerId,
      fulfillmentDate: null,
      dueDate: null,
      paymentMethod: null,
      currency: "HUF",
      language: "hu",
      reference: quote.quoteNumber,
      note: `${milestone.label} (${percent}%) a(z) ${quote.quoteNumber} ajánlathoz.`,
      sourceType: quote.project ? "PROJECT" : "MANUAL",
      sourceId: quote.project?.id ?? null,
      lines: split.lines.map((line) => ({
        productId: null,
        description: `${milestone.label} (${percent}%), ${quote.quoteNumber}`,
        quantity: "1",
        unit: "db",
        unitNet: line.net,
        vatRatePercent: line.vatRatePercent,
        discountPercent: null,
        comment: null,
      })),
    },
    randomUUID,
  );
  if (!normalized.ok) throw new BadRequestException(normalized.error.message);

  const invoiceId = randomUUID();
  await insertBillingDraft(tx, {
    id: invoiceId,
    draft: normalized.draft,
    partnerName: customer.companyName?.trim() || customer.displayName,
    partnerTaxNumber: customer.taxNumber,
    createdByUserId: args.userId,
  });
  const claimed = await tx.quotePaymentMilestone.updateMany({
    where: { id: args.milestoneId },
    data: { proformaInvoiceId: invoiceId },
  });
  if (claimed.count !== 1) {
    // ANOTHER REQUEST CLAIMED IT FIRST: this draft goes, in this very
    // transaction, and the winner's is the answer. Not a thrown rollback:
    // inside the handoff that would take the project with it (barracuda's
    // #1634 review, 4a).
    await tx.invoiceLine.deleteMany({ where: { invoiceId } });
    await tx.invoice.delete({ where: { id: invoiceId } });
    const winner = await tx.quotePaymentMilestone.findUniqueOrThrow({
      where: { id: args.milestoneId },
      select: { proformaInvoiceId: true },
    });
    if (!winner.proformaInvoiceId)
      throw new ConflictException(
        "A mérföldkő díjbekérője közben megváltozott; töltsd újra az ajánlatot.",
      );
    return { invoiceId: winner.proformaInvoiceId, created: false };
  }
  await tx.quoteEvent.create({
    data: {
      quoteId: args.quoteId,
      kind: "PROFORMA_PREPARED",
      actorUserId: args.userId,
      payload: {
        milestone: milestone.label,
        percent,
        net: split.total,
        invoiceId,
      },
    },
  });
  await tx.auditLog.create({
    data: {
      action: "quote.proforma_prepared",
      entityType: "Quote",
      entityId: args.quoteId,
      userId: args.userId,
      metadata: { milestoneId: args.milestoneId, invoiceId },
    },
  });
  return { invoiceId, created: true };
}

/** P7: a milestone's proforma by hand, from the quote's milestone list. */
@Injectable()
export class QuoteProformaService {
  private readonly database = prisma;

  prepare(
    quoteId: string,
    milestoneId: string,
    user: AuthenticatedUser,
  ): Promise<QuoteProformaResultDto> {
    return retryOnSerializationConflict(() =>
      this.database.$transaction((tx) =>
        createMilestoneProforma(tx, { quoteId, milestoneId, userId: user.id }),
      ),
    );
  }
}
