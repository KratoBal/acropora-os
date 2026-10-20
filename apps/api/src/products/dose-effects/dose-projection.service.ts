import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { prisma } from "@acropora/database";

import { DoseEffectsService } from "./dose-effects.service.js";
import {
  type DoseProjectionStatus,
  type DoseProjectionTrigger,
  doseProjectionStatus,
  toProjectedRow,
} from "./dose-projection.rules.js";

/** Hourly: the purchasability and the JEV change outside the dose list too. */
export const DOSE_PROJECTION_INTERVAL_MS = 60 * 60 * 1000;
/** The first build after a start waits a little, so the start itself is not slowed. */
export const DOSE_PROJECTION_STARTUP_DELAY_MS = 30 * 1000;
const RUN_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** One number for `pg_advisory_xact_lock`: the rebuilds of two instances do not interleave. */
const ADVISORY_LOCK_KEY = 8_201_001;

export interface DoseProjectionOutcome {
  ok: boolean;
  rowCount: number;
  errorMessage: string | null;
}

/**
 * THE PROJECTION OF THE PRODUCT DOSE LIST (ReefClub plan v6.1, 6.2; slice 8;
 * path B, 2026-10-20). The ReefClub role may not read the product tables, so
 * the OS process rebuilds `ReefClubDoseRow` COMPLETELY, in one transaction,
 * and writes a SUCCEEDED run record in the SAME transaction (barracuda's
 * five conditions):
 *
 *   1  the ReefClub role only reads the table (reefclub-role.sql);
 *   2  the age is the last SUCCESSFUL full rebuild, from the run record, not a
 *      row's `updatedAt`;
 *   3  a full rebuild in one transaction, edit-triggered ones included: what
 *      left the source (a deleted row, an archived one, a row the JEV no
 *      longer agrees with) leaves the projection, and nothing is "kept live";
 *   4  the row version is the SOURCE's;
 *   5  a scheduled job, and its failure is a run record the status endpoint
 *      shows; the staleness gate is the safety net, not the alarm.
 *
 * A failed build changes NOTHING in the projection (the transaction rolls
 * back) and writes a FAILED record after it. Rebuilds run one after another
 * in this process; one waiting rebuild takes every request that comes while
 * it waits, and reads the state at the moment it starts.
 */
@Injectable()
export class DoseProjectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DoseProjectionService.name);
  private timer: NodeJS.Timeout | null = null;
  private startup: NodeJS.Timeout | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private queued: Promise<DoseProjectionOutcome> | null = null;

  constructor(private readonly doseEffects: DoseEffectsService) {}

  onModuleInit(): void {
    this.startup = setTimeout(() => {
      void this.rebuild("STARTUP");
    }, DOSE_PROJECTION_STARTUP_DELAY_MS);
    this.startup.unref();
    this.timer = setInterval(() => {
      void this.rebuild("SCHEDULE");
    }, DOSE_PROJECTION_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.startup) clearTimeout(this.startup);
    if (this.timer) clearInterval(this.timer);
    this.startup = null;
    this.timer = null;
  }

  /** Never rejects: a failure is a record and an outcome. */
  rebuild(trigger: DoseProjectionTrigger): Promise<DoseProjectionOutcome> {
    if (this.queued) return this.queued;
    const run = this.tail.then(() => {
      this.queued = null;
      return this.runOnce(trigger);
    });
    this.queued = run;
    this.tail = run;
    return run;
  }

  private async runOnce(
    trigger: DoseProjectionTrigger,
  ): Promise<DoseProjectionOutcome> {
    const startedAt = new Date();
    try {
      const views = await this.doseEffects.list({ includeArchived: true });
      const rows = views.map(toProjectedRow);
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;
          const run = await tx.reefClubDoseProjectionRun.create({
            data: {
              status: "SUCCEEDED",
              trigger,
              startedAt,
              finishedAt: new Date(),
              rowCount: rows.length,
            },
          });
          await tx.reefClubDoseRow.deleteMany({});
          await tx.reefClubDoseRow.createMany({
            data: rows.map((row) => ({ ...row, runId: run.id })),
          });
          await tx.reefClubDoseProjectionRun.deleteMany({
            where: {
              id: { not: run.id },
              finishedAt: { lt: new Date(Date.now() - RUN_KEEP_MS) },
            },
          });
        },
        { timeout: 60_000 },
      );
      return { ok: true, rowCount: rows.length, errorMessage: null };
    } catch (error) {
      const errorMessage = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 500);
      this.logger.warn(
        `A termék-adag lista vetítése elbukott: ${errorMessage}`,
      );
      try {
        await prisma.reefClubDoseProjectionRun.create({
          data: {
            status: "FAILED",
            trigger,
            startedAt,
            finishedAt: new Date(),
            errorMessage,
          },
        });
      } catch (recordError) {
        this.logger.error(
          `A vetítés hibája sem rögzíthető: ${recordError instanceof Error ? recordError.message : String(recordError)}`,
        );
      }
      return { ok: false, rowCount: 0, errorMessage };
    }
  }

  async status(now: Date = new Date()): Promise<DoseProjectionStatus> {
    const [success, failure, rowCount] = await Promise.all([
      prisma.reefClubDoseProjectionRun.findFirst({
        where: { status: "SUCCEEDED" },
        orderBy: { finishedAt: "desc" },
      }),
      prisma.reefClubDoseProjectionRun.findFirst({
        where: { status: "FAILED" },
        orderBy: { finishedAt: "desc" },
      }),
      prisma.reefClubDoseRow.count(),
    ]);
    return doseProjectionStatus({ success, failure, rowCount, now });
  }
}
