import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  aquariumEffectiveMeasurementTargetRange,
  aquariumMeasurementParameter,
  type AquariumMeasurementParameterCode,
  measurementDistanceFromRange,
  measurementStatus,
  type MeasurementStatus,
  measurementTrend,
  type MeasurementTrend,
} from "@acropora/types";

import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { withUniqueCode } from "../common/unique-code.util.js";
import {
  aquariumAccessWhere,
  occasionFilter,
  originOf,
  type ReefClubAquariumGrant,
  type ReefClubAquariumOrigin,
  reefClubNotFound,
} from "./reefclub-aquarium-access.js";
import type {
  ReefClubCreateAquariumDto,
  ReefClubCreateMeasurementDto,
  ReefClubSetTargetsDto,
  ReefClubUpdateAquariumDto,
} from "./reefclub-aquarium.dto.js";
import { ReefClubDatabase } from "./reefclub-database.js";
import { REEFCLUB_MAX_OWN_AQUARIUMS } from "./reefclub-rate-limits.js";
import { type ReefClubShopView, shopViewOf } from "./reefclub-shop-view.js";

/**
 * THE REEFCLUB AQUARIUM, ITS TARGET RANGES AND ITS MANUAL MEASUREMENTS (plan
 * v6.1, 3.4; slice 4).
 *
 * EVERY METHOD THAT TAKES AN AQUARIUM TAKES A GRANT, not an id: the grant is
 * what `ReefClubAquariumAccess.aquariumForAccount` returned, so a method here
 * cannot be called on an aquarium the access function did not approve, and
 * every child query (targets, occasions) is bound to the granted aquarium id
 * (plan 4.2), and every occasion query to the access module's
 * `occasionFilter` (on a shop aquarium: the released occasions only). The
 * list is the one exception: it has no aquarium, and it uses the access
 * function's own query shape.
 *
 * EVERY RESPONSE IS AN EXPLICIT FIELD LIST (plan 3.1). The internal columns
 * (the aquarium number, the notes, `maintainedByUs`, the maintainers, the
 * colleague who measured) are never selected, so they cannot be spread into
 * an answer by mistake.
 *
 * The occasion has no table of its own, as on the internal side
 * (`aquarium-measurements.repository.ts`): its rows share a `measuredAt`, and
 * its id is that moment in ISO form.
 */
export interface ReefClubAquarium {
  id: string;
  origin: ReefClubAquariumOrigin;
  name: string;
  waterBodyType: "AKVARIUM" | "TO";
  waterType: "EDESVIZI" | "TENGERI" | null;
  systemVolumeLiters: number | null;
  /**
   * When the account shared it with the shop (slice 5a); null: private. Always
   * null on a shop aquarium, which has no share state.
   */
  sharedWithShopAt: string | null;
  createdAt: string;
}

export interface ReefClubTarget {
  parameterCode: string;
  min: number | null;
  max: number | null;
}

export interface ReefClubMeasurementValue {
  parameterCode: string;
  value: number;
  unit: string;
  /** The range the value is judged against: the aquarium's own, else the default. */
  target: { min: number | null; max: number | null } | null;
  status: MeasurementStatus | null;
  direction: "LOW" | "HIGH" | null;
  trend: MeasurementTrend | null;
}

export interface ReefClubOccasion {
  id: string;
  measuredAt: string;
  /** MANUAL: recorded in the ReefClub. SHOP: measured in the shop (slice 5). */
  source: "MANUAL" | "SHOP";
  values: ReefClubMeasurementValue[];
}

/** The `source` of a measurement row recorded in the ReefClub (plan 2.2). */
export const REEFCLUB_MANUAL_SOURCE = "REEFCLUB_MANUAL";

const AQUARIUM_FIELDS = {
  id: true,
  ownerAccountId: true,
  name: true,
  waterBodyType: true,
  waterType: true,
  systemVolumeLiters: true,
  sharedWithShopAt: true,
  createdAt: true,
} as const;

type AquariumRow = Prisma.AquariumGetPayload<{
  select: typeof AQUARIUM_FIELDS;
}>;

const OCCASION_CONFLICT_MESSAGE =
  "Erre az időpontra már van mérés ennél az akváriumnál. Válassz másik időpontot.";

@Injectable()
export class ReefClubAquariumsService {
  constructor(
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
  ) {}

  async list(accountId: string): Promise<ReefClubAquarium[]> {
    const rows = await this.database.aquarium.findMany({
      where: aquariumAccessWhere(accountId, "READ"),
      select: AQUARIUM_FIELDS,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => toAquarium(row, accountId));
  }

  async detail(
    accountId: string,
    grant: ReefClubAquariumGrant,
  ): Promise<ReefClubAquarium> {
    const row = await this.database.aquarium.findUnique({
      where: { id: grant.aquariumId },
      select: AQUARIUM_FIELDS,
    });
    if (!row) throw reefClubNotFound();
    return toAquarium(row, accountId);
  }

  /**
   * A new own aquarium. The owner is the session's account; the body has no
   * owner field to give (the DTO refuses one). It gets an internal aquarium
   * number like every row, but the number is not part of the answer.
   */
  async create(
    accountId: string,
    input: ReefClubCreateAquariumDto,
  ): Promise<ReefClubAquarium> {
    // A ceiling, not a race-proof one: two parallel creates at 19 may both
    // pass. It bounds a public account's use of internal aquarium numbers
    // (barracuda, #1724 review a); one over the ceiling does no harm.
    const owned = await this.database.aquarium.count({
      where: { ownerAccountId: accountId },
    });
    if (owned >= REEFCLUB_MAX_OWN_AQUARIUMS)
      throw new ConflictException(
        `Legfeljebb ${REEFCLUB_MAX_OWN_AQUARIUMS} saját akváriumod lehet.`,
      );
    const row = await withUniqueCode(
      { prefix: "AKV", field: "aquariumNumber" },
      (aquariumNumber) =>
        this.database.aquarium.create({
          data: {
            aquariumNumber,
            ownerAccountId: accountId,
            // The customer's own tank, not the shop's (OWN would read as the
            // shop's own aquarium if it were ever shown inside).
            ownershipType: "CUSTOMER",
            name: input.name.trim(),
            waterBodyType: input.waterBodyType ?? "AKVARIUM",
            waterType: input.waterType ?? null,
            systemVolumeLiters: input.systemVolumeLiters ?? null,
            systemVolumeIsManual: input.systemVolumeLiters !== undefined,
          },
          select: AQUARIUM_FIELDS,
        }),
    );
    return toAquarium(row, accountId);
  }

  async update(
    accountId: string,
    grant: ReefClubAquariumGrant,
    input: ReefClubUpdateAquariumDto,
  ): Promise<ReefClubAquarium> {
    const row = await this.database.aquarium.update({
      where: { id: grant.aquariumId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.waterBodyType !== undefined
          ? { waterBodyType: input.waterBodyType }
          : {}),
        ...(input.waterType !== undefined
          ? { waterType: input.waterType }
          : {}),
        ...(input.systemVolumeLiters !== undefined
          ? {
              systemVolumeLiters: input.systemVolumeLiters,
              systemVolumeIsManual: input.systemVolumeLiters !== null,
            }
          : {}),
      },
      select: AQUARIUM_FIELDS,
    });
    return toAquarium(row, accountId);
  }

  /**
   * SHARING WITH THE SHOP (plan 4.4; slice 5a): an explicit step, with the
   * consent version, logged. Sharing a shared one keeps its first moment and
   * logs nothing new. Revoking empties the moment: the next internal request
   * no longer sees the aquarium, nor any of its earlier data.
   */
  async share(
    accountId: string,
    grant: ReefClubAquariumGrant,
    consentVersion: string,
  ): Promise<ReefClubAquarium> {
    await this.database.$transaction(async (tx) => {
      const { count } = await tx.aquarium.updateMany({
        where: { id: grant.aquariumId, sharedWithShopAt: null },
        data: {
          sharedWithShopAt: new Date(),
          shareConsentVersion: consentVersion,
        },
      });
      if (count === 1)
        await tx.aquariumShareEvent.create({
          data: {
            aquariumId: grant.aquariumId,
            kind: "SHARED",
            accountId,
            consentVersion,
          },
        });
    });
    return this.detail(accountId, grant);
  }

  async revoke(accountId: string, grant: ReefClubAquariumGrant): Promise<void> {
    await this.database.$transaction(async (tx) => {
      const { count } = await tx.aquarium.updateMany({
        where: { id: grant.aquariumId, sharedWithShopAt: { not: null } },
        data: { sharedWithShopAt: null, shareConsentVersion: null },
      });
      if (count === 1)
        await tx.aquariumShareEvent.create({
          data: { aquariumId: grant.aquariumId, kind: "REVOKED", accountId },
        });
    });
  }

  async sharePreview(grant: ReefClubAquariumGrant): Promise<ReefClubShopView> {
    const view = await shopViewOf(this.database, grant.aquariumId);
    if (!view) throw reefClubNotFound();
    return view;
  }

  /** The aquarium with its targets and measurements (Cascade). */
  async remove(grant: ReefClubAquariumGrant): Promise<void> {
    await this.database.aquarium.delete({ where: { id: grant.aquariumId } });
  }

  async targets(grant: ReefClubAquariumGrant): Promise<ReefClubTarget[]> {
    const rows = await this.database.aquariumMeasurementTarget.findMany({
      where: { aquariumId: grant.aquariumId },
      select: { parameterCode: true, min: true, max: true },
      orderBy: { parameterCode: "asc" },
    });
    return rows.map((row) => ({
      parameterCode: row.parameterCode,
      min: row.min?.toNumber() ?? null,
      max: row.max?.toNumber() ?? null,
    }));
  }

  /**
   * The whole set of own ranges, as the internal editor sends it: a listed
   * parameter is set, an unlisted one is removed, and a row with neither bound
   * counts as unlisted (`aquariums.repository.ts`, the same rule).
   */
  async setTargets(
    grant: ReefClubAquariumGrant,
    input: ReefClubSetTargetsDto,
  ): Promise<ReefClubTarget[]> {
    const seen = new Set<string>();
    for (const row of input.targets) {
      if (seen.has(row.parameterCode))
        throw new BadRequestException(
          `A(z) ${row.parameterCode} paraméter kétszer szerepel.`,
        );
      seen.add(row.parameterCode);
      if (row.min !== undefined && row.max !== undefined && row.min > row.max)
        throw new BadRequestException(
          `A(z) ${labelOf(row.parameterCode)} céltartomány alsó határa nem lehet nagyobb a felsőnél.`,
        );
    }
    const kept = input.targets.filter(
      (row) => row.min !== undefined || row.max !== undefined,
    );
    await this.database.$transaction(async (tx) => {
      await tx.aquariumMeasurementTarget.deleteMany({
        where: {
          aquariumId: grant.aquariumId,
          parameterCode: { notIn: kept.map((row) => row.parameterCode) },
        },
      });
      for (const row of kept) {
        const bounds = { min: row.min ?? null, max: row.max ?? null };
        await tx.aquariumMeasurementTarget.upsert({
          where: {
            aquariumId_parameterCode: {
              aquariumId: grant.aquariumId,
              parameterCode: row.parameterCode,
            },
          },
          create: {
            aquariumId: grant.aquariumId,
            parameterCode: row.parameterCode,
            ...bounds,
          },
          update: bounds,
        });
      }
    });
    return this.targets(grant);
  }

  /**
   * Every occasion of the aquarium, newest first, each value judged by the
   * shared evaluation (`@acropora/types`, slice 1), so the ReefClub and the
   * OS give the same verdict on the same data. On a shop aquarium (slice 5)
   * only the released occasions will be listed; that condition belongs to the
   * access function.
   */
  async measurements(
    grant: ReefClubAquariumGrant,
  ): Promise<ReefClubOccasion[]> {
    const aquarium = await this.database.aquarium.findUnique({
      where: { id: grant.aquariumId },
      select: {
        waterType: true,
        targets: { select: { parameterCode: true, min: true, max: true } },
      },
    });
    if (!aquarium) throw reefClubNotFound();
    const rows = await this.database.aquariumMeasurement.findMany({
      where: await occasionFilter(this.database, grant),
      select: {
        parameterCode: true,
        value: true,
        unit: true,
        measuredAt: true,
        source: true,
      },
      orderBy: [{ measuredAt: "desc" }, { parameterCode: "asc" }],
    });
    const targets = aquarium.targets.map((target) => ({
      parameterCode: target.parameterCode as AquariumMeasurementParameterCode,
      min: target.min?.toNumber(),
      max: target.max?.toNumber(),
    }));

    const occasions = new Map<string, typeof rows>();
    for (const row of rows) {
      const id = row.measuredAt.toISOString();
      const list = occasions.get(id);
      if (list) list.push(row);
      else occasions.set(id, [row]);
    }
    // Newest first; the previous value of a parameter is its value in the
    // nearest older occasion that has it (the OS report's `previousValues`).
    const ordered = [...occasions.entries()];
    return ordered.map(([id, occasionRows], index) => ({
      id,
      measuredAt: id,
      source:
        occasionRows[0]!.source === REEFCLUB_MANUAL_SOURCE ? "MANUAL" : "SHOP",
      values: occasionRows.map((row) => {
        const code = row.parameterCode as AquariumMeasurementParameterCode;
        const value = row.value.toNumber();
        const range = aquariumEffectiveMeasurementTargetRange(
          aquarium.waterType,
          code,
          targets,
        );
        const hasRange =
          range !== undefined &&
          (range.min !== undefined || range.max !== undefined);
        const previous = previousValue(ordered, index, row.parameterCode);
        return {
          parameterCode: row.parameterCode,
          value,
          unit: row.unit,
          target: hasRange
            ? { min: range!.min ?? null, max: range!.max ?? null }
            : null,
          status: hasRange ? measurementStatus(value, range!) : null,
          direction: hasRange
            ? measurementDistanceFromRange(value, range!).direction
            : null,
          trend: hasRange ? measurementTrend(value, previous, range!) : null,
        };
      }),
    }));
  }

  /**
   * A manual occasion on an own aquarium. The same two-layer guard as the
   * internal route (`aquarium-measurements.repository.ts`): a lookup before
   * the insert, and the unique indexes for the race. A repeated
   * `clientOperationId` returns the occasion it created; another occasion at
   * the same moment is a 409.
   */
  async createMeasurement(
    accountId: string,
    grant: ReefClubAquariumGrant,
    input: ReefClubCreateMeasurementDto,
  ): Promise<ReefClubOccasion> {
    const measuredAt = input.measuredAt
      ? new Date(input.measuredAt)
      : new Date();
    if (measuredAt.getTime() > Date.now())
      throw new BadRequestException("A mérés ideje nem lehet a jövőben.");
    const codes = new Set(input.values.map((v) => v.parameterCode));
    if (codes.size !== input.values.length)
      throw new BadRequestException(
        "Egy paraméter egy mérésben csak egyszer szerepelhet.",
      );

    if (input.clientOperationId) {
      const existing = await this.occasionByOperation(
        grant,
        input.clientOperationId,
      );
      if (existing) return existing;
    }
    const collision = await this.database.aquariumMeasurement.findFirst({
      where: { aquariumId: grant.aquariumId, measuredAt },
      select: { id: true },
    });
    if (collision) throw new ConflictException(OCCASION_CONFLICT_MESSAGE);

    try {
      await this.database.aquariumMeasurement.createMany({
        data: input.values.map((entry) => ({
          aquariumId: grant.aquariumId,
          parameterCode: entry.parameterCode,
          value: entry.value,
          unit: aquariumMeasurementParameter(
            entry.parameterCode as AquariumMeasurementParameterCode,
          ).unit,
          measuredAt,
          source: REEFCLUB_MANUAL_SOURCE,
          recordedByAccountId: accountId,
          clientOperationId: input.clientOperationId ?? null,
        })),
      });
    } catch (error) {
      if (
        input.clientOperationId &&
        isPrismaUniqueConstraintViolation(error, "clientOperationId")
      ) {
        const existing = await this.occasionByOperation(
          grant,
          input.clientOperationId,
        );
        if (existing) return existing;
      }
      if (isPrismaUniqueConstraintViolation(error, "measuredAt"))
        throw new ConflictException(OCCASION_CONFLICT_MESSAGE);
      throw error;
    }
    return this.occasion(grant, measuredAt.toISOString());
  }

  /**
   * One occasion of the granted aquarium, all its parameters. The occasion is
   * looked up UNDER the aquarium (plan 4.2): an occasion id of another
   * aquarium matches nothing here and is the one 404.
   */
  async deleteMeasurement(
    grant: ReefClubAquariumGrant,
    occasionId: string,
  ): Promise<void> {
    const measuredAt = occasionMoment(occasionId);
    if (!measuredAt) throw reefClubNotFound();
    // Only the ReefClub's own manual rows (barracuda, #1724 review c): a
    // shop row never lies on an own aquarium today, and if it ever does, it
    // is not the account's to delete.
    const { count } = await this.database.aquariumMeasurement.deleteMany({
      where: {
        aquariumId: grant.aquariumId,
        measuredAt,
        source: REEFCLUB_MANUAL_SOURCE,
      },
    });
    if (count === 0) throw reefClubNotFound();
  }

  private async occasionByOperation(
    grant: ReefClubAquariumGrant,
    clientOperationId: string,
  ): Promise<ReefClubOccasion | null> {
    const row = await this.database.aquariumMeasurement.findFirst({
      where: { aquariumId: grant.aquariumId, clientOperationId },
      select: { measuredAt: true },
    });
    return row ? this.occasion(grant, row.measuredAt.toISOString()) : null;
  }

  private async occasion(
    grant: ReefClubAquariumGrant,
    id: string,
  ): Promise<ReefClubOccasion> {
    const found = (await this.measurements(grant)).find((o) => o.id === id);
    if (!found) throw reefClubNotFound();
    return found;
  }
}

function toAquarium(row: AquariumRow, accountId: string): ReefClubAquarium {
  return {
    id: row.id,
    origin: originOf(row.ownerAccountId, accountId),
    name: row.name,
    waterBodyType: row.waterBodyType,
    waterType: row.waterType,
    systemVolumeLiters: row.systemVolumeLiters?.toNumber() ?? null,
    sharedWithShopAt: row.sharedWithShopAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function previousValue(
  ordered: readonly [
    string,
    readonly { parameterCode: string; value: Prisma.Decimal }[],
  ][],
  index: number,
  parameterCode: string,
): number | undefined {
  for (const [, rows] of ordered.slice(index + 1)) {
    const row = rows.find((r) => r.parameterCode === parameterCode);
    if (row) return row.value.toNumber();
  }
  return undefined;
}

/**
 * The occasion id back to its moment. Only the exact ISO form the list hands
 * out is accepted, so two spellings of one moment are not two ids.
 */
function occasionMoment(occasionId: string): Date | null {
  const moment = new Date(occasionId);
  if (Number.isNaN(moment.getTime())) return null;
  return moment.toISOString() === occasionId ? moment : null;
}

function labelOf(code: string): string {
  return (
    aquariumMeasurementParameter(code as AquariumMeasurementParameterCode)
      ?.label ?? code
  );
}
