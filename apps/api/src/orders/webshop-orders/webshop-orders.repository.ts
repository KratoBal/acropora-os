import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  WEBSHOP_STALE_THRESHOLD_DEFAULTS,
  type BillingDocumentStatus,
  type WebshopStaleThreshold,
} from "@acropora/types";

/** Egy rendelés számlája az OS-ben: a `WEBSHOP_ORDER` forrású bizonylat. */
export interface WebshopOrderInvoiceRow {
  id: string;
  status: BillingDocumentStatus;
  number: string | null;
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
    documentType: "INVOICE" | "DELIVERY_NOTE" = "INVOICE",
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
