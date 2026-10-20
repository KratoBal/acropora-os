import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { isRecommendableOnUnas } from "../../aquariums/recommendation/jev-candidate-source.js";
import { isPrismaErrorCode } from "../../common/prisma-error.util.js";
import { requireInternalWriter } from "../../worksheets/worksheet-internal-write.js";
import {
  doseEffectRefusals,
  type DoseEffectRefusal,
  jevEffectState,
  type JevEffectState,
} from "./dose-effect.rules.js";
import type {
  CreateDoseEffectDto,
  UpdateDoseEffectDto,
  VerifyDoseEffectDto,
} from "./dose-effects.dto.js";

/**
 * THE PRODUCT DOSE LIST (ReefClub plan v6.1, 6.2; slice 7): the OS keeps it,
 * the shop's specialist records and checks it, the JEV may only suggest.
 *
 *   - a row is recorded by one colleague and checked by ANOTHER one; the
 *     check names the version the checker saw, so a row edited in the
 *     meantime is not checked blind (409);
 *   - ANY edit makes a new version and clears the check: the row is not live
 *     until a second colleague checks the new numbers;
 *   - every version is kept (`ProductDoseEffectVersion`), so a recommendation
 *     log (slice 8) can name the version a dose came from;
 *   - a row is withdrawn by archiving, never deleted.
 *
 * Nothing here writes the product: the JEV suggestion reads the enrichment
 * results and answers, it records nothing (the JEV exception: no write to the
 * product master).
 */
export interface DoseEffectView {
  id: string;
  productId: string;
  productName: string;
  parameterCode: string;
  direction: "EMEL" | "CSOKKENT";
  effectPer100L: number;
  doseUnit: "ML" | "G" | "CSEPP";
  doseStep: number;
  maxDailyDosePer100L: number | null;
  effectHours: number | null;
  source: string;
  version: number;
  recordedBy: { id: string; name: string } | null;
  recordedAt: string;
  verifiedBy: { id: string; name: string } | null;
  verifiedAt: string | null;
  archivedAt: string | null;
  usable: boolean;
  refusals: DoseEffectRefusal[];
  /**
   * What the JEV's agreement stands on: VERIFIED (independent sources agree)
   * or UNVERIFIED (only the shop's own data says it). Both count as agreement
   * for the row; slice 8 may ask for VERIFIED.
   */
  jevStatus: JevEffectState["status"];
}

export interface DoseEffectSuggestion {
  productId: string;
  jev: JevEffectState & { sourceRef: string | null };
  /** The JEV's dosing value (`dosing`, Tier C), as a hint for the unit and the daily maximum. */
  dosing: { status: string; value: string } | null;
  /** A row per JEV effect that has no live row yet; the numbers are the colleague's. */
  rows: {
    parameterCode: string;
    direction: "EMEL" | "CSOKKENT";
    source: string | null;
  }[];
}

const ROW_SELECT = {
  id: true,
  productId: true,
  parameterCode: true,
  direction: true,
  effectPer100L: true,
  doseUnit: true,
  doseStep: true,
  maxDailyDosePer100L: true,
  effectHours: true,
  source: true,
  version: true,
  recordedById: true,
  recordedAt: true,
  verifiedById: true,
  verifiedAt: true,
  archivedAt: true,
  recordedBy: { select: { id: true, displayName: true } },
  verifiedBy: { select: { id: true, displayName: true } },
  product: {
    select: {
      name: true,
      isActive: true,
      channelListings: { select: { channel: true, externalStatus: true } },
      unasSnapshot: { select: { rawPayload: true } },
    },
  },
} satisfies Prisma.ProductDoseEffectSelect;

type Row = Prisma.ProductDoseEffectGetPayload<{ select: typeof ROW_SELECT }>;

const NUMERIC_AND_SOURCE_FIELDS = [
  "effectPer100L",
  "doseUnit",
  "doseStep",
  "maxDailyDosePer100L",
  "effectHours",
  "source",
] as const;

@Injectable()
export class DoseEffectsService {
  async listForProduct(productId: string): Promise<DoseEffectView[]> {
    const rows = await prisma.productDoseEffect.findMany({
      where: { productId },
      select: ROW_SELECT,
      orderBy: [{ archivedAt: "asc" }, { parameterCode: "asc" }],
    });
    return this.views(rows);
  }

  /** The whole list, for the maintenance page; archived rows only when asked. */
  async list(query: {
    parameterCode?: string;
    includeArchived?: boolean;
  }): Promise<DoseEffectView[]> {
    const rows = await prisma.productDoseEffect.findMany({
      where: {
        ...(query.parameterCode ? { parameterCode: query.parameterCode } : {}),
        ...(query.includeArchived ? {} : { archivedAt: null }),
      },
      select: ROW_SELECT,
      orderBy: [{ parameterCode: "asc" }, { product: { name: "asc" } }],
      take: 1000,
    });
    return this.views(rows);
  }

  async create(
    productId: string,
    input: CreateDoseEffectDto,
    user: AuthenticatedUser,
  ): Promise<DoseEffectView> {
    requireInternalWriter(user, "Adag-hatás rögzítése");
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException("A termék nem található.");
    const now = new Date();
    const values = numbersOf(input);
    try {
      const id = await prisma.$transaction(async (tx) => {
        const row = await tx.productDoseEffect.create({
          data: {
            productId,
            parameterCode: input.parameterCode,
            direction: input.direction,
            ...values,
            recordedById: user.id,
            recordedAt: now,
          },
          select: { id: true },
        });
        await tx.productDoseEffectVersion.create({
          data: {
            effectId: row.id,
            version: 1,
            ...values,
            recordedById: user.id,
            recordedAt: now,
          },
        });
        return row.id;
      });
      return this.view(id);
    } catch (error) {
      if (isPrismaErrorCode(error, "P2002"))
        throw new ConflictException(
          "Ehhez a termékhez erre a paraméterre és irányra már van élő sor: azt szerkeszd, vagy előbb archiváld.",
        );
      throw error;
    }
  }

  /**
   * An edit: a new version, and the check is cleared (plan 6.2: "egy sor
   * bármely számának szerkesztése törli az ellenőrzést"). The source counts
   * too: the numbers are only as good as where they come from. The editor
   * becomes the recorder of the new version, so they cannot check it.
   */
  async update(
    id: string,
    input: UpdateDoseEffectDto,
    user: AuthenticatedUser,
  ): Promise<DoseEffectView> {
    requireInternalWriter(user, "Adag-hatás szerkesztése");
    const current = await this.live(id);
    if (current.version !== input.expectedVersion)
      throw new ConflictException(
        "A sort közben módosították. Töltsd újra, és nézd át az új értékeket.",
      );
    const next = {
      effectPer100L: input.effectPer100L ?? current.effectPer100L.toNumber(),
      doseUnit: input.doseUnit ?? current.doseUnit,
      doseStep: input.doseStep ?? current.doseStep.toNumber(),
      maxDailyDosePer100L:
        input.maxDailyDosePer100L !== undefined
          ? input.maxDailyDosePer100L
          : (current.maxDailyDosePer100L?.toNumber() ?? null),
      effectHours:
        input.effectHours !== undefined
          ? input.effectHours
          : current.effectHours,
      source: input.source !== undefined ? input.source.trim() : current.source,
    };
    const changed = NUMERIC_AND_SOURCE_FIELDS.some((field) => {
      const before = current[field];
      const after = next[field];
      const plain =
        before instanceof Prisma.Decimal ? before.toNumber() : before;
      return plain !== after;
    });
    if (!changed) return this.view(id);
    const now = new Date();
    const version = current.version + 1;
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.productDoseEffect.updateMany({
        where: { id, version: current.version, archivedAt: null },
        data: {
          ...next,
          version,
          recordedById: user.id,
          recordedAt: now,
          verifiedById: null,
          verifiedAt: null,
        },
      });
      if (count === 0)
        throw new ConflictException(
          "A sort közben módosították. Töltsd újra, és nézd át az új értékeket.",
        );
      await tx.productDoseEffectVersion.create({
        data: {
          effectId: id,
          version,
          ...next,
          recordedById: user.id,
          recordedAt: now,
        },
      });
    });
    return this.view(id);
  }

  /**
   * The check by a SECOND colleague, of the version they saw. The one who
   * recorded the current version cannot check it (the database says the
   * same: `ProductDoseEffect_values_check`).
   */
  async verify(
    id: string,
    input: VerifyDoseEffectDto,
    user: AuthenticatedUser,
  ): Promise<DoseEffectView> {
    requireInternalWriter(user, "Adag-hatás ellenőrzése");
    const current = await this.live(id);
    if (current.version !== input.expectedVersion)
      throw new ConflictException(
        "A sort közben módosították: az új változatot nézd át, és azt ellenőrizd.",
      );
    if (current.recordedById === user.id)
      throw new BadRequestException(
        "A sort nem az ellenőrizheti, aki rögzítette: kell egy második kolléga.",
      );
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.productDoseEffect.updateMany({
        where: { id, version: current.version, archivedAt: null },
        data: { verifiedById: user.id, verifiedAt: now },
      });
      if (count === 0)
        throw new ConflictException(
          "A sort közben módosították: az új változatot nézd át, és azt ellenőrizd.",
        );
      await tx.productDoseEffectVersion.updateMany({
        where: { effectId: id, version: current.version },
        data: { verifiedById: user.id, verifiedAt: now },
      });
    });
    return this.view(id);
  }

  async archive(id: string, user: AuthenticatedUser): Promise<void> {
    requireInternalWriter(user, "Adag-hatás archiválása");
    const { count } = await prisma.productDoseEffect.updateMany({
      where: { id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (count === 0)
      throw new NotFoundException("Az élő adag-hatás sor nem található.");
  }

  async versions(id: string) {
    const rows = await prisma.productDoseEffectVersion.findMany({
      where: { effectId: id },
      orderBy: { version: "desc" },
      select: {
        version: true,
        effectPer100L: true,
        doseUnit: true,
        doseStep: true,
        maxDailyDosePer100L: true,
        effectHours: true,
        source: true,
        recordedAt: true,
        verifiedAt: true,
        recordedBy: { select: { id: true, displayName: true } },
        verifiedById: true,
      },
    });
    if (rows.length === 0)
      throw new NotFoundException("Az adag-hatás sor nem található.");
    return rows.map((row) => ({
      version: row.version,
      effectPer100L: row.effectPer100L.toNumber(),
      doseUnit: row.doseUnit,
      doseStep: row.doseStep.toNumber(),
      maxDailyDosePer100L: row.maxDailyDosePer100L?.toNumber() ?? null,
      effectHours: row.effectHours,
      source: row.source,
      recordedBy: row.recordedBy
        ? { id: row.recordedBy.id, name: row.recordedBy.displayName }
        : null,
      recordedAt: row.recordedAt.toISOString(),
      verifiedById: row.verifiedById,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
    }));
  }

  /**
   * THE JEV'S ROW SUGGESTION (plan 6.2): the parameters and directions its
   * latest result states for the product, the dosing value it found, and the
   * source. One suggested row per effect without a live row. The numbers are
   * left empty on purpose: the JEV knows the direction, not the amount (6.2,
   * "Ami hiányzik", 1). Reads only.
   */
  async suggestion(productId: string): Promise<DoseEffectSuggestion> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException("A termék nem található.");
    const [effects, dosing] = await Promise.all([
      latestJevField(productId, "waterParameterEffects"),
      latestJevField(productId, "dosing"),
    ]);
    const jev = jevEffectState(effects);
    const live = await prisma.productDoseEffect.findMany({
      where: { productId, archivedAt: null },
      select: { parameterCode: true, direction: true },
    });
    const has = new Set(
      live.map((row) => `${row.parameterCode}:${row.direction}`),
    );
    const dosingValue =
      dosing &&
      (dosing.status === "VERIFIED" ? dosing.value : dosing.currentValue);
    return {
      productId,
      jev: { ...jev, sourceRef: effects?.sourceRef ?? null },
      dosing:
        dosing && dosingValue
          ? { status: dosing.status, value: dosingValue }
          : null,
      rows: jev.effects
        .filter(
          (effect) => !has.has(`${effect.parameterCode}:${effect.direction}`),
        )
        .map((effect) => ({
          ...effect,
          source: effects?.sourceRef ?? null,
        })),
    };
  }

  private async live(id: string) {
    const row = await prisma.productDoseEffect.findFirst({
      where: { id, archivedAt: null },
    });
    if (!row)
      throw new NotFoundException("Az élő adag-hatás sor nem található.");
    return row;
  }

  private async view(id: string): Promise<DoseEffectView> {
    const row = await prisma.productDoseEffect.findUniqueOrThrow({
      where: { id },
      select: ROW_SELECT,
    });
    return (await this.views([row]))[0]!;
  }

  private async views(rows: readonly Row[]): Promise<DoseEffectView[]> {
    const products = [...new Set(rows.map((row) => row.productId))];
    const jev = new Map(
      await Promise.all(
        products.map(
          async (productId) =>
            [
              productId,
              jevEffectState(
                await latestJevField(productId, "waterParameterEffects"),
              ),
            ] as const,
        ),
      ),
    );
    return rows.map((row) => {
      const jevState = jev.get(row.productId)!;
      const refusals = doseEffectRefusals(row, {
        jev: jevState,
        purchasable: row.product.isActive && isRecommendableOnUnas(row.product),
      });
      return {
        id: row.id,
        productId: row.productId,
        productName: row.product.name,
        parameterCode: row.parameterCode,
        direction: row.direction,
        effectPer100L: row.effectPer100L.toNumber(),
        doseUnit: row.doseUnit,
        doseStep: row.doseStep.toNumber(),
        maxDailyDosePer100L: row.maxDailyDosePer100L?.toNumber() ?? null,
        effectHours: row.effectHours,
        source: row.source,
        version: row.version,
        recordedBy: row.recordedBy
          ? { id: row.recordedBy.id, name: row.recordedBy.displayName }
          : null,
        recordedAt: row.recordedAt.toISOString(),
        verifiedBy: row.verifiedBy
          ? { id: row.verifiedBy.id, name: row.verifiedBy.displayName }
          : null,
        verifiedAt: row.verifiedAt?.toISOString() ?? null,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        usable: refusals.length === 0,
        refusals,
        jevStatus: jevState.status,
      };
    });
  }
}

function numbersOf(input: CreateDoseEffectDto) {
  return {
    effectPer100L: input.effectPer100L,
    doseUnit: input.doseUnit,
    doseStep: input.doseStep,
    maxDailyDosePer100L: input.maxDailyDosePer100L ?? null,
    effectHours: input.effectHours ?? null,
    source: input.source.trim(),
  };
}

/** The latest completed JEV result of one field for one product (the candidate source's query, narrowed). */
async function latestJevField(
  productId: string,
  field: "waterParameterEffects" | "dosing",
): Promise<{
  status: string;
  value: string | null;
  currentValue: string | null;
  sourceRef: string | null;
} | null> {
  const rows = await prisma.$queryRaw<
    {
      status: string;
      value: string | null;
      currentValue: string | null;
      sourceRef: string | null;
    }[]
  >`
    SELECT f.status, f.value, f."currentValue", f."sourceRef"
    FROM "ProductEnrichmentFieldResult" f
    JOIN "ProductEnrichmentRunProduct" c ON c.id = f."checkId"
    JOIN "ProductEnrichmentRun" r ON r.id = c."runId"
    WHERE f.field = ${field}
      AND c."productId" = ${productId}
      AND r.status IN ('COMPLETED', 'LIMIT_REACHED')
    ORDER BY c."checkedAt" DESC, f.id DESC
    LIMIT 1`;
  return rows[0] ?? null;
}
