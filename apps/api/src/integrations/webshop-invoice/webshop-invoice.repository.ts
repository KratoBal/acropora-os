import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Repository, prisma } from "@acropora/database";

import type { InvoiceCandidate } from "./webshop-invoice.rules.js";

const SELECT = {
  id: true,
  direction: true,
  status: true,
  documentType: true,
  pdfStorageKey: true,
  invoiceNumber: true,
  issueDate: true,
} as const;

/** A vendég számla-letöltésének adatai: a webshop rendelés számlái, a sztornók, az egyszer használatos tokenek. */
@Injectable()
export class WebshopInvoiceRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /** Egy webshop rendelés (a Medusa azonosítója) bizonylatai. */
  candidatesOf(orderId: string): Promise<InvoiceCandidate[]> {
    return this.database.invoice.findMany({
      where: { sourceType: "WEBSHOP_ORDER", sourceId: orderId },
      select: SELECT,
    });
  }

  /** Egy bizonylat, de CSAK ha ehhez a rendeléshez tartozik (a token a rendelésre és a számlára szól). */
  candidate(
    invoiceId: string,
    orderId: string,
  ): Promise<InvoiceCandidate | null> {
    return this.database.invoice.findFirst({
      where: { id: invoiceId, sourceType: "WEBSHOP_ORDER", sourceId: orderId },
      select: SELECT,
    });
  }

  /** A megadott számlák közül a sztornózottak (kiállított STORNO sor hivatkozik rájuk). */
  async stornoedAmong(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.database.invoice.findMany({
      where: {
        documentType: "STORNO",
        status: "ISSUED",
        referencedInvoiceId: { in: [...ids] },
      },
      select: { referencedInvoiceId: true },
    });
    return new Set(
      rows.flatMap((row) =>
        row.referencedInvoiceId ? [row.referencedInvoiceId] : [],
      ),
    );
  }

  /**
   * A token beváltása: a `jti` egyedi, tehát a második használat ütközik, és `false`. A napló (DomainEvent) ugyanebben a
   * tranzakcióban íródik, így sikeres letöltés naplózás nélkül, naplózás letöltés nélkül nem lehet. Az esemény csak
   * azonosítókat hordoz: se nevet, se e-mailt.
   */
  async redeem(
    jti: string,
    orderId: string,
    invoiceId: string,
  ): Promise<boolean> {
    try {
      await this.database.$transaction(async (tx) => {
        await tx.webshopInvoiceDownload.create({
          data: { jti, orderId, invoiceId },
        });
        await tx.domainEvent.create({
          data: {
            id: randomUUID(),
            eventType: "webshop.invoice.downloaded",
            aggregateType: "WebshopOrder",
            aggregateId: orderId,
            actorUserId: null,
            payload: { invoiceId, jti },
            occurredAt: new Date(),
            schemaVersion: 1,
          },
        });
      });
      return true;
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "P2002") return false;
      throw error;
    }
  }
}
