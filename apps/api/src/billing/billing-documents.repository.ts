import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";

import type { NormalizedBillingDraft } from "./billing-document-draft.js";

/**
 * A SZÁMLÁZÁS MODUL SAJÁT SORAI: kimenő, Számlázz.hu-forrású bizonylat,
 * kitöltött `sourceType`-pal. A karbantartási piszkozat (`completionCertificateId`)
 * és a bejövő vagy UNAS-tükör sorok NEM ide tartoznak: azoknak más a
 * kiállítási útjuk, és ez az út nem szerkesztheti őket.
 */
export const OWN_ROWS = {
  direction: "OUTBOUND",
  source: "SZAMLAZZ",
  sourceType: { not: null },
  completionCertificateId: null,
} satisfies Prisma.InvoiceWhereInput;

/** Mentés csak vázlaton és elutasított kiállításon (#1267 állapotgépe). */
const EDITABLE = ["DRAFT", "ISSUE_FAILED"] as const;

const DETAIL_INCLUDE = {
  lines: { orderBy: [{ position: "asc" }, { id: "asc" }] },
  // A legutolsó kiküldési kísérlet, a részletek `delivery` blokkjához (nautilus).
  mailDeliveries: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { recipients: true, outcome: true, error: true, createdAt: true },
  },
  customer: {
    select: {
      id: true,
      customerNumber: true,
      displayName: true,
      companyName: true,
      taxNumber: true,
      email: true,
      addresses: {
        select: {
          type: true,
          isDefault: true,
          country: true,
          postalCode: true,
          city: true,
          line1: true,
          line2: true,
        },
      },
    },
  },
} satisfies Prisma.InvoiceInclude;

export type BillingDocumentRow = Prisma.InvoiceGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

function headerData(draft: NormalizedBillingDraft) {
  return {
    documentType: draft.documentType,
    invoiceFormat: draft.invoiceFormat,
    customerId: draft.customerId,
    fulfillmentDate: draft.fulfillmentDate,
    dueDate: draft.dueDate,
    paymentMethod: draft.paymentMethod,
    currency: draft.currency,
    language: draft.language,
    reference: draft.reference,
    note: draft.note,
    sourceType: draft.sourceType,
    sourceId: draft.sourceId,
    emailStatus: draft.emailStatus,
    netAmount: draft.netAmount,
    vatAmount: draft.vatAmount,
    grossAmount: draft.grossAmount,
  };
}

function linesData(draft: NormalizedBillingDraft, invoiceId: string) {
  return draft.lines.map((line) => ({
    id: line.id,
    invoiceId,
    position: line.position,
    kind: line.kind,
    parentLineId: line.parentLineId,
    productId: line.productId,
    variantId: line.variantId,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitNet: line.unitNet,
    vatRatePercent: line.vatRatePercent,
    discountPercent: line.discountPercent,
    netAmount: line.netAmount,
    vatAmount: line.vatAmount,
    grossAmount: line.grossAmount,
    comment: line.comment,
  }));
}

@Injectable()
export class BillingDocumentsRepository {
  private readonly database = prisma;

  customer(id: string) {
    return this.database.customer.findFirst({
      where: { id, isActive: true, archivedAt: null },
      select: {
        id: true,
        displayName: true,
        companyName: true,
        taxNumber: true,
      },
    });
  }

  find(id: string): Promise<BillingDocumentRow | null> {
    return this.database.invoice.findFirst({
      where: { id, ...OWN_ROWS },
      include: DETAIL_INCLUDE,
    });
  }

  /**
   * LÉTREHOZÁS, AZ ÜGYFÉL ÁLTAL ADOTT AZONOSÍTÓVAL. Ha a sor már létezik
   * (dupla kattintás, újraküldés), NEM jön létre második: a hívó a meglévőt
   * kapja vissza (`created: false`). A tételek ugyanabban a tranzakcióban.
   */
  async create(input: {
    id: string;
    draft: NormalizedBillingDraft;
    partnerName: string;
    partnerTaxNumber: string | null;
    createdByUserId: string;
  }): Promise<{ created: boolean }> {
    try {
      await this.database.$transaction(async (transaction) => {
        await transaction.invoice.create({
          data: {
            id: input.id,
            direction: "OUTBOUND",
            source: "SZAMLAZZ",
            status: "DRAFT",
            invoiceNumber: null,
            partnerName: input.partnerName,
            partnerTaxNumber: input.partnerTaxNumber,
            createdByUserId: input.createdByUserId,
            ...headerData(input.draft),
          },
        });
        // A kedvezmény-sor a tételére mutat, tehát a tétel ELŐBB kell: a
        // `createMany` a megadott sorrendben ír, és a normalizált lista a
        // tételt mindig a kedvezménye elé teszi.
        if (input.draft.lines.length > 0)
          await transaction.invoiceLine.createMany({
            data: linesData(input.draft, input.id),
          });
      });
      return { created: true };
    } catch (cause) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === "P2002"
      )
        return { created: false };
      throw cause;
    }
  }

  /**
   * TELJES MENTÉS, FELTÉTELES FRISSÍTÉSSEL: csak a saját, szerkeszthető sor,
   * és csak akkor, ha azóta senki nem mentette (`updatedAt`). A tételeket
   * teljes egészében cseréli: a beküldött lista a bizonylat tartalma.
   * Elutasított kiállítás (`ISSUE_FAILED`) mentéskor vázlat lesz.
   */
  async update(input: {
    id: string;
    expectedUpdatedAt: Date;
    draft: NormalizedBillingDraft;
    partnerName: string;
    partnerTaxNumber: string | null;
  }): Promise<"ok" | "gone" | "not-editable" | "stale"> {
    return this.database.$transaction(async (transaction) => {
      const claimed = await transaction.invoice.updateMany({
        where: {
          id: input.id,
          ...OWN_ROWS,
          status: { in: [...EDITABLE] },
          updatedAt: input.expectedUpdatedAt,
        },
        data: {
          status: "DRAFT",
          partnerName: input.partnerName,
          partnerTaxNumber: input.partnerTaxNumber,
          ...headerData(input.draft),
        },
      });
      if (claimed.count !== 1) {
        const row = await transaction.invoice.findFirst({
          where: { id: input.id, ...OWN_ROWS },
          select: { status: true },
        });
        if (!row) return "gone";
        if (!(EDITABLE as readonly string[]).includes(row.status))
          return "not-editable";
        return "stale";
      }
      await transaction.invoiceLine.deleteMany({
        where: { invoiceId: input.id },
      });
      if (input.draft.lines.length > 0)
        await transaction.invoiceLine.createMany({
          data: linesData(input.draft, input.id),
        });
      return "ok";
    });
  }
}
