import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import {
  aquariumEffectiveMeasurementTargetRange,
  aquariumMeasurementParametersFor,
  type AquariumMeasurementParameterCode,
  type DashboardActivity,
  type DashboardAquariumAlerts,
  type DashboardDeadlines,
  type DashboardManagerTiles,
  type DashboardMaterialRequests,
  type DashboardMyWorksheets,
  type DashboardOpenTickets,
  type DashboardPurchasing,
  type DashboardTeamLoad,
} from "@acropora/types";

import { type PartnerScope } from "../auth/partner-scope.util.js";
import { assignedUnitIdsFor } from "../service-jobs/assigned-units.query.js";
import { serviceJobVisibilityWhere } from "../service-jobs/service-job-visibility.js";
import { worksheetListWheres } from "../worksheets/worksheets.repository.js";

const DASHBOARD_LIST_LIMIT = 5;
export const STALE_MEASUREMENT_AFTER_DAYS = 14;

const openTicketStatus: Prisma.ServiceJobWhereInput = {
  status: { notIn: ["COMPLETED", "CANCELLED"] },
  hiddenAt: null,
};

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isOpenWorksheet(version: { closedAt: Date | null } | undefined) {
  return version?.closedAt === null;
}

@Injectable()
export class DashboardRepository extends Repository {
  constructor() {
    super(prisma);
  }

  assignedUnitIds(userId: string): Promise<string[]> {
    return assignedUnitIdsFor(userId);
  }

  async myWorksheets(input: {
    userId: string;
    scope: PartnerScope;
    assignedUnitIds: readonly string[];
  }): Promise<DashboardMyWorksheets> {
    const where = worksheetListWheres(
      input.scope,
      input.assignedUnitIds,
      { assignees: { some: { userId: input.userId } } },
      {},
    ).list;
    const rows = await this.database.worksheet.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        number: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            subject: true,
            status: true,
            dueDate: true,
            closedAt: true,
          },
        },
      },
    });
    return {
      items: rows
        .filter((row) => isOpenWorksheet(row.versions[0]))
        .slice(0, DASHBOARD_LIST_LIMIT)
        .map((row) => {
          const version = row.versions[0]!;
          return {
            id: row.id,
            number: row.number,
            subject: version.subject,
            status: version.status,
            deadline: version.dueDate ? dateOnly(version.dueDate) : null,
          };
        }),
    };
  }

  async openTickets(input: {
    userId: string;
    scope: PartnerScope;
    assignedUnitIds: readonly string[];
  }): Promise<DashboardOpenTickets> {
    const visibility = serviceJobVisibilityWhere({
      scope: input.scope,
      userId: input.userId,
      unitIds: input.assignedUnitIds,
    });
    const where: Prisma.ServiceJobWhereInput = {
      AND: [visibility, openTicketStatus],
    };
    const [count, rows] = await Promise.all([
      this.database.serviceJob.count({ where }),
      this.database.serviceJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: DASHBOARD_LIST_LIMIT,
        select: {
          id: true,
          jobNumber: true,
          title: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      count,
      items: rows.map((row) => ({
        id: row.id,
        number: row.jobNumber,
        title: row.title,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async aquariumAlerts(now: Date): Promise<DashboardAquariumAlerts> {
    const staleBefore = new Date(
      now.getTime() - STALE_MEASUREMENT_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );
    const rows = await this.database.aquarium.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        waterType: true,
        targets: { select: { parameterCode: true, min: true, max: true } },
        measurements: {
          orderBy: { measuredAt: "desc" },
          select: { parameterCode: true, value: true, measuredAt: true },
        },
      },
    });

    const items = rows.flatMap((aquarium): DashboardAquariumAlerts["items"] => {
      const latestAt = aquarium.measurements[0]?.measuredAt;
      if (!latestAt || latestAt < staleBefore)
        return [
          {
            aquariumId: aquarium.id,
            aquariumName: aquarium.name,
            reason: "STALE_MEASUREMENT" as const,
            measuredAt: latestAt?.toISOString() ?? null,
          },
        ];

      const latestMeasurements = aquarium.measurements.filter(
        (measurement) =>
          measurement.measuredAt.getTime() === latestAt.getTime(),
      );
      const allowedCodes = new Set(
        aquariumMeasurementParametersFor(aquarium.waterType).map(
          (parameter) => parameter.code,
        ),
      );
      const outOfRange = latestMeasurements.find((measurement) => {
        if (
          !allowedCodes.has(
            measurement.parameterCode as AquariumMeasurementParameterCode,
          )
        )
          return false;
        const range = aquariumEffectiveMeasurementTargetRange(
          aquarium.waterType,
          measurement.parameterCode as AquariumMeasurementParameterCode,
          aquarium.targets.map((target) => ({
            parameterCode:
              target.parameterCode as AquariumMeasurementParameterCode,
            min: target.min?.toNumber(),
            max: target.max?.toNumber(),
          })),
        );
        const value = measurement.value.toNumber();
        return (
          (range?.min !== undefined && value < range.min) ||
          (range?.max !== undefined && value > range.max)
        );
      });
      return outOfRange
        ? [
            {
              aquariumId: aquarium.id,
              aquariumName: aquarium.name,
              reason: "OUT_OF_RANGE" as const,
              measuredAt: latestAt.toISOString(),
              parameterCode: outOfRange.parameterCode,
            },
          ]
        : [];
    });
    return { staleAfterDays: STALE_MEASUREMENT_AFTER_DAYS, items };
  }

  async managerTiles(): Promise<DashboardManagerTiles> {
    const [
      openTickets,
      waitingSignatures,
      materialRequests,
      maintenanceOrders,
    ] = await Promise.all([
      this.database.serviceJob.count({ where: openTicketStatus }),
      this.latestWorksheetStatusCount("AWAITING_SIGNATURE"),
      this.database.materialRequest.count({ where: { status: "OPEN" } }),
      this.database.maintenanceOrder.count({ where: { status: "ISSUED" } }),
    ]);
    return {
      openTickets,
      worksheetsWaitingForSignature: waitingSignatures,
      materialRequestsWaiting: materialRequests,
      maintenanceOrderFormsWaitingForSignature: maintenanceOrders,
    };
  }

  async deadlines(now: Date): Promise<DashboardDeadlines> {
    const until = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const rows = await this.database.worksheet.findMany({
      where: { hiddenAt: null },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        number: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { subject: true, dueDate: true, closedAt: true },
        },
      },
    });
    return {
      items: rows
        .flatMap((row) => {
          const version = row.versions[0];
          if (
            !version ||
            !isOpenWorksheet(version) ||
            !version.dueDate ||
            version.dueDate > until
          )
            return [];
          return [
            {
              kind: "WORKSHEET" as const,
              id: row.id,
              number: row.number,
              subject: version.subject,
              deadline: dateOnly(version.dueDate),
            },
          ];
        })
        .sort((left, right) => left.deadline.localeCompare(right.deadline))
        .slice(0, DASHBOARD_LIST_LIMIT),
    };
  }

  async teamLoad(): Promise<DashboardTeamLoad> {
    const rows = await this.database.worksheetAssignee.findMany({
      select: {
        userId: true,
        user: { select: { displayName: true } },
        worksheet: {
          select: {
            hiddenAt: true,
            versions: {
              orderBy: { version: "desc" },
              take: 1,
              select: { closedAt: true },
            },
          },
        },
      },
    });
    const loads = new Map<string, { displayName: string; count: number }>();
    for (const row of rows) {
      if (row.worksheet.hiddenAt || !isOpenWorksheet(row.worksheet.versions[0]))
        continue;
      const previous = loads.get(row.userId);
      if (previous) previous.count += 1;
      else
        loads.set(row.userId, { displayName: row.user.displayName, count: 1 });
    }
    return {
      items: [...loads.entries()]
        .map(([userId, load]) => ({
          userId,
          displayName: load.displayName,
          openWorksheetCount: load.count,
        }))
        .sort(
          (left, right) =>
            right.openWorksheetCount - left.openWorksheetCount ||
            left.displayName.localeCompare(right.displayName, "hu"),
        ),
    };
  }

  async hasMaterialRequestCapability(userId: string): Promise<boolean> {
    return (
      (await this.database.userServiceCapability.findUnique({
        where: {
          userId_capability: {
            userId,
            capability: "MATERIAL_REQUEST_MARK_RECEIVED",
          },
        },
        select: { userId: true },
      })) !== null
    );
  }

  async materialRequests(): Promise<DashboardMaterialRequests> {
    const rows = await this.database.materialRequest.findMany({
      where: { status: "OPEN" },
      orderBy: { submittedAt: "asc" },
      take: DASHBOARD_LIST_LIMIT,
      select: {
        id: true,
        worksheetId: true,
        submittedAt: true,
        worksheet: {
          select: {
            number: true,
            customer: { select: { displayName: true } },
          },
        },
      },
    });
    return {
      items: rows.flatMap((row) =>
        row.submittedAt
          ? [
              {
                id: row.id,
                worksheetId: row.worksheetId,
                worksheetNumber: row.worksheet.number,
                customerName: row.worksheet.customer.displayName,
                submittedAt: row.submittedAt.toISOString(),
              },
            ]
          : [],
      ),
    };
  }

  async purchasing(): Promise<DashboardPurchasing> {
    const rows = await this.database.purchaseOrder.findMany({
      where: { status: { notIn: ["RECEIVED", "CANCELLED", "CLOSED"] } },
      orderBy: [{ expectedAt: "asc" }, { createdAt: "desc" }],
      take: DASHBOARD_LIST_LIMIT,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        expectedAt: true,
        supplier: { select: { name: true } },
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        orderNumber: row.orderNumber,
        supplierName: row.supplier.name,
        status: row.status,
        expectedAt: row.expectedAt?.toISOString() ?? null,
      })),
    };
  }

  async activity(): Promise<DashboardActivity> {
    const [tickets, worksheets, measurements] = await Promise.all([
      this.database.serviceJobEvent.findMany({
        where: { kind: "STATUS_CHANGE", fromStatus: null, toStatus: "NEW" },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          createdAt: true,
          actor: { select: { displayName: true } },
          serviceJob: { select: { jobNumber: true, title: true } },
        },
      }),
      this.database.worksheetVersion.findMany({
        where: { closedAt: { not: null } },
        orderBy: { closedAt: "desc" },
        take: 10,
        select: {
          closedAt: true,
          subject: true,
          closedBy: { select: { displayName: true } },
        },
      }),
      this.database.domainEvent.findMany({
        where: { eventType: "aquarium-measurement.recorded" },
        orderBy: { occurredAt: "desc" },
        take: 10,
        select: {
          occurredAt: true,
          actor: { select: { displayName: true } },
        },
      }),
    ]);
    const items = [
      ...tickets.map((row) => ({
        kind: "TICKET_OPENED" as const,
        subject: `${row.serviceJob.jobNumber}: ${row.serviceJob.title}`,
        actorName: row.actor?.displayName ?? null,
        occurredAt: row.createdAt.toISOString(),
      })),
      ...worksheets.flatMap((row) =>
        row.closedAt
          ? [
              {
                kind: "WORKSHEET_CLOSED" as const,
                subject: row.subject,
                actorName: row.closedBy?.displayName ?? null,
                occurredAt: row.closedAt.toISOString(),
              },
            ]
          : [],
      ),
      ...measurements.map((row) => ({
        kind: "MEASUREMENT_RECORDED" as const,
        subject: "Vízmérés rögzítve",
        actorName: row.actor?.displayName ?? null,
        occurredAt: row.occurredAt.toISOString(),
      })),
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 10);
    return { items };
  }

  taskCount(userId: string): Promise<number> {
    return this.database.task.count({
      where: { assigneeId: userId, status: "OPEN" },
    });
  }

  private async latestWorksheetStatusCount(status: "AWAITING_SIGNATURE") {
    const rows = await this.database.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT DISTINCT ON ("worksheetId") "status"
        FROM "WorksheetVersion"
        ORDER BY "worksheetId", "version" DESC
      ) AS latest
      WHERE latest."status" = ${status}::"WorksheetVersionStatus"
    `;
    return Number(rows[0]?.count ?? 0n);
  }
}
