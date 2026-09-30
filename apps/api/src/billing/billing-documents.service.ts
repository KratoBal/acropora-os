import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  BillingDocumentDetail,
  BillingDocumentStatus,
  BillingDocumentType,
  BillingEmailStatus,
  BillingSourceType,
  InvoiceFormat,
} from "@acropora/types";
import { computeBillingDocumentAmounts } from "@acropora/types";

import {
  normalizeBillingDraft,
  type NormalizedBillingDraft,
} from "./billing-document-draft.js";
import {
  BillingDocumentsRepository,
  type BillingDocumentRow,
} from "./billing-documents.repository.js";
import type { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";

/**
 * A SZÁMLÁZÁSI VÁZLAT: LÉTREHOZÁS, MENTÉS, BETÖLTÉS (Számlázás v0.1).
 *
 * Külső hívás itt NINCS: a kiállítás és a kiküldés nautilusé, az adapterrel
 * együtt (acrobot határa, 2026-09-30). A szerződés:
 * `agents/murena/megosztas/szamlazas-vazlat-vegpontok.md`.
 */
@Injectable()
export class BillingDocumentsService {
  constructor(private readonly repository: BillingDocumentsRepository) {}

  async detail(id: string): Promise<BillingDocumentDetail> {
    const row = await this.repository.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    return toBillingDocumentDetail(row);
  }

  async create(
    input: BillingDocumentDraftDto,
    user: AuthenticatedUser,
  ): Promise<BillingDocumentDetail> {
    const { draft, partner } = await this.prepare(input);
    const id = input.id?.trim() || randomUUID();
    await this.repository.create({
      id,
      draft,
      partnerName: partner.name,
      partnerTaxNumber: partner.taxNumber,
      createdByUserId: user.id,
    });
    // UGYANAZ AZ ÚT AZ ÚJ ÉS A MÁR MEGLÉVŐ SORRA: az újraküldött létrehozás a
    // meglévő vázlatot kapja, változatlanul. Ha az azonosító egy nem ide
    // tartozó soré, az ütközés, nem siker.
    const row = await this.repository.find(id);
    if (!row)
      throw new ConflictException(
        "Ez az azonosító már foglalt egy másik bizonylathoz.",
      );
    return toBillingDocumentDetail(row);
  }

  async update(
    id: string,
    input: BillingDocumentDraftDto,
  ): Promise<BillingDocumentDetail> {
    if (!input.expectedUpdatedAt)
      throw new BadRequestException(
        "A mentéshez a legutóbb betöltött állapot időbélyege kell.",
      );
    const { draft, partner } = await this.prepare(input);
    const outcome = await this.repository.update({
      id,
      expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      draft,
      partnerName: partner.name,
      partnerTaxNumber: partner.taxNumber,
    });
    if (outcome === "gone")
      throw new NotFoundException("A bizonylat nem található.");
    if (outcome === "not-editable")
      throw new ConflictException(
        "A bizonylat már kiállítás alatt van vagy ki van állítva, nem szerkeszthető.",
      );
    if (outcome === "stale")
      throw new ConflictException(
        "A bizonylatot időközben más is mentette. Töltsd újra, és nézd meg, mi változott.",
      );
    return this.detail(id);
  }

  private async prepare(input: BillingDocumentDraftDto): Promise<{
    draft: NormalizedBillingDraft;
    partner: { name: string; taxNumber: string | null };
  }> {
    const normalized = normalizeBillingDraft(input, randomUUID);
    if (!normalized.ok) throw new BadRequestException(normalized.error.message);
    const customer = await this.repository.customer(input.customerId);
    if (!customer)
      throw new BadRequestException("A kiválasztott partner nem található.");
    return {
      draft: normalized.draft,
      partner: {
        name: customer.companyName?.trim() || customer.displayName,
        taxNumber: customer.taxNumber,
      },
    };
  }
}

const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

function addressOf(row: BillingDocumentRow): string | null {
  const addresses = row.customer?.addresses ?? [];
  const chosen =
    addresses.find((a) => a.type === "BILLING" && a.isDefault) ??
    addresses.find((a) => a.type === "BILLING") ??
    addresses.find((a) => a.isDefault) ??
    addresses[0];
  if (!chosen) return null;
  const street = [chosen.line1, chosen.line2].filter(Boolean).join(" ");
  return `${chosen.postalCode} ${chosen.city}, ${street}`;
}

/** A tárolt sor a drótra. A pénz tizedes szöveg, a séma skáláján. */
export function toBillingDocumentDetail(
  row: BillingDocumentRow,
): BillingDocumentDetail {
  const items = row.lines.map((line) => ({
    id: line.id,
    kind: line.kind,
    parentLineId: line.parentLineId,
    productId: line.productId,
    description: line.description,
    quantity: line.quantity.toFixed(6),
    unit: line.unit,
    unitNet: line.unitNet.toFixed(4),
    vatRatePercent: line.vatRatePercent.toFixed(2),
    discountPercent: line.discountPercent?.toFixed(2) ?? null,
    netAmount: line.netAmount.toFixed(4),
    vatAmount: line.vatAmount.toFixed(4),
    grossAmount: line.grossAmount.toFixed(4),
    comment: line.comment,
  }));
  /*
    A KULCSONKÉNTI BONTÁS a tárolt tételekből, ugyanazzal a modullal, amivel a
    mentés számolt: a fejléc összegei és a bontás így egy forrásból jönnek.
  */
  const recomputed = computeBillingDocumentAmounts(
    items
      .filter((line) => line.kind === "ITEM")
      .map((line) => ({
        quantity: line.quantity,
        unitNet: line.unitNet,
        vatRatePercent: line.vatRatePercent,
        discountPercent: line.discountPercent,
      })),
  );
  const byVatRate = recomputed.ok ? recomputed.amounts.byVatRate : [];

  return {
    id: row.id,
    status: row.status as BillingDocumentStatus,
    emailStatus: row.emailStatus as BillingEmailStatus | null,
    documentNumber: row.invoiceNumber,
    documentType: row.documentType as BillingDocumentType,
    invoiceFormat: row.invoiceFormat as InvoiceFormat | null,
    customer: row.customer
      ? {
          id: row.customer.id,
          name: row.customer.companyName?.trim() || row.customer.displayName,
          address: addressOf(row),
          taxNumber: row.customer.taxNumber,
          euTaxNumber: null,
          contactName: null,
          email: row.customer.email,
          internalCode: row.customer.customerNumber,
        }
      : null,
    fulfillmentDate: day(row.fulfillmentDate),
    dueDate: day(row.dueDate),
    paymentMethod: row.paymentMethod,
    currency: row.currency,
    language: row.language ?? "hu",
    reference: row.reference,
    note: row.note,
    sourceType: row.sourceType as BillingSourceType | null,
    sourceId: row.sourceId,
    lines: items,
    totals: {
      netAmount: row.netAmount?.toFixed(4) ?? "0.0000",
      vatAmount: row.vatAmount?.toFixed(4) ?? "0.0000",
      grossAmount: row.grossAmount?.toFixed(4) ?? "0.0000",
      byVatRate,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
