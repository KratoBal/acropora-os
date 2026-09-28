import { Prisma, prisma } from "@acropora/database";
import { Injectable } from "@nestjs/common";

/**
 * A `DecisionRun` TABLA ES A VETULET BEMENETEHEZ KELLO OLVASASOK.
 *
 * A DOMAIN TABLAKAT (eszkoz, kategoria) CSAK OLVASSA: a Jev-javaslat soha nem
 * ir kategoriat (PD-005: nincs automatikus iras).
 */

export interface RunKey {
  readonly policyKey: string;
  readonly policyVersion: number;
  readonly clientOperationId: string;
  readonly projectionHash: string;
  readonly optionsHash: string;
  readonly requestedModel: string;
}

export interface StoredRun {
  readonly id: string;
  readonly projectionHash: string;
  readonly selectedValue: string | null;
  readonly confidence: number | null;
  readonly exposure: "HIDDEN" | "SHOWN";
  readonly status: "OK" | "ERROR";
  readonly resolution: string | null;
}

const FUTAS = {
  id: true,
  projectionHash: true,
  selectedValue: true,
  confidence: true,
  exposure: true,
  status: true,
  resolution: true,
} as const;

export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
}

@Injectable()
export class DecisionRunRepository {
  async activeCategories(): Promise<readonly CategoryRow[]> {
    return prisma.assetCategory.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async unitName(id: string): Promise<string | null> {
    const sor = await prisma.unitOfMeasure.findUnique({
      where: { id },
      select: { name: true },
    });
    return sor?.name ?? null;
  }

  /** A szulo eszkoz KATEGORIAJANAK neve -- nem a szulo neve (P-004). */
  async parentCategoryName(parentAssetId: string): Promise<string | null> {
    const sor = await prisma.asset.findUnique({
      where: { id: parentAssetId },
      select: { categoryRef: { select: { name: true } } },
    });
    return sor?.categoryRef?.name ?? null;
  }

  /** A reszleg-utvonal kodjai a gyokertol, korvedelemmel. */
  async departmentPath(departmentId: string): Promise<string[]> {
    const kodok: string[] = [];
    const latott = new Set<string>();
    let kovetkezo: string | null = departmentId;
    while (kovetkezo && !latott.has(kovetkezo) && latott.size < 20) {
      latott.add(kovetkezo);
      const sor: { code: string; parentId: string | null } | null =
        await prisma.worksheetDepartment.findUnique({
          where: { id: kovetkezo },
          select: { code: true, parentId: true },
        });
      if (!sor) break;
      kodok.unshift(sor.code);
      kovetkezo = sor.parentId;
    }
    return kodok;
  }

  /** A mentett eszkoz vetuletenek bemenete -- a feloldas ezt hash-eli. */
  async savedAsset(assetId: string) {
    return prisma.asset.findUnique({
      where: { id: assetId },
      select: {
        name: true,
        manufacturer: true,
        model: true,
        kind: true,
        performance: true,
        performanceUnitId: true,
        powerConsumption: true,
        parentAssetId: true,
        departmentId: true,
        categoryId: true,
      },
    });
  }

  async findRun(key: RunKey): Promise<StoredRun | null> {
    return prisma.decisionRun.findUnique({
      where: {
        policyKey_policyVersion_clientOperationId_projectionHash_optionsHash_requestedModel:
          key,
      },
      select: FUTAS,
    });
  }

  /**
   * A MAS VETULETRE SZOLO, MEG NYITOTT FUTASOK STALE-LESZNEK (P-013): a
   * felhasznalo a javaslat utan modositotta a mezoket, tehat a Jev mast latott.
   * Az aktualis vetulet futasa, ha korabban STALE lett (visszairta a mezot),
   * ujra nyitott.
   */
  async markOthersStale(
    key: Omit<RunKey, "projectionHash" | "optionsHash" | "requestedModel">,
    currentRunId: string,
    now: Date,
  ): Promise<void> {
    await prisma.$transaction([
      prisma.decisionRun.updateMany({
        where: {
          policyKey: key.policyKey,
          policyVersion: key.policyVersion,
          clientOperationId: key.clientOperationId,
          entityId: null,
          resolution: null,
          NOT: { id: currentRunId },
        },
        data: { resolution: "STALE", resolvedAt: now },
      }),
      prisma.decisionRun.updateMany({
        where: { id: currentRunId, entityId: null, resolution: "STALE" },
        data: { resolution: null, resolvedAt: null },
      }),
    ]);
  }

  async createRun(
    data: Prisma.DecisionRunUncheckedCreateInput,
  ): Promise<StoredRun> {
    return prisma.decisionRun.create({ data, select: FUTAS });
  }

  /** A menteskor feloldando futas: az urlap legutobbi, meg nyitott futasa. */
  async openRunForOperation(
    policyKey: string,
    policyVersion: number,
    clientOperationId: string,
  ): Promise<StoredRun | null> {
    return prisma.decisionRun.findFirst({
      where: {
        policyKey,
        policyVersion,
        clientOperationId,
        entityId: null,
        resolution: null,
      },
      orderBy: { createdAt: "desc" },
      select: FUTAS,
    });
  }

  async resolveRun(
    id: string,
    data: {
      entityType: string;
      entityId: string;
      resolution:
        | "ACCEPTED"
        | "OVERRIDDEN"
        | "SHADOW_MATCH"
        | "SHADOW_MISMATCH"
        | "STALE"
        | null;
      resolvedValue: string | null;
      resolvedAt: Date;
    },
  ): Promise<void> {
    await prisma.decisionRun.update({ where: { id }, data });
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
