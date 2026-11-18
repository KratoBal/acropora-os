import { Injectable } from "@nestjs/common";

import { prisma, type Prisma } from "@acropora/database";

import type {
  ServiceJobDeleteFacts,
  ServiceJobDeleteSheetFacts,
} from "./service-job-delete.rules.js";

/**
 * A HIBAJEGY VÉGLEGES TÖRLÉSÉNEK TÁROLÓJA (Balázs, 2026-11-18; acrobot 55766, 55770). Két dolgot ad: a törlés TÉNYEIT (amiből a tiszta szabály dönt), és magát a törlést,
 * EGY tranzakcióban, a tények ÚJRAOLVASÁSÁVAL a tranzakción belül (egy közben aláírt munkalap vagy kiállított igazolás a törlést visszagörgeti, nem
 * "az előnézet még zöld volt").
 *
 * MI TÖRLŐDIK ÉS MI NEM, A SÉMA FK-KÁRTYÁJÁBÓL MÉRVE (mind a `ServiceJob`, mind a `Worksheet` kaszkád-zárlata): a jegy alól kaszkáddal megy az eszköz,
 * a delegált, a szerződéstétel, a csatolmány, az esemény; a munkalapok alól a verziók és aláírásaik, a tételek, a csatolmányok, az eszközök, a delegáltak,
 * az anyagigények (tételek, megjegyzések, események). A munkalap `continuesWorksheetId` önhivatkozása `Restrict`: törlés előtt nullázzuk.
 * NEM törlődik, SZÁNDÉKOSAN: a levél-kézbesítési napló (`TicketMailDelivery`, `MaintenanceMailDelivery`: egy kiküldött levél nyoma a séma szerint akkor is
 * megmarad, ha a jegy sora eltűnik), a műveleti napló sora (az FK `SetNull`), és a beszélgetés (csak a jegyhez kötését oldjuk, a szöveg megmarad).
 */
export class ServiceJobDeleteRefused extends Error {}

/**
 * SOROSÍTHATÓ TRANZAKCIÓ, ÉS EZ NEM DÍSZ (barracuda, #2693 review): az alapértelmezett (READ COMMITTED) tranzakcióban a tényolvasás nem zár ki egy EGYIDEJŰ aláírást. Ha az aláírás a mi
 * olvasásunk UTÁN, de a törlés ELŐTT commitol, a `DELETE` a sorzárra vár, majd a már ALÁÍRT verziót és az aláírást is kaszkáddal törölné. Serializable alatt az egyidejű írás a mi olvasott
 * soraink közé sorosítási hibát (P2034) ad, a törlés elmarad, és a hívó újrapróbálhat (a szolgáltatás ezt 409-re képezi).
 */
export const SERIALIZABLE = { isolationLevel: "Serializable" as const };

export interface ServiceJobDeleteSnapshot {
  id: string;
  jobNumber: string;
  title: string;
  facts: ServiceJobDeleteFacts;
  counts: {
    worksheets: number;
    documents: number;
    materialRequests: number;
  };
}

/** A tárolóba írt csatolmányok (a törlés UTÁN, a tranzakción kívül kell őket a tárolóból is kivenni). */
export interface StoredDocumentRef {
  owner: "service-job" | "worksheet";
  ownerId: string;
  documentId: string;
}

const PROCURED_REQUEST_STATUSES = [
  "IN_PROGRESS",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
] as const;
const STOCK_REFERENCE_TYPES = ["ServiceJob", "Worksheet", "MaterialRequest"];

type Db = Prisma.TransactionClient;

@Injectable()
export class ServiceJobDeleteRepository {
  private readonly database = prisma;

  /** A jegy tényei; `null`, ha nincs ilyen jegy. */
  snapshot(id: string): Promise<ServiceJobDeleteSnapshot | null> {
    return readSnapshot(this.database, id);
  }

  /**
   * A TÖRLÉS. A tényeket a tranzakción belül újraolvassa, és ha a `refusal` mondatot ad, `ServiceJobDeleteRefused`-et dob (a tranzakció nem ír semmit).
   * Visszaadja a törölt jegyet és a tárolóból utólag kiveendő csatolmányokat; `null`, ha a jegy közben eltűnt.
   */
  async remove(input: {
    id: string;
    actorUserId: string;
    refusal: (facts: ServiceJobDeleteFacts) => string | null;
    /** CSAK TESZTHEZ: a tényolvasás UTÁN, a törlés ELŐTT fut (a versenyteszt itt írja be az egyidejű aláírást). */
    afterRead?: () => Promise<void>;
  }): Promise<{
    jobNumber: string;
    counts: ServiceJobDeleteSnapshot["counts"];
    stored: StoredDocumentRef[];
  } | null> {
    return this.database.$transaction(async (tx) => {
      const snapshot = await readSnapshot(tx, input.id);
      if (!snapshot) return null;
      const refusal = input.refusal(snapshot.facts);
      if (refusal) throw new ServiceJobDeleteRefused(refusal);
      await input.afterRead?.();

      const sheets = await tx.worksheet.findMany({
        where: { serviceJobId: input.id },
        select: { id: true },
      });
      const sheetIds = sheets.map((sheet) => sheet.id);

      const stored: StoredDocumentRef[] = [
        ...(
          await tx.serviceJobDocument.findMany({
            where: { serviceJobId: input.id, storageKey: { not: null } },
            select: { id: true },
          })
        ).map((row) => ({
          owner: "service-job" as const,
          ownerId: input.id,
          documentId: row.id,
        })),
        ...(sheetIds.length
          ? await tx.worksheetDocument.findMany({
              where: {
                worksheetId: { in: sheetIds },
                storageKey: { not: null },
              },
              select: { id: true, worksheetId: true },
            })
          : []
        ).map((row) => ({
          owner: "worksheet" as const,
          ownerId: row.worksheetId,
          documentId: row.id,
        })),
      ];

      if (sheetIds.length) {
        // az önhivatkozás Restrict: előbb oldjuk, aztán törlünk
        await tx.worksheet.updateMany({
          where: { id: { in: sheetIds } },
          data: { continuesWorksheetId: null },
        });
        await tx.worksheet.deleteMany({ where: { id: { in: sheetIds } } });
      }
      // a beszélgetés marad, csak a kötése oldódik: a kártya ne mutasson egy nem létező jegyre
      await tx.conversation.updateMany({
        where: {
          OR: [
            { contextType: "SERVICE_JOB", contextId: input.id },
            ...(sheetIds.length
              ? [{ contextType: "WORKSHEET", contextId: { in: sheetIds } }]
              : []),
          ],
        },
        data: { contextType: null, contextId: null },
      });
      await tx.serviceJob.delete({ where: { id: input.id } });
      // a felszabadult szám SOHA nem hasznosul újra: a következő szám a törölt számok táblájából is számol
      await tx.serviceJobDeletion.create({
        data: {
          jobNumber: snapshot.jobNumber,
          deletedById: input.actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "service.job_deleted",
          entityType: "ServiceJob",
          entityId: input.id,
          userId: input.actorUserId,
          metadata: {
            jobNumber: snapshot.jobNumber,
            kind: snapshot.facts.kind,
            status: snapshot.facts.status,
            worksheets: snapshot.counts.worksheets,
            documents: snapshot.counts.documents,
            materialRequests: snapshot.counts.materialRequests,
          },
        },
      });
      return {
        jobNumber: snapshot.jobNumber,
        counts: snapshot.counts,
        stored,
      };
    }, SERIALIZABLE);
  }
}

async function readSnapshot(
  db: Db | typeof prisma,
  id: string,
): Promise<ServiceJobDeleteSnapshot | null> {
  const job = await db.serviceJob.findUnique({
    where: { id },
    select: {
      id: true,
      jobNumber: true,
      title: true,
      status: true,
      kind: true,
      worksheets: {
        select: {
          id: true,
          number: true,
          handedOverAt: true,
          continuesWorksheetId: true,
          versions: {
            orderBy: { version: "desc" },
            select: { status: true },
          },
        },
      },
      completionCertificate: { select: { id: true } },
      maintenanceOrder: { select: { id: true } },
      _count: { select: { documents: true } },
    },
  });
  if (!job) return null;
  const sheetIds = job.worksheets.map((sheet) => sheet.id);

  const [continuedFromOutside, procured, requestCount, stockMovements] =
    await Promise.all([
      sheetIds.length
        ? db.worksheet.findMany({
            where: {
              continuesWorksheetId: { in: sheetIds },
              OR: [{ serviceJobId: null }, { serviceJobId: { not: id } }],
            },
            select: { continuesWorksheetId: true },
          })
        : Promise.resolve([]),
      sheetIds.length
        ? db.materialRequest.count({
            where: {
              worksheetId: { in: sheetIds },
              status: { in: [...PROCURED_REQUEST_STATUSES] },
            },
          })
        : Promise.resolve(0),
      sheetIds.length
        ? db.materialRequest.count({ where: { worksheetId: { in: sheetIds } } })
        : Promise.resolve(0),
      db.stockMovement.count({
        where: {
          referenceType: { in: STOCK_REFERENCE_TYPES },
          referenceId: { in: [id, ...sheetIds] },
        },
      }),
    ]);
  const outside = new Set(
    continuedFromOutside.map((row) => row.continuesWorksheetId),
  );

  const worksheets: ServiceJobDeleteSheetFacts[] = job.worksheets.map(
    (sheet) => ({
      number: sheet.number,
      handedOver: sheet.handedOverAt !== null,
      signed: sheet.versions.some((version) => version.status === "SIGNED"),
      awaitingSignature: sheet.versions[0]?.status === "AWAITING_SIGNATURE",
      continuedFromOutside: outside.has(sheet.id),
    }),
  );
  return {
    id: job.id,
    jobNumber: job.jobNumber,
    title: job.title,
    facts: {
      status: job.status,
      kind: job.kind,
      hasCompletionCertificate: job.completionCertificate !== null,
      hasMaintenanceOrder: job.maintenanceOrder !== null,
      worksheets,
      procuredMaterialRequests: procured,
      stockMovements,
    },
    counts: {
      worksheets: job.worksheets.length,
      documents: job._count.documents,
      materialRequests: requestCount,
    },
  };
}
