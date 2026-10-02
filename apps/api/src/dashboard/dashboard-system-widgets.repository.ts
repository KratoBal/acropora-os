import { Injectable } from "@nestjs/common";
import { Repository, prisma } from "@acropora/database";
import type {
  DashboardJevIntelligenceWidgetData,
  DashboardSystemStatusWidgetData,
} from "@acropora/types";

import { ebizApiKey } from "../integrations/ebiz/ebiz.client.js";
import { NAV_CONNECTION_ID } from "../integrations/nav/nav-connection.types.js";
import { startOfBudapestDay } from "./budapest-day.js";
import {
  JEV_WINDOW_DAYS,
  ebizState,
  jevState,
  navState,
  summarizeDecisionRuns,
  syncRunState,
  type DecisionRunGroup,
  type SourceState,
  type SyncRunSnapshot,
} from "./jev-system.js";

/**
 * THE JEV AND SYSTEM WIDGETS' READS (`settings.manage` only). Grouped counts
 * and the last run of each source; nothing is written, nothing external is
 * called. UNAS and Medusa are frozen and have no row here.
 */
@Injectable()
export class DashboardSystemWidgetsRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async jevIntelligence(
    now: Date,
  ): Promise<DashboardJevIntelligenceWidgetData> {
    const [week, today] = await Promise.all([
      this.database.decisionRun.groupBy({
        by: ["policyKey", "exposure", "resolution", "status"],
        where: {
          createdAt: { gte: startOfBudapestDay(now, -(JEV_WINDOW_DAYS - 1)) },
        },
        _count: { _all: true },
      }),
      this.jevToday(now),
    ]);
    return summarizeDecisionRuns(
      week.map((row): DecisionRunGroup => ({
        policyKey: row.policyKey,
        exposure: row.exposure,
        resolution: row.resolution,
        status: row.status,
        count: row._count._all,
      })),
      today,
    );
  }

  async systemStatus(
    now: Date,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<DashboardSystemStatusWidgetData> {
    const [nav, verification, mail, foxpost, gls, simplePay, ebiz, today] =
      await Promise.all([
        this.database.navInvoiceSyncRun.findFirst({
          orderBy: { createdAt: "desc" },
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            errorCode: true,
          },
        }),
        this.database.navConnectionSetting.findUnique({
          where: { id: NAV_CONNECTION_ID },
          select: { verificationStatus: true },
        }),
        this.database.supplierInvoiceMailSyncRun.findFirst({
          orderBy: { startedAt: "desc" },
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            errorCode: true,
            failedCount: true,
          },
        }),
        this.database.foxpostSyncRun.findFirst({
          orderBy: { startedAt: "desc" },
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            errorCode: true,
            failedCount: true,
          },
        }),
        this.database.glsSyncRun.findFirst({
          orderBy: { startedAt: "desc" },
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            errorCode: true,
            failedCount: true,
          },
        }),
        this.database.simplePaySyncRun.findFirst({
          orderBy: { startedAt: "desc" },
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            errorCode: true,
            failedCount: true,
          },
        }),
        this.database.ebizSyncRun.findFirst({
          orderBy: { startedAt: "desc" },
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            errorCode: true,
            failedCount: true,
          },
        }),
        this.jevToday(now),
      ]);
    const navRun: SyncRunSnapshot | null = nav
      ? {
          status: nav.status,
          at: nav.completedAt ?? nav.startedAt ?? nav.createdAt,
          errorCode: nav.errorCode,
        }
      : null;
    const run = (
      row: {
        status: string;
        startedAt: Date;
        completedAt: Date | null;
        errorCode: string | null;
        failedCount: number;
      } | null,
    ): SyncRunSnapshot | null =>
      row
        ? {
            status: row.status,
            at: row.completedAt ?? row.startedAt,
            errorCode: row.errorCode,
            failedCount: row.failedCount,
          }
        : null;
    const row = (
      source: DashboardSystemStatusWidgetData["sources"][number]["source"],
      snapshot: SyncRunSnapshot | null,
      state: SourceState,
    ) => ({
      source,
      state: state.state,
      lastRunStatus: snapshot?.status ?? null,
      lastRunAt: snapshot?.at ? snapshot.at.toISOString() : null,
      errorCode: snapshot?.errorCode ?? null,
      detail: state.detail,
    });
    const runs = {
      MAIL: run(mail),
      FOXPOST: run(foxpost),
      GLS: run(gls),
      SIMPLEPAY: run(simplePay),
      EBIZ: run(ebiz),
    };
    const jevToday = {
      runs: today.reduce((sum, r) => sum + r.count, 0),
      errors: today
        .filter((r) => r.status === "ERROR")
        .reduce((sum, r) => sum + r.count, 0),
    };
    return {
      sources: [
        row(
          "NAV",
          navRun,
          navState(navRun, verification?.verificationStatus ?? null),
        ),
        row("MAIL", runs.MAIL, syncRunState(runs.MAIL)),
        row("FOXPOST", runs.FOXPOST, syncRunState(runs.FOXPOST)),
        row("GLS", runs.GLS, syncRunState(runs.GLS)),
        row("SIMPLEPAY", runs.SIMPLEPAY, syncRunState(runs.SIMPLEPAY)),
        row("EBIZ", runs.EBIZ, ebizState(ebizApiKey(env) !== null, runs.EBIZ)),
        row("JEV", null, jevState(jevToday)),
      ],
    };
  }

  /** Today's (Budapest) decision runs by status. */
  private async jevToday(
    now: Date,
  ): Promise<{ status: "OK" | "ERROR"; count: number }[]> {
    const groups = await this.database.decisionRun.groupBy({
      by: ["status"],
      where: { createdAt: { gte: startOfBudapestDay(now) } },
      _count: { _all: true },
    });
    return groups.map((group) => ({
      status: group.status,
      count: group._count._all,
    }));
  }
}
