import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  WEBSHOP_STALE_THRESHOLD_DEFAULTS,
  type BillingDocumentStatus,
  type WebshopStaleThreshold,
  type WebshopTransferReceipt,
} from "@acropora/types";

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

/**
 * AZ OS SAJÁT NYOMA A WEBSHOP RENDELÉSEKEN. A státuszváltást a webshop
 * `admin` szereplőként rögzíti, név nélkül; KI nyomta meg, azt csak az OS
 * tudja, ezért az auditnaplóba itt kerül.
 */
@Injectable()
export class WebshopOrdersRepository {
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
   * A RENDELÉSEK SZÁMLÁI. Rendelésenként a legutóbbi `WEBSHOP_ORDER` forrású
   * számla (a vázlat azonosítója rendelésenként egy, tehát a gyakorlatban
   * egyetlen sor). Ugyanez adja a szállítólevelet is (`DELIVERY_NOTE`).
   */
  async invoices(
    orderIds: string[],
    documentType: "INVOICE" | "DELIVERY_NOTE" | "PROFORMA" = "INVOICE",
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
   * A SZÁMLÁZZ.HU ÁLTAL KIÁLLÍTOTT SZÁMLA A RENDELÉSHEZ (bb3a6bd5): a
   * kifizetett díjbekérőből az Autokassza állítja ki, a kimenő továbbítás
   * hozza be. A kötés szabálya `linkExternalInvoices`; itt csak a bemenete áll
   * össze: a rendelések kiállított díjbekérői, a díjbekérő napja óta kelt
   * kimenő számlák, és hogy melyik nyers üzenet nevezi meg a díjbekérő számát.
   * `paid`: a számla a saját kifizetései szerint ki van egyenlítve.
   */
  async externalInvoices(
    orderIds: string[],
  ): Promise<
    Map<
      string,
      LinkedExternalInvoice & { paid: boolean; paidOn: string | null }
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
    const documents = await prisma.externalBillingDocument.findMany({
      where: { issueDate: { gte: sinceDate } },
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
          },
        ];
      }),
    );
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
      | "split"
      | "shipping-method-changed";
    before: unknown;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: `webshop-order.${input.action}`,
        entityType: "WebshopOrder",
        entityId: input.orderId,
        metadata: { before: input.before } as Prisma.InputJsonValue,
      },
    });
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
