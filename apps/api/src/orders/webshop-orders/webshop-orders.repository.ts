import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { BillingDocumentStatus } from "@acropora/types";

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
   * egyetlen sor).
   */
  async invoices(
    orderIds: string[],
  ): Promise<Map<string, WebshopOrderInvoiceRow>> {
    if (!orderIds.length) return new Map();
    const rows = await prisma.invoice.findMany({
      where: {
        sourceType: "WEBSHOP_ORDER",
        sourceId: { in: orderIds },
        documentType: "INVOICE",
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
