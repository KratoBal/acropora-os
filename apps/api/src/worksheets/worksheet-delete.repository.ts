import { Injectable } from "@nestjs/common";

import { prisma, type Prisma } from "@acropora/database";

import type { StoredDocumentRef } from "../service-jobs/service-job-delete.repository.js";
import type { WorksheetDeleteFacts } from "./worksheet-delete.rules.js";

/**
 * AZ ÖNÁLLÓ MUNKALAP VÉGLEGES TÖRLÉSÉNEK TÁROLÓJA (a hibajegy-törlés 2. szelete; acrobot 55770). A tényeket és a törlést adja, a törlés EGY tranzakcióban újraolvassa a tényeket
 * (egy közben aláírt lap a törlést visszagörgeti). A munkalap törlése kaszkáddal viszi a verziókat és aláírásaikat, a tételeket, a csatolmányokat, az eszközöket, a delegáltakat és az
 * anyagigényeket (a séma FK-kártyájából mérve, lásd a jegy-törlés tárolóját); az egyetlen nem kaszkád él az önhivatkozás (`continuesWorksheetId`, `Restrict`): ha a lap egy MÁSIK lapot
 * folytat, a törlés után ez a hivatkozás vele együtt megszűnik, ha a lapot egy másik folytatja, a szabály tilt.
 */
export class WorksheetDeleteRefused extends Error {}

export interface WorksheetDeleteSnapshot {
  id: string;
  label: string;
  facts: WorksheetDeleteFacts;
  counts: { documents: number; materialRequests: number };
}

const PROCURED = [
  "IN_PROGRESS",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
] as const;

type Db = Prisma.TransactionClient | typeof prisma;

async function readSnapshot(
  db: Db,
  id: string,
): Promise<WorksheetDeleteSnapshot | null> {
  const sheet = await db.worksheet.findUnique({
    where: { id },
    select: {
      id: true,
      serviceJobId: true,
      number: true,
      handedOverAt: true,
      versions: {
        orderBy: { version: "desc" },
        select: { status: true, subject: true },
      },
      _count: { select: { documents: true } },
    },
  });
  if (!sheet) return null;
  const [continuedBy, procured, requests, stockMovements] = await Promise.all([
    db.worksheet.count({ where: { continuesWorksheetId: id } }),
    db.materialRequest.count({
      where: { worksheetId: id, status: { in: [...PROCURED] } },
    }),
    db.materialRequest.count({ where: { worksheetId: id } }),
    db.stockMovement.count({
      where: {
        referenceType: { in: ["Worksheet", "MaterialRequest"] },
        referenceId: { equals: id },
      },
    }),
  ]);
  return {
    id: sheet.id,
    label: sheet.number ?? sheet.versions[0]?.subject ?? sheet.id.slice(0, 8),
    facts: {
      hasServiceJob: sheet.serviceJobId !== null,
      number: sheet.number,
      handedOver: sheet.handedOverAt !== null,
      signed: sheet.versions.some((version) => version.status === "SIGNED"),
      awaitingSignature: sheet.versions[0]?.status === "AWAITING_SIGNATURE",
      continuedByOther: continuedBy > 0,
      procuredMaterialRequests: procured,
      stockMovements,
    },
    counts: { documents: sheet._count.documents, materialRequests: requests },
  };
}

@Injectable()
export class WorksheetDeleteRepository {
  private readonly database = prisma;

  snapshot(id: string): Promise<WorksheetDeleteSnapshot | null> {
    return readSnapshot(this.database, id);
  }

  /** A törlés; `null`, ha a lap közben eltűnt; a tiltás `WorksheetDeleteRefused`, és semmit nem ír. */
  async remove(input: {
    id: string;
    actorUserId: string;
    refusal: (facts: WorksheetDeleteFacts) => string | null;
  }): Promise<{
    label: string;
    counts: WorksheetDeleteSnapshot["counts"];
    stored: StoredDocumentRef[];
  } | null> {
    return this.database.$transaction(async (tx) => {
      const snapshot = await readSnapshot(tx, input.id);
      if (!snapshot) return null;
      const refusal = input.refusal(snapshot.facts);
      if (refusal) throw new WorksheetDeleteRefused(refusal);

      const stored: StoredDocumentRef[] = (
        await tx.worksheetDocument.findMany({
          where: { worksheetId: input.id, storageKey: { not: null } },
          select: { id: true },
        })
      ).map((row) => ({
        owner: "worksheet" as const,
        ownerId: input.id,
        documentId: row.id,
      }));

      // a beszélgetés marad, csak a kötése oldódik
      await tx.conversation.updateMany({
        where: { contextType: "WORKSHEET", contextId: input.id },
        data: { contextType: null, contextId: null },
      });
      await tx.worksheet.delete({ where: { id: input.id } });
      await tx.auditLog.create({
        data: {
          action: "service.worksheet_deleted",
          entityType: "Worksheet",
          entityId: input.id,
          userId: input.actorUserId,
          metadata: {
            label: snapshot.label,
            documents: snapshot.counts.documents,
            materialRequests: snapshot.counts.materialRequests,
          },
        },
      });
      return { label: snapshot.label, counts: snapshot.counts, stored };
    });
  }
}
