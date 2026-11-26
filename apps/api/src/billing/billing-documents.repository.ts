import { Injectable } from "@nestjs/common";
import { contractBilledLines } from "../contracts/contract-billed-lines.js";
import {
  linkedPartnerTaxHint,
  partnerTaxNumberFor,
  partnerTermsFor,
} from "../customers/partner-payment-terms.js";
import { prisma, Prisma } from "@acropora/database";
import type { PartnerTaxHint } from "@acropora/types";

import { foreignFeedInvoicesOf } from "../orders/webshop-orders/webshop-foreign-feed-invoices.js";
import { WEBSHOP_ADVANCE_TAG } from "../orders/webshop-orders/webshop-order-invoice.rules.js";
import type {
  WebshopOrderInvoiceFact,
  WebshopBalanceFacts,
  WebshopTransferFacts,
} from "./billing-document-issue.js";
import type { NormalizedBillingDraft } from "./billing-document-draft.js";
import { quoteBasisFrom, type QuoteBasis } from "./billing-final-lines.js";
import {
  loadRelatedBillingDocuments,
  type RelatedBillingDocuments,
} from "./billing-document-related.js";

// the own-row scope lives in one place; re-exported for the existing importers
export { OWN_ROWS } from "./billing-own-rows.js";
import { OWN_ROWS } from "./billing-own-rows.js";
import {
  draftDeleteRefusal,
  type DraftDeleteRefusal,
} from "./billing-draft-delete.js";

/** A törlés tranzakciója közben megváltozott a vázlat: visszagördítés (a hívó `STALE`-t mond). */
class DraftChangedDuringDelete extends Error {}

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
  // a számla sztornója (legfeljebb egy: a migráció részleges egyedi indexe)
  correctionInvoices: {
    where: { documentType: "STORNO" },
    select: {
      id: true,
      status: true,
      invoiceNumber: true,
      issueDate: true,
      pdfStorageKey: true,
      syncError: true,
    },
  },
  // végszámlán a levont előleg (számlázási brief, 3.); a sztornó sor is ide
  // mutat, de az nem saját bizonylat (`OWN_ROWS`), tehát itt nem olvassuk
  referencedInvoice: {
    select: {
      id: true,
      documentType: true,
      invoiceNumber: true,
      grossAmount: true,
      currency: true,
      // a webshop-végszámla rendelése (barracuda a #2980-on): a szerkesztő a végszámla-vázlat forrását átírhatja, a hivatkozott
      // előlegszámláét nem (kiállított); az előleg rendelése a saját forrása, vagy (átírt előleg-vázlatból) a díjbekérőjéé
      sourceType: true,
      sourceId: true,
      proformaInvoice: { select: { sourceType: true, sourceId: true } },
      // a végszámla kiállítása előtt: sztornózták-e közben az előleget
      correctionInvoices: {
        where: { documentType: "STORNO", status: "ISSUED" },
        select: { id: true },
      },
    },
  },
  // díjbekérőből készült előlegnél a díjbekérő száma a kiállításhoz (brief, 2.); a forrása a webshop-őrzőknek: a kiállított
  // díjbekérő nem szerkeszthető, tehát a rendelése akkor is megmarad, ha a vázlat forrását átírták (barracuda a #2884-en)
  proformaInvoice: {
    select: { id: true, invoiceNumber: true, sourceType: true, sourceId: true },
  },
  // a díjbekérőn: a belőle készült előleg (legfeljebb egy, `advanceIdFor`)
  invoicesFromProforma: {
    where: { documentType: "ADVANCE_INVOICE" },
    select: { id: true, status: true, invoiceNumber: true },
  },
  customer: {
    select: {
      id: true,
      customerNumber: true,
      // a vevő adószám-kapujához (`customerTaxNumberProblem`): a típus és a partner-tükör
      type: true,
      // a kötés a tipphez is (`partnerTaxHint`): a kötött partner adószáma, nem a névegyezés
      partner: {
        select: { id: true, name: true, taxNumber: true, deletedAt: true },
      },
      displayName: true,
      companyName: true,
      taxNumber: true,
      euTaxNumber: true,
      email: true,
      billingEmail: true,
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
    contractItemId: line.contractItemId,
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

/**
 * ONE OWN DRAFT, IN THE CALLER'S TRANSACTION: the header and its lines. The
 * create path and the quote milestone's proforma (#1582 P7) both write
 * through here, so a draft has one shape wherever it starts.
 */
export async function insertBillingDraft(
  transaction: Prisma.TransactionClient,
  input: {
    id: string;
    draft: NormalizedBillingDraft;
    partnerName: string;
    partnerTaxNumber: string | null;
    createdByUserId: string;
    proformaInvoiceId?: string | null;
    referencedInvoiceId?: string | null;
  },
): Promise<void> {
  await transaction.invoice.create({
    data: {
      id: input.id,
      proformaInvoiceId: input.proformaInvoiceId ?? null,
      referencedInvoiceId: input.referencedInvoiceId ?? null,
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
}

@Injectable()
export class BillingDocumentsRepository {
  private readonly database = prisma;

  /**
   * A kiállítás őréhez (feladat d510): a beszerzési szerződés tételei és a
   * MÁSHOL számlázottnak számító sorai (a kiállítandó bizonylat sajátjai nélkül).
   */
  async contractBillingFacts(
    contractId: string,
    excludeInvoiceIds: readonly string[],
  ) {
    const items = await this.database.contractItem.findMany({
      where: { contractId, contract: { kind: "PURCHASE" } },
      select: { id: true, quantity: true },
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        quantity: item.quantity.toString(),
      })),
      billed: await contractBilledLines(
        this.database,
        contractId,
        excludeInvoiceIds,
      ),
    };
  }

  /** A beszerzési szerződés tételeinek azonosítói (feladat d510); ismeretlen vagy nem beszerzési szerződésnél üres. */
  async purchaseContractItemIds(contractId: string): Promise<Set<string>> {
    const items = await this.database.contractItem.findMany({
      where: { contractId, contract: { kind: "PURCHASE" } },
      select: { id: true },
    });
    return new Set(items.map((item) => item.id));
  }

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

  /**
   * A VEVŐ FIZETÉSI NAPJAI, ahogy a szerkesztő is számolja új számlánál: a
   * vevő-sor saját napjai, és ha az üres, a Partnerek oldalon beállított (a
   * `partnerTermsFor` párosításával, mint a vevő részletei). `null`: nincs.
   */
  async customerPaymentDueDays(id: string): Promise<number | null> {
    const customer = await this.database.customer.findUnique({
      where: { id },
      select: {
        displayName: true,
        companyName: true,
        taxNumber: true,
        paymentDueDays: true,
      },
    });
    if (!customer) return null;
    if (customer.paymentDueDays !== null) return customer.paymentDueDays;
    const partners = await this.database.supplier.findMany({
      where: { paymentDueDays: { not: null }, deletedAt: null },
      select: { name: true, taxNumber: true, paymentDueDays: true },
    });
    return (
      partnerTermsFor(
        customer,
        partners.map((partner) => ({
          name: partner.name,
          taxNumber: partner.taxNumber,
          paymentDueDays: partner.paymentDueDays!,
        })),
      )?.paymentDueDays ?? null
    );
  }

  /**
   * A partner adószáma a vevő-sor hiányzó adószámához (kártya aaf4f09d, 40332480): csak a kapu
   * okához, az adatot nem írja át. ELŐSZÖR a KÖTÉS (`Supplier.customerId`, `linkedPartnerTaxHint`),
   * mert az egyesített partnernél a tükör neve eltérhet a partnerétől, és a név szerinti keresés
   * ilyenkor mást mondana, mint a vevő részlete. A névalapú (`partnerTaxNumberFor`) a tartalék
   * a kötetlen régi vevő-sorokra. A lekérdezés csak akkor fut, ha a vevőnek nincs adószáma és
   * kötés sem adott tippet.
   */
  async partnerTaxHint(customer: {
    displayName: string;
    companyName: string | null;
    taxNumber: string | null;
    euTaxNumber: string | null;
    partner?: {
      deletedAt?: Date | null;
      name: string;
      taxNumber: string | null;
    } | null;
  }): Promise<PartnerTaxHint | null> {
    if (customer.taxNumber?.trim() || customer.euTaxNumber?.trim()) return null;
    const linked = linkedPartnerTaxHint(customer.partner ?? null);
    if (linked) return linked;
    const partners = await this.database.supplier.findMany({
      // a deleted partner is no source (barracuda, #2161)
      where: { taxNumber: { not: null }, deletedAt: null },
      select: { name: true, taxNumber: true },
    });
    return partnerTaxNumberFor(customer, partners);
  }

  /** A saját számla Számlázz.hu-ikrét sztornózták-e (a feed `cancelled` jele). */
  async feedTwinCancelled(invoiceNumber: string): Promise<boolean> {
    const twin = await this.database.externalBillingDocument.findFirst({
      where: { documentNumber: invoiceNumber, cancelled: true },
      select: { id: true },
    });
    return twin !== null;
  }

  /**
   * AZ AJÁNLAT, AMELYNEK EZ A DÍJBEKÉRŐ A MÉRFÖLDKÖVE (kártya 2650d371): `null`, ha a díjbekérő nem egy mérföldkő díjbekérője (kézi, teljes
   * ellenértékű, kötés nélküli), vagy a mérföldkő nem az ajánlat ELFOGADOTT verzióján van (akkor a kötés nem egyértelmű). Az
   * elfogadott tételek ugyanazzal a szűréssel, mint a díjbekérőé (`createMilestoneProforma`): a nem opcionálisak és az elfogadó által
   * kért opcionálisak, az ajánlat sorrendjében.
   */
  async quoteBasisOfProforma(
    proformaInvoiceId: string,
  ): Promise<QuoteBasis | null> {
    const milestone = await this.database.quotePaymentMilestone.findFirst({
      where: { proformaInvoiceId },
      select: {
        id: true,
        percent: true,
        versionId: true,
        version: {
          select: {
            quoteId: true,
            quote: { select: { quoteNumber: true, acceptedVersionId: true } },
          },
        },
      },
    });
    if (!milestone) return null;
    // a verzió MÁS mérföldkövei, amelyeknek már van díjbekérőjük: több előleg esetén a végszámla tételei nem az ajánlat teljes tételei
    const otherProformaMilestones =
      await this.database.quotePaymentMilestone.count({
        where: {
          versionId: milestone.versionId,
          id: { not: milestone.id },
          proformaInvoiceId: { not: null },
        },
      });
    const acceptance = await this.database.quoteAcceptance.findFirst({
      where: {
        quoteId: milestone.version.quoteId,
        quoteVersionId: milestone.versionId,
        revokedAt: null,
      },
      select: { selectedOptionalItemIds: true },
    });
    const items = await this.database.quoteItem.findMany({
      where: { versionId: milestone.versionId },
      orderBy: [{ block: { position: "asc" } }, { position: "asc" }],
      select: {
        id: true,
        isOptional: true,
        replacesItemId: true,
        name: true,
        quantity: true,
        unit: true,
        unitNetPrice: true,
        vatRatePercent: true,
      },
    });
    return quoteBasisFrom(
      {
        percent: milestone.percent,
        versionId: milestone.versionId,
        quote: milestone.version.quote,
        otherProformaMilestones,
      },
      acceptance?.selectedOptionalItemIds ?? [],
      items,
    );
  }

  /**
   * A DÍJBEKÉRŐ FIZETÉSI TÉNYEI A FEEDBŐL (kártya 00926d89): a kifizetett összeg, a bruttó, a pénznem és a sztornó jele. `null`: nincs
   * feed-sora. A döntést (teljes fedezet-e) NEM ez hozza: azt `advancePaidByProforma` az előlegszámla saját bruttójával veti össze.
   */
  /**
   * THE OTHER INVOICES OF A WEBSHOP ORDER (card d31a66a3, S1): its issued or issuing invoice, advance and final invoice besides
   * `excludeId`, with whether each is cancelled (an issued OS storno, or the Számlázz.hu twin cancelled on the site). The
   * over-invoicing rule (`webshopOverbillingProblem`) decides from these.
   */
  async webshopOrderInvoices(
    orderId: string,
    excludeId: string,
  ): Promise<WebshopOrderInvoiceFact[]> {
    const rows = await this.database.invoice.findMany({
      where: {
        // the order's documents by their own source, OR by the proforma they settle (a draft relabelled in the editor), OR (a final
        // invoice relabelled in the editor, barracuda on #2980) by the advance invoice they deduct, or that advance's proforma
        OR: [
          { sourceType: "WEBSHOP_ORDER", sourceId: orderId },
          {
            proformaInvoice: {
              is: { sourceType: "WEBSHOP_ORDER", sourceId: orderId },
            },
          },
          {
            referencedInvoice: {
              is: {
                OR: [
                  { sourceType: "WEBSHOP_ORDER", sourceId: orderId },
                  {
                    proformaInvoice: {
                      is: { sourceType: "WEBSHOP_ORDER", sourceId: orderId },
                    },
                  },
                ],
              },
            },
          },
        ],
        id: { not: excludeId },
        documentType: { in: ["INVOICE", "ADVANCE_INVOICE", "FINAL_INVOICE"] },
        status: { in: ["ISSUED", "ISSUING"] },
      },
      select: {
        documentType: true,
        status: true,
        invoiceNumber: true,
        correctionInvoices: {
          where: { documentType: "STORNO", status: "ISSUED" },
          select: { id: true },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const numbers = rows.flatMap((row) =>
      row.invoiceNumber ? [row.invoiceNumber] : [],
    );
    const siteCancelled = numbers.length
      ? new Set(
          (
            await this.database.externalBillingDocument.findMany({
              where: { documentNumber: { in: numbers }, cancelled: true },
              select: { documentNumber: true },
            })
          ).map((doc) => doc.documentNumber),
        )
      : new Set<string>();
    return rows.map((row) => ({
      documentType: row.documentType as WebshopOrderInvoiceFact["documentType"],
      status: row.status as WebshopOrderInvoiceFact["status"],
      number: row.invoiceNumber,
      cancelled:
        row.correctionInvoices.length > 0 ||
        (row.invoiceNumber !== null && siteCancelled.has(row.invoiceNumber)),
    }));
  }

  /**
   * THE WEBSHOP TRANSFER THAT PAID A PROFORMA (card d31a66a3, S1): the order's recorded transfer receipt, when it paid this very
   * proforma, with the proforma's advance mark. `null`: no transfer recorded for the order, or it paid another proforma.
   */
  async webshopTransferFacts(
    orderId: string,
    proformaId: string,
  ): Promise<WebshopTransferFacts | null> {
    const receipt = await this.database.webshopTransferReceipt.findUnique({
      where: { orderId },
      select: { proformaId: true, amount: true, currency: true },
    });
    if (!receipt || receipt.proformaId !== proformaId) return null;
    const proforma = await this.database.invoice.findUnique({
      where: { id: proformaId },
      select: { tags: true },
    });
    return {
      amount: receipt.amount,
      currency: receipt.currency,
      advance: proforma?.tags.includes(WEBSHOP_ADVANCE_TAG) ?? false,
    };
  }

  /**
   * THE BALANCE THAT CAME IN AFTER AN ADVANCE (card d31a66a3, S4): the order's recorded balance receipt (S3). `null`: none yet.
   */
  async webshopBalanceFacts(
    orderId: string,
  ): Promise<WebshopBalanceFacts | null> {
    const balance = await this.database.webshopBalanceReceipt.findUnique({
      where: { orderId },
      select: { amount: true, currency: true },
    });
    return balance
      ? { amount: balance.amount, currency: balance.currency }
      : null;
  }

  /**
   * THE AUTOKASSZA CHECK ON THE SHARED ISSUE (barracuda on #2884): the same query the order page runs
   * (`foreignFeedInvoicesOf`), for a webshop invoice draft issued from the billing editor. The proforma's number, reference
   * and day come from the proforma row; a proforma without a number has nothing in the feed to compare with.
   */
  async webshopForeignFeedInvoices(
    orderId: string,
    proformaId: string,
  ): Promise<string[]> {
    const proforma = await this.database.invoice.findUnique({
      where: { id: proformaId },
      select: { invoiceNumber: true, reference: true, createdAt: true },
    });
    if (!proforma?.invoiceNumber) return [];
    return foreignFeedInvoicesOf(this.database, orderId, {
      number: proforma.invoiceNumber,
      reference: proforma.reference,
      issuedOn: proforma.createdAt,
    });
  }

  async proformaPaymentFacts(documentNumber: string): Promise<{
    paidAmount: Prisma.Decimal;
    grossAmount: Prisma.Decimal;
    currency: string;
    cancelled: boolean;
  } | null> {
    return this.database.externalBillingDocument.findFirst({
      where: { documentNumber },
      select: {
        paidAmount: true,
        grossAmount: true,
        currency: true,
        cancelled: true,
      },
    });
  }

  /**
   * EGY VÁZLAT TÖRLÉSE (kártya 6a75f15c): a döntés a `draftDeleteRefusal`-é, itt az olvasás és az írás egy tranzakcióban. A sor
   * KAPCSOLATAI NEM MARADNAK LÓGVA: a mérföldkő, amelynek ez a díjbekérője volt, felszabadul (új díjbekérő készülhet rá; a mérföldkő
   * hivatkozása `Restrict`, tehát nélküle a törlés el sem indulna), a tételek és a levelezési rekordok vele mennek, és a törlésről
   * auditnapló-sor készül. Az írás feltételes (állapot, sorszám, `updatedAt`): ha közben mentették vagy kiállítás indult, a tranzakció
   * visszagördül, és `STALE` a válasz.
   */
  async deleteDraft(input: {
    id: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
  }): Promise<DraftDeleteRefusal | null> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const row = await transaction.invoice.findFirst({
          where: { id: input.id, ...OWN_ROWS },
          select: {
            id: true,
            status: true,
            invoiceNumber: true,
            updatedAt: true,
            documentType: true,
            partnerName: true,
            reference: true,
            quoteMilestone: { select: { id: true } },
          },
        });
        if (!row)
          return { code: "NOT_FOUND", message: "A bizonylat nem található." };
        const referencedBy = await transaction.invoice.count({
          where: {
            OR: [
              { referencedInvoiceId: input.id },
              { proformaInvoiceId: input.id },
            ],
          },
        });
        const refusal = draftDeleteRefusal(
          row,
          referencedBy,
          input.expectedUpdatedAt,
        );
        if (refusal) return refusal;
        if (row.quoteMilestone)
          await transaction.quotePaymentMilestone.update({
            where: { id: row.quoteMilestone.id },
            data: { proformaInvoiceId: null },
          });
        await transaction.invoiceLine.deleteMany({
          where: { invoiceId: input.id },
        });
        const removed = await transaction.invoice.deleteMany({
          where: {
            id: input.id,
            ...OWN_ROWS,
            status: "DRAFT",
            invoiceNumber: null,
            updatedAt: input.expectedUpdatedAt,
          },
        });
        // közben mentették vagy kiállítás indult: a mérföldkő-felszabadítás és a tételek törlése is visszagördül
        if (removed.count !== 1) throw new DraftChangedDuringDelete();
        await transaction.auditLog.create({
          data: {
            action: "billing.draft_deleted",
            entityType: "Invoice",
            entityId: input.id,
            userId: input.actorUserId,
            metadata: {
              documentType: row.documentType,
              partnerName: row.partnerName,
              reference: row.reference,
              releasedQuoteMilestoneId: row.quoteMilestone?.id ?? null,
            },
          },
        });
        return null;
      });
    } catch (error) {
      if (error instanceof DraftChangedDuringDelete)
        return {
          code: "STALE",
          message:
            "A vázlatot időközben más is mentette, vagy a kiállítása elindult. Töltsd újra, és nézd meg, mi változott.",
        };
      throw error;
    }
  }

  /**
   * Kifizették-e a számot a Számlázz.hu feedje szerint: `true` kifizetés van,
   * `false` a feed tudja, és nincs, `null` nincs feed-sora vagy nem vetített.
   */
  async feedPaid(documentNumber: string): Promise<boolean | null> {
    const twin = await this.database.externalBillingDocument.findFirst({
      where: { documentNumber },
      select: { paymentsKnown: true, paidAmount: true },
    });
    if (!twin) return null;
    if (twin.paidAmount.gt(0)) return true;
    return twin.paymentsKnown === true ? false : null;
  }

  /**
   * ELINDULT VAGY KÉSZ SZTORNÓJA VAN-E (ISSUING vagy ISSUED). A végszámla
   * kiállítása a saját foglalása UTÁN ezzel olvassa vissza az előleget: a
   * folyamatban lévő sztornó is számít, mert a kiállítás alatt kimehet.
   */
  async stornoStarted(invoiceId: string): Promise<boolean> {
    const storno = await this.database.invoice.findFirst({
      where: {
        referencedInvoiceId: invoiceId,
        documentType: "STORNO",
        status: { in: ["ISSUING", "ISSUED"] },
      },
      select: { id: true },
    });
    return storno !== null;
  }

  /** Az előlegszámlából készült végszámla, ha van (számlázási brief, 3.). */
  finalInvoiceOf(advanceId: string): Promise<{
    id: string;
    invoiceNumber: string | null;
    status: string;
    /** A végszámla kiállított sztornója (legfeljebb egy). */
    correctionInvoices: { id: string }[];
  } | null> {
    return this.database.invoice.findFirst({
      where: {
        referencedInvoiceId: advanceId,
        documentType: "FINAL_INVOICE",
        ...OWN_ROWS,
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        correctionInvoices: {
          where: { documentType: "STORNO", status: "ISSUED" },
          select: { id: true },
        },
      },
    });
  }

  /** A bizonylat teljes lánca (díjbekérő, előleg, végszámla, sztornó); üres, ha nincs kapcsolódója. */
  related(id: string): Promise<RelatedBillingDocuments> {
    return loadRelatedBillingDocuments(this.database, id);
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
    /** Díjbekérőből készült előlegnél a díjbekérő (számlázási brief, 2. pont). */
    proformaInvoiceId?: string | null;
    /** Végszámlánál a levont előlegszámla (számlázási brief, 3. pont). */
    referencedInvoiceId?: string | null;
  }): Promise<{ created: boolean }> {
    try {
      await this.database.$transaction((transaction) =>
        insertBillingDraft(transaction, input),
      );
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
