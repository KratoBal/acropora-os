import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  WEBSHOP_STALE_THRESHOLD_DEFAULTS,
  type BillingDocumentStatus,
  type WebshopStaleThreshold,
  type WebshopBalanceReceipt,
  type WebshopTransferReceipt,
} from "@acropora/types";

import { isPartnerMirror } from "../../customers/customers.repository.js";
import {
  euKey,
  huBase,
} from "../../partner-duplicates/partner-duplicate-groups.js";
import {
  WEBSHOP_ADVANCE_TAG,
  tagsWithAdvance,
  type OrderTaxKey,
} from "./webshop-order-invoice.rules.js";
import { foreignFeedInvoicesOf } from "./webshop-foreign-feed-invoices.js";
import { shortageCountsOf } from "./webshop-orders.rules.js";

import {
  linkExternalInvoices,
  mentionsNumber,
  type LinkProforma,
  type LinkedExternalInvoice,
} from "./webshop-external-invoice-link.js";

/** Egy rendelés számlája az OS-ben: a `WEBSHOP_ORDER` forrású bizonylat. */
export interface WebshopOrderInvoiceRow {
  id: string;
  status: BillingDocumentStatus;
  number: string | null;
}

export interface WebshopOrderProformaRow {
  id: string;
  status: BillingDocumentStatus;
  number: string | null;
  dueDate: Date | null;
  emailStatus: string | null;
  grossAmount?: Prisma.Decimal | null;
}

/** A webshop vevőinek kötése: `ExternalReference(MEDUSA, "Customer")`. */
const CUSTOMER_REFERENCE = {
  system: "MEDUSA",
  entityType: "Customer",
} as const;

/** A kapu felülbírálásának naplósora: külön `action`, hogy külön szűrhető legyen. */
export const SHIPPING_OVERRIDE_ACTION =
  "webshop-order.shipping-gate-overridden";

/** A személyes kiszállítás naplósora (Luca, 2026-11-20): saját `action`, hogy ne keveredjen a felülbírálással ("ki kerülte meg a kaput" kontra "ki vitte ki személyesen"). */
export const PERSONAL_DELIVERY_ACTION = "webshop-order.personal-delivery";

export type ShippingOverrideTrace = {
  /** Melyik kivétel: a felülbírálás (alapértelmezés) vagy a személyes kiszállítás; ez dönti el a napló `action`-jét. */
  kind?: "override" | "personal";
  userId: string;
  orderId: string;
  from: string | null;
  to: string;
  reason: string;
  missing: string[];
};

const shippingTraceAction = (input: ShippingOverrideTrace) =>
  input.kind === "personal"
    ? PERSONAL_DELIVERY_ACTION
    : SHIPPING_OVERRIDE_ACTION;

const shippingOverrideMetadata = (
  input: ShippingOverrideTrace,
  status: "requested" | "applied",
) => ({
  status,
  from: input.from,
  to: input.to,
  reason: input.reason,
  missing: input.missing,
});

/**
 * AZ OS SAJÁT NYOMA A WEBSHOP RENDELÉSEKEN. A státuszváltást a webshop
 * `admin` szereplőként rögzíti, név nélkül; KI nyomta meg, azt csak az OS
 * tudja, ezért az auditnaplóba itt kerül.
 */
@Injectable()
export class WebshopOrdersRepository {
  /** A STÁTUSZVÁLTÁS NAPLÓJA: egy sor, `webshop-order.status-changed`, a váltás UTÁN. */
  async recordStatusChange(input: {
    userId: string;
    orderId: string;
    from: string | null;
    to: string;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: "webshop-order.status-changed",
        entityType: "WebshopOrder",
        entityId: input.orderId,
        metadata: { from: input.from, to: input.to },
      },
    });
  }

  /**
   * A KISZÁLLÍTÁSI KAPU FELÜLBÍRÁLÁSÁNAK NYOMA (kártya 33a0d3c7, barracuda #2724; a minta az ajándékkártya-kiadás, #2739). A sor a
   * webshop-hívás ELŐTT íródik `requested` állapottal (ki, honnan hová, az indok, mi hiányzott), és ha nem íródik meg, a lépés nem
   * indul: egy megkerült kapu nem maradhat név és indok nélkül (a levonás lefuthat, és az újrapróbálás már más ágra futna). Külön
   * `action`, hogy szűrhető legyen ("ki kerülte meg a kaput és miért"). Visszaadja a sor azonosítóját az `applied`-re állításhoz.
   */
  async requestShippingOverride(input: ShippingOverrideTrace): Promise<string> {
    const row = await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: shippingTraceAction(input),
        entityType: "WebshopOrder",
        entityId: input.orderId,
        metadata: shippingOverrideMetadata(input, "requested"),
      },
      select: { id: true },
    });
    return row.id;
  }

  /** A webshop elfogadta a váltást: a `requested` sor `applied` lesz (a tartalma ugyanaz). Ha ez bukik, a hívó csak naplózza. */
  async markShippingOverrideApplied(
    rowId: string,
    input: ShippingOverrideTrace,
  ): Promise<void> {
    await prisma.auditLog.update({
      where: { id: rowId },
      data: { metadata: shippingOverrideMetadata(input, "applied") },
    });
  }

  /** Egy tételművelet: ki, melyik tételen, mit (a webshop „admin” névvel rögzíti). */
  async recordLineEdit(input: {
    userId: string;
    orderId: string;
    itemId: string;
    title: string;
    before: number;
    edit: { kind: string; quantity?: number; variantId?: string };
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: "webshop-order.line-edited",
        entityType: "WebshopOrder",
        entityId: input.orderId,
        metadata: {
          itemId: input.itemId,
          title: input.title,
          before: input.before,
          ...input.edit,
        },
      },
    });
  }

  /**
   * AZ ELAVULÁSI KÜSZÖBÖK: a beállított sor, ahol van, különben az alapérték.
   * Mindig mind a négy státusz, a prompt sorrendjében.
   */
  async staleThresholds(): Promise<WebshopStaleThreshold[]> {
    const rows = await prisma.webshopOrderStaleThreshold.findMany();
    const stored = new Map(rows.map((row) => [row.status, row]));
    return WEBSHOP_STALE_THRESHOLD_DEFAULTS.map((fallback) => {
      const row = stored.get(fallback.status);
      return row
        ? {
            status: fallback.status,
            value: row.value,
            unit: row.unit,
            enabled: row.enabled,
          }
        : { ...fallback };
    });
  }

  /** A küszöbök mentése egy tranzakcióban, ki mentette (auditnapló, előtte és utána). */
  async saveStaleThresholds(
    thresholds: WebshopStaleThreshold[],
    userId: string,
  ): Promise<void> {
    const before = await this.staleThresholds();
    await prisma.$transaction([
      ...thresholds.map((threshold) =>
        prisma.webshopOrderStaleThreshold.upsert({
          where: { status: threshold.status },
          create: { ...threshold, updatedByUserId: userId },
          update: {
            value: threshold.value,
            unit: threshold.unit,
            enabled: threshold.enabled,
            updatedByUserId: userId,
          },
        }),
      ),
      prisma.auditLog.create({
        data: {
          userId,
          action: "webshop-order.stale-thresholds-saved",
          entityType: "WebshopOrderStaleThreshold",
          entityId: "all",
          metadata: {
            before,
            after: thresholds,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);
  }

  /** A lejáró zárolás gombjai: ki nyomta meg, melyiket, és mi lett a levéllel. */
  async recordPaymentAction(input: {
    userId: string;
    orderId: string;
    action: "release-hold" | "payment-link";
    mail: { sent: boolean; reason?: string };
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action:
          input.action === "release-hold"
            ? "webshop-order.hold-released"
            : "webshop-order.payment-link-sent",
        entityType: "WebshopOrder",
        entityId: input.orderId,
        metadata: input.mail,
      },
    });
  }

  /** Átállítás előre utalásra (kártya d31a66a3): ki nyomta, honnan, lekerült-e az utánvét-díj. */
  async recordTransferSwitch(input: {
    userId: string;
    orderId: string;
    from: string | null;
    removedCodFee: boolean;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: "webshop-order.switched-to-transfer",
        entityType: "WebshopOrder",
        entityId: input.orderId,
        metadata: { from: input.from, removedCodFee: input.removedCodFee },
      },
    });
  }

  /** A státuszlevél újraküldése: ki kérte, és mi lett a sorsa. */
  async recordStatusMailResent(input: {
    userId: string;
    orderId: string;
    mail: { sent: boolean; reason?: string };
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: "webshop-order.status-mail-resent",
        entityType: "WebshopOrder",
        entityId: input.orderId,
        metadata: input.mail,
      },
    });
  }

  /** A bizonytalan csomag-foglalás feloldása: ki engedte újra a létrehozást. */
  async recordParcelReleased(input: {
    userId: string;
    orderId: string;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: "webshop-order.parcel-reservation-released",
        entityType: "WebshopOrder",
        entityId: input.orderId,
      },
    });
  }

  /**
   * A SZÁLLÍTÓ VÁRATLAN VÁLASZA, TÁBLÁBAN (kártya 6077cda9, task t-20261116-foxpost-kulcsnevek; acrobot 53880).
   *
   * Az éles Foxpost csomag-létrehozás válaszának kulcsneve nem mért, és a kliens a hiányzó `barcode` esetén a kulcsneveket
   * naplóba írja: a napló viszont csak az aktuális konténeré, és minden telepítés újat indít, tehát a bizonyíték elvész. Az
   * `AuditLog` tábla nincs ürítve és nem kell hozzá migráció. A `detail` CSAK kulcsneveket és a `set`/`empty` jelzést hordozza (a
   * kliens szerződése), értéket (csomagszám, név, cím) nem.
   */
  async recordCarrierUnexpectedResponse(input: {
    userId: string | null;
    orderId: string;
    operation: string;
    carrier: string | null;
    detail: string | null;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: "webshop-order.carrier-unexpected-response",
        entityType: "WebshopOrder",
        entityId: input.orderId,
        metadata: {
          operation: input.operation,
          carrier: input.carrier,
          detail: input.detail,
        },
      },
    });
  }

  /**
   * A RENDELÉSEK SZÁMLÁI. Rendelésenként a legutóbbi `WEBSHOP_ORDER` forrású
   * számla (a vázlat azonosítója rendelésenként egy, tehát a gyakorlatban
   * egyetlen sor). Ugyanez adja a szállítólevelet is (`DELIVERY_NOTE`).
   */
  async invoices(
    orderIds: string[],
    documentType:
      | "INVOICE"
      | "DELIVERY_NOTE"
      | "PROFORMA"
      | "ADVANCE_INVOICE"
      | "FINAL_INVOICE" = "INVOICE",
  ): Promise<Map<string, WebshopOrderInvoiceRow>> {
    if (!orderIds.length) return new Map();
    const rows = await prisma.invoice.findMany({
      where: {
        sourceType: "WEBSHOP_ORDER",
        sourceId: { in: orderIds },
        documentType,
      },
      select: { id: true, sourceId: true, status: true, invoiceNumber: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const result = new Map<string, WebshopOrderInvoiceRow>();
    for (const row of rows)
      if (row.sourceId)
        result.set(row.sourceId, {
          id: row.id,
          status: row.status as BillingDocumentStatus,
          number: row.invoiceNumber,
        });
    return result;
  }

  /**
   * THE DOCUMENT THAT INVOICES THE ORDER (card d31a66a3, S4): its invoice, or, after an advance, its ISSUED final invoice. The
   * invoice step, the parcel's release, the delivery note and the list read the order's invoice from here, so an OS-issued
   * final invoice closes them as an invoice does (the OS's own documents are not linked back from the feed, S2). A final
   * invoice draft does not count: until it is issued the order is not invoiced. The advance invoice never counts here.
   */
  async settlingInvoices(
    orderIds: string[],
  ): Promise<Map<string, WebshopOrderInvoiceRow>> {
    const [invoices, finals] = await Promise.all([
      this.invoices(orderIds),
      this.invoices(orderIds, "FINAL_INVOICE"),
    ]);
    const result = new Map(invoices);
    for (const [orderId, row] of finals)
      if (!result.has(orderId) && row.status === "ISSUED")
        result.set(orderId, row);
    return result;
  }

  /**
   * A SZÁMLÁZZ.HU ÁLTAL KIÁLLÍTOTT SZÁMLA A RENDELÉSHEZ (bb3a6bd5): a
   * kifizetett díjbekérőből az Autokassza állítja ki, a kimenő továbbítás
   * hozza be. A kötés szabálya `linkExternalInvoices`; itt csak a bemenete áll
   * össze: a rendelések kiállított díjbekérői, a díjbekérő napja óta kelt
   * kimenő számlák, és hogy melyik nyers üzenet nevezi meg a díjbekérő számát.
   * `paid`: a számla a saját kifizetései szerint ki van egyenlítve.
   */
  async externalInvoices(orderIds: string[]): Promise<
    Map<
      string,
      LinkedExternalInvoice & {
        paid: boolean;
        paidOn: string | null;
        /** The feed's kind: SZ invoice, ES advance, VS final (the parcel gate opens on SZ and VS only). */
        kindCode: string;
      }
    >
  > {
    if (!orderIds.length) return new Map();
    const proformas = await prisma.invoice.findMany({
      where: {
        sourceType: "WEBSHOP_ORDER",
        sourceId: { in: orderIds },
        documentType: "PROFORMA",
        status: "ISSUED",
        invoiceNumber: { not: null },
        grossAmount: { not: null },
      },
      select: {
        sourceId: true,
        invoiceNumber: true,
        reference: true,
        partnerName: true,
        grossAmount: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const input: LinkProforma[] = proformas.flatMap((row) =>
      row.sourceId && row.invoiceNumber && row.grossAmount
        ? [
            {
              orderId: row.sourceId,
              number: row.invoiceNumber,
              reference: row.reference,
              partnerName: row.partnerName,
              grossAmount: row.grossAmount.toFixed(4),
              issuedOn: row.createdAt.toISOString().slice(0, 10),
            },
          ]
        : [],
    );
    if (!input.length) return new Map();
    const since = input.reduce(
      (min, row) => (row.issuedOn < min ? row.issuedOn : min),
      input[0]!.issuedOn,
    );
    const sinceDate = new Date(`${since}T00:00:00Z`);
    /*
      THE OS'S OWN DOCUMENTS ARE NOT "EXTERNAL" (card d31a66a3, S2; the plan's 4th risk). An invoice or advance invoice the OS issued
      for the order comes back through the outgoing feed as its twin, with the order number on it, and would link here as the
      Számlázz.hu's invoice: the step would look done, and an advance would open the parcel. The order's own numbers are left out.
    */
    const ownNumbers = (
      await prisma.invoice.findMany({
        where: {
          sourceType: "WEBSHOP_ORDER",
          sourceId: { in: orderIds },
          invoiceNumber: { not: null },
          documentType: { not: "PROFORMA" },
        },
        select: { invoiceNumber: true },
      })
    ).flatMap((row) => (row.invoiceNumber ? [row.invoiceNumber] : []));
    const documents = await prisma.externalBillingDocument.findMany({
      where: {
        issueDate: { gte: sinceDate },
        ...(ownNumbers.length ? { documentNumber: { notIn: ownNumbers } } : {}),
      },
      select: {
        id: true,
        externalId: true,
        kindCode: true,
        documentNumber: true,
        orderNumber: true,
        customerName: true,
        grossAmount: true,
        paidAmount: true,
        lastPaymentDate: true,
        issueDate: true,
        cancelled: true,
      },
    });
    if (!documents.length) return new Map();
    // a díjbekérő száma a nyers üzenetben, bármelyik mezőben
    const mentions = new Map<string, string[]>();
    for (const proforma of input) {
      const messages = await prisma.szamlazzFeedMessage.findMany({
        where: {
          kind: "SZAMLAKI",
          receivedAt: { gte: sinceDate },
          body: { contains: proforma.number },
        },
        select: { externalId: true, body: true },
      });
      for (const message of messages.filter((m) =>
        mentionsNumber(m.body, proforma.number),
      ))
        mentions.set(message.externalId, [
          ...(mentions.get(message.externalId) ?? []),
          proforma.number,
        ]);
    }
    const linked = linkExternalInvoices(
      input,
      documents.map((doc) => ({
        id: doc.id,
        kindCode: doc.kindCode,
        documentNumber: doc.documentNumber,
        orderNumber: doc.orderNumber,
        customerName: doc.customerName,
        grossAmount: doc.grossAmount.toFixed(2),
        issueDate: doc.issueDate.toISOString().slice(0, 10),
        cancelled: doc.cancelled,
        mentions: mentions.get(doc.externalId) ?? [],
      })),
    );
    const byId = new Map(documents.map((doc) => [doc.id, doc]));
    return new Map(
      [...linked].map(([orderId, link]) => {
        const doc = byId.get(link.id)!;
        return [
          orderId,
          {
            ...link,
            paid: doc.grossAmount.gt(0) && doc.paidAmount.gte(doc.grossAmount),
            paidOn: doc.lastPaymentDate
              ? doc.lastPaymentDate.toISOString().slice(0, 10)
              : null,
            kindCode: doc.kindCode.toUpperCase(),
          },
        ];
      }),
    );
  }

  /**
   * AZ AKTÍV KÉSZLETHIÁNYOK a megadott rendelésekre (card ac167fc2): rendelésenként a nyitott (OPEN) és a megállapodott (AGREED) hiányok
   * száma. EGY kötegelt olvasás az oldal összes azonosítójára; hiány nélküli rendelés nincs a térképben.
   */
  async activeShortages(
    orderIds: string[],
  ): Promise<Map<string, { open: number; agreed: number }>> {
    if (!orderIds.length) return new Map();
    const rows = await prisma.webshopOrderShortage.groupBy({
      by: ["orderId", "status"],
      where: {
        orderId: { in: orderIds },
        status: { in: ["OPEN", "AGREED"] },
      },
      _count: { _all: true },
    });
    return shortageCountsOf(rows);
  }

  /**
   * AZ ELŐRE UTALÁS BEÉRKEZÉSEI (bb3a6bd5), rendelésenként; kézi rögzítésnél
   * a rögzítő megjelenítendő nevével.
   */
  async transferReceipts(
    orderIds: string[],
  ): Promise<Map<string, WebshopTransferReceipt>> {
    if (!orderIds.length) return new Map();
    const rows = await prisma.webshopTransferReceipt.findMany({
      where: { orderId: { in: orderIds } },
    });
    const userIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.recordedByUserId ? [row.recordedByUserId] : [],
        ),
      ),
    ];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true },
        })
      : [];
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    // the paid proforma's own mark says whether the transfer was an advance (`WEBSHOP_ADVANCE_TAG`, as `receiptProformaIsAdvance`)
    const proformas = rows.length
      ? await prisma.invoice.findMany({
          where: { id: { in: rows.map((row) => row.proformaId) } },
          select: { id: true, tags: true },
        })
      : [];
    const advance = new Set(
      proformas
        .filter((row) => row.tags.includes(WEBSHOP_ADVANCE_TAG))
        .map((row) => row.id),
    );
    return new Map(
      rows.map((row) => [
        row.orderId,
        {
          source: row.source,
          receivedOn: row.receivedOn.toISOString().slice(0, 10),
          reference: row.reference,
          amount: row.amount.toFixed(4),
          currency: row.currency,
          recordedBy: row.recordedByUserId
            ? (names.get(row.recordedByUserId) ?? null)
            : null,
          advance: advance.has(row.proformaId),
        },
      ]),
    );
  }

  /**
   * THE BALANCE RECEIPTS AFTER AN ADVANCE (card d31a66a3, S3), per order, with the recording person's display name.
   */
  async balanceReceipts(
    orderIds: string[],
  ): Promise<Map<string, WebshopBalanceReceipt>> {
    if (!orderIds.length) return new Map();
    const rows = await prisma.webshopBalanceReceipt.findMany({
      where: { orderId: { in: orderIds } },
    });
    const userIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.recordedByUserId ? [row.recordedByUserId] : [],
        ),
      ),
    ];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true },
        })
      : [];
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    return new Map(
      rows.map((row) => [
        row.orderId,
        {
          source: row.source,
          receivedOn: row.receivedOn.toISOString().slice(0, 10),
          reference: row.reference,
          amount: row.amount.toFixed(4),
          currency: row.currency,
          recordedBy: row.recordedByUserId
            ? (names.get(row.recordedByUserId) ?? null)
            : null,
        },
      ]),
    );
  }

  /**
   * THE BALANCE'S RECEIPT (card d31a66a3, S3). One per order, after the order's (advance) receipt (the foreign key): a second one
   * answers `false` and writes nothing (the person and a later bank pairing race; the first wins), as `createTransferReceipt`.
   */
  async createBalanceReceipt(input: {
    orderId: string;
    source: "BANK_PAIRING" | "MANUAL";
    bankTransactionId: string | null;
    reference: string;
    receivedOn: string;
    amount: Prisma.Decimal;
    currency: string;
    recordedByUserId: string | null;
  }): Promise<boolean> {
    try {
      await prisma.webshopBalanceReceipt.create({
        data: {
          ...input,
          receivedOn: new Date(`${input.receivedOn}T00:00:00Z`),
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return false;
      throw error;
    }
  }

  /**
   * THE ADVANCE INVOICE DRAFT'S DAYS (card d31a66a3, S2): fulfilled and due on the day the advance came in. Only on a draft, as
   * `linkInvoiceProforma`; answers whether it wrote (a write moves `updatedAt`, which the issue checks).
   */
  async setDraftDays(invoiceId: string, day: string): Promise<boolean> {
    const row = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, fulfillmentDate: true, dueDate: true },
    });
    const date = new Date(`${day}T00:00:00.000Z`);
    if (
      !row ||
      row.status !== "DRAFT" ||
      (row.fulfillmentDate?.getTime() === date.getTime() &&
        row.dueDate?.getTime() === date.getTime())
    )
      return false;
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { fulfillmentDate: date, dueDate: date },
    });
    return true;
  }

  /**
   * The proforma the order's recorded transfer paid, with what the Autokassza check needs of it (`null`: no transfer
   * recorded). The day is the proforma's creation, the same day `externalInvoices` links from.
   */
  async transferReceiptProforma(orderId: string): Promise<{
    id: string;
    number: string | null;
    reference: string | null;
    issuedOn: Date;
  } | null> {
    const row = await prisma.webshopTransferReceipt.findUnique({
      where: { orderId },
      select: { proformaId: true },
    });
    if (!row) return null;
    const proforma = await prisma.invoice.findUnique({
      where: { id: row.proformaId },
      select: { invoiceNumber: true, reference: true, createdAt: true },
    });
    return proforma
      ? {
          id: row.proformaId,
          number: proforma.invoiceNumber,
          reference: proforma.reference,
          issuedOn: proforma.createdAt,
        }
      : null;
  }

  /**
   * THE ORDER INVOICE DRAFT NAMES THE PROFORMA IT SETTLES (card d31a66a3, S1): Számlázz.hu gets its number
   * (`dijbekeroSzamlaszam`) and takes the proforma as settled. Only on a draft, as `markProformaAdvance`; answers whether it
   * wrote, since a write moves the draft's `updatedAt`, which the issue checks.
   */
  async linkInvoiceProforma(
    invoiceId: string,
    proformaId: string,
  ): Promise<boolean> {
    const row = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { proformaInvoiceId: true, status: true },
    });
    if (!row || row.status !== "DRAFT" || row.proformaInvoiceId === proformaId)
      return false;
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { proformaInvoiceId: proformaId },
    });
    return true;
  }

  /** The Autokassza check's input for this order (`foreignFeedInvoicesOf`, shared with the billing issue). */
  foreignFeedInvoices(
    orderId: string,
    proforma: { number: string; reference: string | null; issuedOn: Date },
  ): Promise<string[]> {
    return foreignFeedInvoicesOf(prisma, orderId, proforma);
  }

  /**
   * A BEÉRKEZÉS RÖGZÍTÉSE. Rendelésenként egy sor: ha már van, `false`, és
   * nem ír (a párosítás és a kézi gomb versenyében az első nyer).
   */
  async createTransferReceipt(input: {
    orderId: string;
    proformaId: string;
    source: "BANK_PAIRING" | "MANUAL";
    bankTransactionId: string | null;
    reference: string;
    receivedOn: string;
    amount: Prisma.Decimal;
    currency: string;
    recordedByUserId: string | null;
  }): Promise<boolean> {
    try {
      await prisma.webshopTransferReceipt.create({
        data: {
          ...input,
          receivedOn: new Date(`${input.receivedOn}T00:00:00Z`),
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return false;
      throw error;
    }
  }

  /** Akiknél a „Webshop befizetés-felelős” értesítési szerep be van jelölve. */
  async transferRecipients(): Promise<string[]> {
    const rows = await prisma.userNotificationRole.findMany({
      where: { role: "WEBSHOP_TRANSFER_RECEIVED", user: { isActive: true } },
      select: { userId: true },
      orderBy: { userId: "asc" },
    });
    return rows.map((row) => row.userId);
  }

  /** Whether the order's recorded transfer paid an advance proforma (the document's own mark, `WEBSHOP_ADVANCE_TAG`). */
  async receiptProformaIsAdvance(orderId: string): Promise<boolean> {
    const receipt = await prisma.webshopTransferReceipt.findUnique({
      where: { orderId },
      select: { proformaId: true },
    });
    if (!receipt) return false;
    const proforma = await prisma.invoice.findUnique({
      where: { id: receipt.proformaId },
      select: { tags: true },
    });
    return proforma?.tags.includes(WEBSHOP_ADVANCE_TAG) ?? false;
  }

  /**
   * The proforma draft's advance mark (card 2c5fbfb5): set when the window was opened for an advance, cleared when for the whole
   * order. Only on a draft: an issued proforma keeps what it was issued as. Answers whether it wrote: a write moves the draft's
   * `updatedAt`, and the caller then reads the fresh one (the issue checks it).
   */
  async markProformaAdvance(
    proformaId: string,
    advance: boolean,
  ): Promise<boolean> {
    const row = await prisma.invoice.findUnique({
      where: { id: proformaId },
      select: { tags: true, status: true },
    });
    if (!row || row.status !== "DRAFT") return false;
    const tags = tagsWithAdvance(row.tags, advance);
    // no write when the mark is already so: a write moves the draft's `updatedAt`, which the issue checks
    if (
      tags.length === row.tags.length &&
      tags.every((tag) => row.tags.includes(tag))
    )
      return false;
    await prisma.invoice.update({
      where: { id: proformaId },
      data: { tags },
    });
    return true;
  }

  /** A díjbekérő bruttó összege és devizája (a kézi rögzítés ezt írja be). */
  async proformaAmount(
    proformaId: string,
  ): Promise<{ amount: Prisma.Decimal; currency: string } | null> {
    const row = await prisma.invoice.findUnique({
      where: { id: proformaId },
      select: { grossAmount: true, currency: true },
    });
    return row?.grossAmount
      ? { amount: row.grossAmount, currency: row.currency }
      : null;
  }

  /**
   * A RENDELÉSEK DÍJBEKÉRŐJE (bb3a6bd5): rendelésenként a legújabb, a
   * határidejével és a kiküldés állapotával. A lista a lejárt díjbekérőt
   * jelöli, ezért egy lekérdezés megy az egész oldalra.
   */
  async proformas(
    orderIds: string[],
  ): Promise<Map<string, WebshopOrderProformaRow>> {
    if (!orderIds.length) return new Map();
    const rows = await prisma.invoice.findMany({
      where: {
        sourceType: "WEBSHOP_ORDER",
        sourceId: { in: orderIds },
        documentType: "PROFORMA",
      },
      select: {
        id: true,
        sourceId: true,
        status: true,
        invoiceNumber: true,
        dueDate: true,
        emailStatus: true,
        grossAmount: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const result = new Map<string, WebshopOrderProformaRow>();
    for (const row of rows)
      if (row.sourceId)
        result.set(row.sourceId, {
          id: row.id,
          status: row.status as BillingDocumentStatus,
          number: row.invoiceNumber,
          dueDate: row.dueDate,
          emailStatus: row.emailStatus,
          grossAmount: row.grossAmount,
        });
    return result;
  }

  /** A webshop-vevő kulcsához kötött OS-partner adatlapja (az adatlap „Vevő adatlapja” gombja). */
  async osCustomerByKey(key: string): Promise<{
    id: string;
    customerNumber: string;
    displayName: string;
  } | null> {
    const id = await this.customerByKey(key);
    if (!id) return null;
    return prisma.customer.findUnique({
      where: { id },
      select: { id: true, customerNumber: true, displayName: true },
    });
  }

  /** A rendelés belső megjegyzése, ha van. */
  async internalNote(
    orderId: string,
  ): Promise<{ text: string; updatedAt: string } | null> {
    const row = await prisma.webshopOrderNote.findUnique({
      where: { orderId },
    });
    return row
      ? { text: row.text, updatedAt: row.updatedAt.toISOString() }
      : null;
  }

  /** A belső megjegyzés mentése (üres szöveg: törlés), ki írta, auditnaplóban. */
  async saveInternalNote(orderId: string, text: string, userId: string) {
    await prisma.$transaction([
      text
        ? prisma.webshopOrderNote.upsert({
            where: { orderId },
            create: { orderId, text, updatedByUserId: userId },
            update: { text, updatedByUserId: userId },
          })
        : prisma.webshopOrderNote.deleteMany({ where: { orderId } }),
      prisma.auditLog.create({
        data: {
          userId,
          action: "webshop-order.internal-note-saved",
          entityType: "WebshopOrder",
          entityId: orderId,
          metadata: { length: text.length },
        },
      }),
    ]);
  }

  /** Egy cím szerkesztése: ki, melyiket, és mi volt előtte. */
  /** Ki cserélte a csomagpontot vagy írta át a megjegyzéseket, és mi volt előtte. */
  async recordOrderEdit(input: {
    userId: string;
    orderId: string;
    action:
      | "pickup-point-changed"
      | "notes-edited"
      | "loyalty-adjusted"
      | "manual-refund-settled"
      | "split"
      | "shipping-method-changed";
    before: unknown;
    /** Plus mezok a naplosorra (a `before` mellett), pl. a KESEI potlas jelzese; a `before` nem irhato felul. */
    extra?: Record<string, unknown>;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: `webshop-order.${input.action}`,
        entityType: "WebshopOrder",
        entityId: input.orderId,
        metadata: {
          ...(input.extra ?? {}),
          before: input.before,
        } as Prisma.InputJsonValue,
      },
    });
  }

  /** Van-e mar az OS-ben ilyen rendeles-szerkesztesi naplosor (a keso potlas ebbol dont). */
  async hasOrderEdit(orderId: string, action: "manual-refund-settled") {
    const row = await prisma.auditLog.findFirst({
      where: {
        action: `webshop-order.${action}`,
        entityType: "WebshopOrder",
        entityId: orderId,
      },
      select: { id: true },
    });
    return row !== null;
  }

  async recordAddressEdit(input: {
    userId: string;
    orderId: string;
    kind: "billing" | "shipping";
    before: unknown;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: `webshop-order.${input.kind}-address-edited`,
        entityType: "WebshopOrder",
        entityId: input.orderId,
        metadata: { before: input.before } as Prisma.InputJsonValue,
      },
    });
  }

  /** A webshop-vevő kulcsához kötött OS-partner, ha van. */
  async customerByKey(key: string): Promise<string | null> {
    const reference = await prisma.externalReference.findUnique({
      where: {
        system_entityType_externalId: {
          ...CUSTOMER_REFERENCE,
          externalId: key,
        },
      },
      select: { entityId: true },
    });
    return reference?.entityId ?? null;
  }

  /**
   * AZ AKTÍV OS-PARTNEREK EZZEL AZ E-MAIL CÍMMEL (kis- és nagybetű nélkül), és
   * hogy van-e már webshop-kötésük. Egy partnernek egy kötése lehet (az
   * `ExternalReference` egyedi a rendszer, típus és partner hármasán).
   */
  async customersByEmail(
    email: string,
  ): Promise<{ id: string; displayName: string; linked: boolean }[]> {
    const rows = await prisma.customer.findMany({
      where: {
        email: { equals: email, mode: "insensitive" },
        archivedAt: null,
        isActive: true,
      },
      select: { id: true, displayName: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!rows.length) return [];
    const linked = new Set(
      (
        await prisma.externalReference.findMany({
          where: {
            ...CUSTOMER_REFERENCE,
            entityId: { in: rows.map((row) => row.id) },
          },
          select: { entityId: true },
        })
      ).map((row) => row.entityId),
    );
    return rows.map((row) => ({ ...row, linked: linked.has(row.id) }));
  }

  /**
   * A VEVŐK AZ ADÓSZÁM KULCSA SZERINT (kártya c499739d): a magyar adószám első nyolc számjegye vagy a közösségi adószám, ugyanazzal a
   * szabállyal, mint a duplikátum-mérés. A jelölteket az adatbázis szűri (magyar: a nyolc számjegyet tartalmazó adószám; közösségi: ahol
   * van közösségi adószám), a PONTOS egyezést a `huBase` és az `euKey` dönti el, mert az adószám tárolt alakja szabad (`15509246-2-41`,
   * `HU15509246`, `DE 123 456 789`).
   */
  async customersByTaxKey(key: OrderTaxKey): Promise<
    {
      id: string;
      displayName: string;
      linked: boolean;
      /** a sor egy partner vevő-tükre (`Supplier.customerId`): a számla ezt tekinti a jó vevőnek */
      partnerMirror: boolean;
    }[]
  > {
    const candidates = await prisma.customer.findMany({
      where: {
        archivedAt: null,
        isActive: true,
        ...(key.kind === "HU"
          ? { taxNumber: { contains: key.value } }
          : { euTaxNumber: { not: null } }),
      },
      select: {
        id: true,
        displayName: true,
        taxNumber: true,
        euTaxNumber: true,
        partner: { select: { id: true, deletedAt: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const rows = candidates.filter((row) =>
      key.kind === "HU"
        ? huBase(row.taxNumber) === key.value
        : euKey(row.euTaxNumber) === key.value,
    );
    if (!rows.length) return [];
    const linked = new Set(
      (
        await prisma.externalReference.findMany({
          where: {
            ...CUSTOMER_REFERENCE,
            entityId: { in: rows.map((row) => row.id) },
          },
          select: { entityId: true },
        })
      ).map((row) => row.entityId),
    );
    return rows.map(({ id, displayName, partner }) => ({
      id,
      displayName,
      linked: linked.has(id),
      // a TÖRÖLT partner sora ismét sima vevő-sor (ugyanaz a definíció, mint a vevő-listán és a szerkesztés tiltásán)
      partnerMirror: isPartnerMirror(partner),
    }));
  }

  /**
   * A KÖTÉS. Ha a kulcsot közben más kötötte be (egyedi megkötés), az ő
   * partnerét adjuk vissza: a két kérés ugyanazt a vevőt kapja.
   */
  async linkCustomer(customerId: string, key: string): Promise<string> {
    try {
      await prisma.externalReference.create({
        data: { ...CUSTOMER_REFERENCE, entityId: customerId, externalId: key },
      });
      return customerId;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.customerByKey(key);
        if (existing) return existing;
      }
      throw error;
    }
  }

  /**
   * A PARTNER SZÁMLÁZÁSI ADATAI, ugyanazzal a cím-választással, amivel a
   * kiállítás a vevőt rögzíti (`billing-document-issue.ts`): a számlára ez
   * kerül, nem a rendelés címe.
   */
  async customerBuyer(id: string): Promise<{
    name: string;
    taxNumber: string | null;
    postalCode: string | null;
    city: string | null;
    line: string | null;
  } | null> {
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: {
        displayName: true,
        companyName: true,
        taxNumber: true,
        addresses: {
          select: {
            type: true,
            isDefault: true,
            postalCode: true,
            city: true,
            line1: true,
            line2: true,
          },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        },
      },
    });
    if (!customer) return null;
    const addresses = customer.addresses;
    const chosen =
      addresses.find((a) => a.type === "BILLING" && a.isDefault) ??
      addresses.find((a) => a.type === "BILLING") ??
      addresses.find((a) => a.isDefault) ??
      addresses[0];
    return {
      name: customer.companyName?.trim() || customer.displayName,
      taxNumber: customer.taxNumber,
      postalCode: chosen?.postalCode ?? null,
      city: chosen?.city ?? null,
      line: chosen
        ? [chosen.line1, chosen.line2].filter(Boolean).join(", ")
        : null,
    };
  }
}
