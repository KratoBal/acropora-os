import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";
import type {
  BillingDeliveryOutcome,
  BillingEmailMode,
  BillingEmailRecipients,
  BillingEmailStatus,
} from "@acropora/types";

import { AUDIT_ACTION, MODE_FROM } from "./billing-document-email.js";
import { OWN_ROWS } from "./billing-documents.repository.js";

/**
 * A KIKÜLDÉS ÍRÓ OLDALA. A foglalás feltételes (`emailStatus` a mód szerinti
 * állapotok egyike -> `SENDING`), tehát két egyidejű kattintásból egy levél
 * lesz. A kimenet egy tranzakció: a kézbesítési sor, az új állapot és az
 * auditnapló eseménye együtt kerül be, vagy egyik sem.
 */
@Injectable()
export class BillingDocumentEmailRepository {
  private readonly database = prisma;

  deliveryByRequestId(requestId: string) {
    return this.database.billingDocumentMailDelivery.findUnique({
      where: { requestId },
      select: { invoiceId: true },
    });
  }

  async claim(id: string, mode: BillingEmailMode): Promise<boolean> {
    const claimed = await this.database.invoice.updateMany({
      where: {
        id,
        ...OWN_ROWS,
        status: "ISSUED",
        OR: MODE_FROM[mode].map((emailStatus) => ({ emailStatus })),
      },
      data: { emailStatus: "SENDING" },
    });
    return claimed.count === 1;
  }

  async finish(input: {
    id: string;
    requestId: string;
    mode: BillingEmailMode;
    userId: string;
    previousEmailStatus: BillingEmailStatus | null;
    recipients: BillingEmailRecipients;
    subject: string;
    outcome: BillingDeliveryOutcome;
    error: string | null;
  }): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.billingDocumentMailDelivery.create({
        data: {
          invoiceId: input.id,
          requestId: input.requestId,
          initiatedByUserId: input.userId,
          recipients: input.recipients as unknown as Prisma.InputJsonValue,
          subject: input.subject,
          outcome: input.outcome,
          error: input.error,
        },
      });
      await transaction.invoice.update({
        where: { id: input.id },
        data: { emailStatus: input.outcome === "SENT" ? "SENT" : "FAILED" },
      });
      await transaction.auditLog.create({
        data: {
          userId: input.userId,
          action: AUDIT_ACTION[input.mode],
          entityType: "Invoice",
          entityId: input.id,
          metadata: {
            requestId: input.requestId,
            recipients: input.recipients,
            previousEmailStatus: input.previousEmailStatus,
            outcome: input.outcome,
            error: input.error,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
}
