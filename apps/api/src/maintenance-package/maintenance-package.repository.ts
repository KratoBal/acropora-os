import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";

import { WORKSHEET_ISSUED_SHEET_TYPES } from "@acropora/types";

/** A munkalap oszlopai a csomaghoz: a szám, a legutóbbi verzió, és a kiadott PDF-ek (a lapon létrehozott és a hozzárendelt lapra ugyanaz). */
const PACKAGE_WORKSHEET_SELECT = {
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
} satisfies Prisma.WorksheetSelect;

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
          select: PACKAGE_WORKSHEET_SELECT,
        },
        /*
          A HOZZÁRENDELT (KAPCSOLÓDÓ) MUNKALAPOK (kártya 5b366f5d; Luca kérése 2026-11-25, kártya 5afb868a): a lapon létrehozottak
          mellett ezek kiadott PDF-je is a csomagba kerül, ugyanazzal a kapuval. Belső (PARTNERS_MANAGE) hatókör: nincs partner-egység szűrő.
        */
        linkedWorksheets: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { worksheet: { select: PACKAGE_WORKSHEET_SELECT } },
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
              piszkozat NEM elégíti ki a küldés kapuját (ADR-014, 4. szelet).
              2026-11-26 óta egy igazoláshoz több számla is tartozhat (sztornó
              után új), de ÉLŐ (fel nem váltott) legfeljebb egy: a migráció
              részleges egyedi indexe tartja. A `where` ezért az élő kiállított
              számlát kéri, rendezve, egyet.
            */
            invoices: {
              // the LIVE issued invoice (2026-11-26: a cancelled one superseded by a new invoice on the same certificate is history)
              where: { status: "ISSUED", supersededAt: null },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
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
