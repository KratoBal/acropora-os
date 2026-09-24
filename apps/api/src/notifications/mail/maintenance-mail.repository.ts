import { Injectable } from "@nestjs/common";

import { prisma } from "@acropora/database";

import type { MaintenanceMailRecipient } from "./maintenance-mail-recipients.js";

@Injectable()
export class MaintenanceMailRepository {
  /**
   * A LAP, ÉS A SZERZŐDÉSES VEVŐJE.
   *
   * `kind: "MAINTENANCE"` SZŰRÉSSEL: egy hibajegyre hívva `null`-t ad, a
   * szolgáltatás pedig `no-job`-ot -- ugyanúgy, ahogy egy nem létező
   * azonosítóra is. A karbantartási csomag levele nem értelmezhető
   * hibajegyre.
   */
  async jobForMail(serviceJobId: string) {
    return prisma.serviceJob.findFirst({
      where: { id: serviceJobId, kind: "MAINTENANCE" },
      select: { id: true, jobNumber: true, customerId: true },
    });
  }

  async recipients(customerId: string): Promise<MaintenanceMailRecipient[]> {
    const rows = await prisma.user.findMany({
      where: { customerId, isActive: true },
      select: { email: true, displayName: true, isActive: true },
      orderBy: { displayName: "asc" },
    });
    return rows.map((row) => ({
      email: row.email,
      displayName: row.displayName,
      isActive: row.isActive,
    }));
  }

  async recordDelivery(input: {
    serviceJobId: string;
    jobNumber: string;
    initiatedByUserId: string | null;
    subject: string;
    recipients: readonly { email: string; name: string }[];
    attachmentBytes: number;
    outcome: string;
    error?: string | null;
  }) {
    await prisma.maintenanceMailDelivery.create({
      data: {
        serviceJobId: input.serviceJobId,
        jobNumber: input.jobNumber,
        initiatedByUserId: input.initiatedByUserId,
        subject: input.subject,
        recipients: input.recipients as unknown as object,
        attachmentBytes: input.attachmentBytes,
        outcome: input.outcome,
        error: input.error ?? null,
      },
    });
  }
}
