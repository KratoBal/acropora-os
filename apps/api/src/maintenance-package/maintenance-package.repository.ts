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
    const job = await this.database.serviceJob.findFirst({
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
              select: { id: true, closedAt: true, subject: true },
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
            /*
              CSAK A VALÓDI KIÁLLÍTÁS SZÁMÍT ITT -- egy DRAFT (előnézeti)
              piszkozat NEM elégíti ki a küldés kapuját (ADR-014, 4. szelet):
              a `completionCertificateId @unique` miatt legfeljebb egy sor
              lehet, ezért a `where` egyben a "van-e valódi számla" kérdésre
              is válaszol, nem csak szűr.
            */
            invoices: {
              where: { status: "ISSUED" },
              select: { id: true, invoiceNumber: true },
            },
          },
        },
      },
    });
    if (!job) return null;
    if (!job.completionCertificate)
      return { ...job, completionCertificate: null };
    // THE CERTIFICATE'S TWO COPIES, one query each with `take 1` semantics (Luca, 2026-11-18; barracuda, #2696 review): the SIGNED one goes into the package, the ISSUED one when there is
    // no signed one. A single select over both types would load the BYTES of every uploaded signed copy (the upload can be repeated) into memory; the service picks signed else issued.
    const certificateId = job.completionCertificate.id;
    const latest = (type: "SIGNED_FORM" | "GENERATED_FORM") =>
      this.database.completionCertificateDocument.findFirst({
        where: { certificateId, type },
        orderBy: { createdAt: "desc" },
        select: {
          type: true,
          fileName: true,
          contentType: true,
          content: true,
        },
      });
    const documents = (
      await Promise.all([latest("SIGNED_FORM"), latest("GENERATED_FORM")])
    ).filter(
      (document): document is NonNullable<typeof document> => document !== null,
    );
    return {
      ...job,
      completionCertificate: { ...job.completionCertificate, documents },
    };
  }
}
