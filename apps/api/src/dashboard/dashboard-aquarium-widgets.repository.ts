import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  DashboardAquariumEquipmentWidgetData,
  WaterType,
} from "@acropora/types";

import { aquariumVisibilityWhere } from "../aquariums/aquarium-visibility.js";
import { assetVisibilityForAndBranch } from "../auth/partner-scope.util.js";
import type { AquariumReading } from "./aquarium-findings.js";
import { budapestDayKey, startOfBudapestDay } from "./budapest-day.js";
import type { ServiceWidgetViewer } from "./dashboard-service-widgets.repository.js";

/** Figma 392:3 "esedékes 14 napon belül"; an open question in the discovery report. */
export const EQUIPMENT_WINDOW_DAYS = 14;
const SHORT_LIST = 3;

/**
 * THE AQUARIUM WIDGETS' READS. Two queries for any number of aquariums: the
 * visible aquariums with their targets, then ONE raw read of each one's
 * latest measurement occasion -- not every measurement of every aquarium,
 * which is what the old card loaded.
 */
@Injectable()
export class DashboardAquariumWidgetsRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async readings(viewer: ServiceWidgetViewer): Promise<AquariumReading[]> {
    const aquariums = await this.database.aquarium.findMany({
      where: {
        AND: [
          aquariumVisibilityWhere({
            scope: viewer.scope,
            unitIds: viewer.assignedUnitIds,
          }),
          { isActive: true },
        ],
      },
      select: {
        id: true,
        name: true,
        waterType: true,
        targets: { select: { parameterCode: true, min: true, max: true } },
      },
    });
    if (aquariums.length === 0) return [];

    const ids = aquariums.map((aquarium) => aquarium.id);
    const rows = await this.database.$queryRaw<
      {
        aquariumId: string;
        parameterCode: string;
        value: Prisma.Decimal;
        measuredAt: Date;
      }[]
    >`
      SELECT m."aquariumId", m."parameterCode", m."value", m."measuredAt"
      FROM "AquariumMeasurement" m
      JOIN (
        SELECT "aquariumId", MAX("measuredAt") AS "latestAt"
        FROM "AquariumMeasurement"
        WHERE "aquariumId" = ANY(${ids})
        GROUP BY "aquariumId"
      ) latest
        ON latest."aquariumId" = m."aquariumId"
       AND latest."latestAt" = m."measuredAt"
    `;

    const latestBy = new Map<string, NonNullable<AquariumReading["latest"]>>();
    for (const row of rows) {
      const entry = latestBy.get(row.aquariumId) ?? {
        measuredAt: row.measuredAt,
        values: [],
      };
      entry.values.push({
        parameterCode: row.parameterCode,
        value: Number(row.value),
      });
      latestBy.set(row.aquariumId, entry);
    }

    return aquariums.map((aquarium) => ({
      id: aquarium.id,
      name: aquarium.name,
      waterType: aquarium.waterType as WaterType | null,
      targets: aquarium.targets.map((target) => ({
        parameterCode: target.parameterCode,
        min: target.min === null ? null : Number(target.min),
        max: target.max === null ? null : Number(target.max),
      })),
      latest: latestBy.get(aquarium.id) ?? null,
    }));
  }

  /**
   * Equipment attached to an aquarium (`Asset.aquariumId`), active and not
   * archived, in the caller's asset scope, by its next service date.
   */
  async equipment(
    viewer: ServiceWidgetViewer,
    now: Date,
  ): Promise<DashboardAquariumEquipmentWidgetData> {
    const today = startOfBudapestDay(now);
    const afterWindow = startOfBudapestDay(now, EQUIPMENT_WINDOW_DAYS + 1);
    const due = (range: Prisma.DateTimeNullableFilter) => ({
      AND: [
        // inline in the AND array, as `partner-scope-and-branch.spec.ts` requires
        assetVisibilityForAndBranch(viewer.scope, viewer.assignedUnitIds),
        {
          status: "ACTIVE" as const,
          archivedAt: null,
          aquariumId: { not: null },
          nextServiceAt: range,
        },
      ],
    });
    const [overdue, dueSoon, soonest] = await Promise.all([
      this.database.asset.count({ where: due({ lt: today }) }),
      this.database.asset.count({
        where: due({ gte: today, lt: afterWindow }),
      }),
      this.database.asset.findMany({
        where: due({ not: null, lt: afterWindow }),
        orderBy: { nextServiceAt: "asc" },
        take: SHORT_LIST,
        select: {
          id: true,
          name: true,
          nextServiceAt: true,
          aquarium: { select: { name: true } },
        },
      }),
    ]);
    return {
      windowDays: EQUIPMENT_WINDOW_DAYS,
      overdue,
      dueSoon,
      soonest: soonest.flatMap((row) =>
        row.nextServiceAt
          ? [
              {
                assetId: row.id,
                assetName: row.name,
                aquariumName: row.aquarium?.name ?? "",
                nextServiceAt: budapestDayKey(row.nextServiceAt),
              },
            ]
          : [],
      ),
    };
  }
}
