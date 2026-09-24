import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { WORKSHEET_ISSUED_SHEET_TYPES } from "@acropora/types";

@Injectable()
export class MaintenancePackageRepository {
  private readonly database = prisma;

  /**
   * A KARBANTARTÁSI LAP, A CSOMAGHOZ KELLŐ MÉLYSÉGBEN.
   *
   * `kind: "MAINTENANCE"` A `where`-BEN, NEM UTÓLAGOS ELLENŐRZÉSKÉNT: egy
   * REPAIR jegyre hívva ez a lekérdezés `null`-t ad, a szolgáltatás pedig
   * `NotFoundException`-t dob -- ugyanúgy, ahogy egy nem létező azonosítóra
   * is. A karbantartási csomagnak nincs értelmezhető válasza egy hibajegyre.
   */
  async packageData(id: string) {
    return this.database.serviceJob.findFirst({
      where: { id, kind: "MAINTENANCE" },
      select: {
        id: true,
        jobNumber: true,
        customerId: true,
        worksheets: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            number: true,
            hiddenAt: true,
            versions: {
              orderBy: { version: "desc" },
              take: 1,
              select: { id: true, closedAt: true },
            },
            documents: {
              where: { type: { in: [...WORKSHEET_ISSUED_SHEET_TYPES] } },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: {
                id: true,
                worksheetVersionId: true,
                type: true,
                fileName: true,
                contentType: true,
                content: true,
                storageKey: true,
              },
            },
          },
        },
        maintenanceOrder: {
          select: {
            id: true,
            number: true,
            documents: {
              where: { type: "SIGNED_FORM" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { fileName: true, contentType: true, content: true },
            },
          },
        },
        completionCertificate: {
          select: {
            id: true,
            number: true,
            documents: {
              where: { type: "SIGNED_FORM" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { fileName: true, contentType: true, content: true },
            },
          },
        },
      },
    });
  }
}
