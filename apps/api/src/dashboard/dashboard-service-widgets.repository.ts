import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  DashboardMaintenanceCalendarWidgetData,
  DashboardMaterialRequestsWidgetData,
  DashboardServiceTicketsWidgetData,
  DashboardWorksheetsWidgetData,
} from "@acropora/types";

import {
  assetVisibilityForAndBranch,
  type PartnerScope,
} from "../auth/partner-scope.util.js";
import { serviceJobVisibilityWhere } from "../service-jobs/service-job-visibility.js";
import { worksheetListWheres } from "../worksheets/worksheets.repository.js";
import { budapestDayKey, startOfBudapestDay } from "./budapest-day.js";

const SHORT_LIST = 3;
const CALENDAR_DAYS_AHEAD = 7;

/**
 * An open ticket: not finished and not hidden. The SAME rule as the ticket
 * list's `open` scope and the old dashboard card, so the numbers agree.
 */
export const OPEN_TICKET: Prisma.ServiceJobWhereInput = {
  status: { notIn: ["COMPLETED", "CANCELLED"] },
  hiddenAt: null,
};

export interface ServiceWidgetViewer {
  userId: string;
  scope: PartnerScope;
  /** The caller's assigned units, already expanded (may be empty). */
  assignedUnitIds: readonly string[];
}

/**
 * THE SERVICE WIDGETS' QUERIES (`docs/dashboard/v1-discovery.md` §4).
 *
 * Every count is scoped exactly as its list page: tickets by
 * `serviceJobVisibilityWhere`, worksheets by `worksheetListWheres` (hidden
 * rows excluded), assets by `assetVisibilityForAndBranch`. A technician sees
 * what their list pages would show them, never the company total.
 */
@Injectable()
export class DashboardServiceWidgetsRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async serviceTickets(
    viewer: ServiceWidgetViewer,
  ): Promise<DashboardServiceTicketsWidgetData> {
    const where: Prisma.ServiceJobWhereInput = {
      AND: [
        serviceJobVisibilityWhere({
          scope: viewer.scope,
          userId: viewer.userId,
          unitIds: viewer.assignedUnitIds,
        }),
        OPEN_TICKET,
      ],
    };
    const [groups, oldest] = await Promise.all([
      this.database.serviceJob.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
      this.database.serviceJob.findFirst({
        where,
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
    const byStatus: DashboardServiceTicketsWidgetData["byStatus"] = {};
    let openCount = 0;
    for (const group of groups) {
      if (group.status === "COMPLETED" || group.status === "CANCELLED")
        continue;
      const count = group._count._all;
      if (count === 0) continue;
      byStatus[group.status] = count;
      openCount += count;
    }
    return {
      openCount,
      byStatus,
      oldestOpenAt: oldest ? oldest.createdAt.toISOString() : null,
    };
  }

  async worksheets(
    viewer: ServiceWidgetViewer,
  ): Promise<DashboardWorksheetsWidgetData> {
    // the list page's own scope; hidden worksheets excluded (`mayHide` false)
    const visible = worksheetListWheres(
      viewer.scope,
      viewer.assignedUnitIds,
      {},
      {},
    ).counts;
    const [rows, certificatesAwaitingSignedForm] = await Promise.all([
      this.database.worksheet.findMany({
        where: visible,
        select: { id: true },
      }),
      this.database.completionCertificate.count({
        where: {
          documents: { none: { type: "SIGNED_FORM" } },
          serviceJob: {
            AND: [
              serviceJobVisibilityWhere({
                scope: viewer.scope,
                userId: viewer.userId,
                unitIds: viewer.assignedUnitIds,
              }),
              { hiddenAt: null },
            ],
          },
        },
      }),
    ]);
    const counts = await this.latestVersionCounts(rows.map((row) => row.id));
    return { ...counts, certificatesAwaitingSignedForm };
  }

  /** The latest version of each worksheet, counted by the states that need action. */
  private async latestVersionCounts(
    worksheetIds: string[],
  ): Promise<
    Omit<DashboardWorksheetsWidgetData, "certificatesAwaitingSignedForm">
  > {
    const zero = {
      draft: 0,
      awaitingSignatureNotSent: 0,
      awaitingSignatureSent: 0,
    };
    if (worksheetIds.length === 0) return zero;
    const rows = await this.database.$queryRaw<
      { draft: bigint; not_sent: bigint; sent: bigint }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE latest."status" = 'DRAFT')::bigint AS draft,
        COUNT(*) FILTER (
          WHERE latest."status" = 'AWAITING_SIGNATURE'
            AND latest."sentForSignatureAt" IS NULL
        )::bigint AS not_sent,
        COUNT(*) FILTER (
          WHERE latest."status" = 'AWAITING_SIGNATURE'
            AND latest."sentForSignatureAt" IS NOT NULL
        )::bigint AS sent
      FROM (
        SELECT DISTINCT ON ("worksheetId") "worksheetId", "status", "sentForSignatureAt"
        FROM "WorksheetVersion"
        WHERE "worksheetId" = ANY(${worksheetIds})
        ORDER BY "worksheetId", "version" DESC
      ) AS latest
    `;
    const row = rows[0];
    return row
      ? {
          draft: Number(row.draft),
          awaitingSignatureNotSent: Number(row.not_sent),
          awaitingSignatureSent: Number(row.sent),
        }
      : zero;
  }

  /**
   * Open material requests: the same set the "pending" page lists to those
   * who may mark them received (permission + capability, checked upstream).
   */
  async materialRequests(): Promise<DashboardMaterialRequestsWidgetData> {
    const where: Prisma.MaterialRequestWhereInput = {
      status: "OPEN",
      submittedAt: { not: null },
    };
    const [openCount, rows] = await Promise.all([
      this.database.materialRequest.count({ where }),
      this.database.materialRequest.findMany({
        where,
        orderBy: { submittedAt: "asc" },
        take: SHORT_LIST,
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
          _count: { select: { items: true } },
        },
      }),
    ]);
    const latest = rows.flatMap((row) =>
      row.submittedAt
        ? [
            {
              id: row.id,
              worksheetId: row.worksheetId,
              worksheetNumber: row.worksheet.number,
              customerName: row.worksheet.customer.displayName,
              submittedAt: row.submittedAt.toISOString(),
              itemCount: row._count.items,
            },
          ]
        : [],
    );
    return {
      openCount,
      oldestSubmittedAt: latest[0]?.submittedAt ?? null,
      latest,
    };
  }

  /**
   * Overdue / today / the next seven days, by Budapest calendar day, from
   * `Asset.nextServiceAt`. Active, not archived, in the caller's scope.
   */
  async maintenanceCalendar(
    viewer: ServiceWidgetViewer,
    now: Date,
  ): Promise<DashboardMaintenanceCalendarWidgetData> {
    const today = startOfBudapestDay(now);
    const tomorrow = startOfBudapestDay(now, 1);
    const afterWindow = startOfBudapestDay(now, CALENDAR_DAYS_AHEAD + 1);
    const due = (range: Prisma.DateTimeNullableFilter) => ({
      AND: [
        // inline in the AND array, as `partner-scope-and-branch.spec.ts` requires
        assetVisibilityForAndBranch(viewer.scope, viewer.assignedUnitIds),
        { status: "ACTIVE" as const, archivedAt: null, nextServiceAt: range },
      ],
    });
    const [overdue, dueToday, nextSevenDays, soonest] = await Promise.all([
      this.database.asset.count({ where: due({ lt: today }) }),
      this.database.asset.count({ where: due({ gte: today, lt: tomorrow }) }),
      this.database.asset.count({
        where: due({ gte: tomorrow, lt: afterWindow }),
      }),
      this.database.asset.findMany({
        where: due({ not: null, lt: afterWindow }),
        orderBy: { nextServiceAt: "asc" },
        take: SHORT_LIST,
        select: {
          id: true,
          name: true,
          nextServiceAt: true,
          customer: { select: { displayName: true } },
          department: { select: { name: true } },
        },
      }),
    ]);
    return {
      overdue,
      today: dueToday,
      nextSevenDays,
      soonest: soonest.flatMap((row) =>
        row.nextServiceAt
          ? [
              {
                assetId: row.id,
                assetName: row.name,
                placeName: row.customer?.displayName ?? row.department.name,
                nextServiceAt: budapestDayKey(row.nextServiceAt),
              },
            ]
          : [],
      ),
    };
  }
}
