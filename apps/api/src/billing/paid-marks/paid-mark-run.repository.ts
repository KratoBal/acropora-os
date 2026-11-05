import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import type { PaymentMarkSource } from "../../integrations/szamlazz/outgoing-payment-marks.js";
import type { PaidMarkPlanned, PaidMarksRunResult } from "./paid-marks-auto.js";

/** Who started a run: the daily timer, or a person with "Futtatás most" (e64540fd). */
export type PaidMarkTrigger =
  { kind: "schedule" } | { kind: "manual"; userId: string };

const triggerData = (trigger: PaidMarkTrigger) => ({
  trigger: trigger.kind,
  triggeredById: trigger.kind === "manual" ? trigger.userId : null,
});

/** The automatic paid-mark runs (`PaidMarkRun`), and the latest one per source. */
@Injectable()
export class PaidMarkRunRepository {
  async save(
    result: PaidMarksRunResult,
    trigger: PaidMarkTrigger = { kind: "schedule" },
  ): Promise<void> {
    await prisma.paidMarkRun.create({
      data: {
        source: result.source,
        finishedAt: new Date(),
        writtenCount: result.writtenCount,
        failedCount: result.failedCount,
        attentionCount: result.attention.length,
        summary: result.summary as Prisma.InputJsonValue,
        attention: result.attention as unknown as Prisma.InputJsonValue,
        mode: "auto",
        ...triggerData(trigger),
      },
    });
  }

  /** A dry run: what it WOULD mark paid, nothing written (the source's switch on dry). */
  async saveDry(
    result: PaidMarksRunResult,
    planned: readonly PaidMarkPlanned[],
    trigger: PaidMarkTrigger = { kind: "schedule" },
  ): Promise<void> {
    await prisma.paidMarkRun.create({
      data: {
        source: result.source,
        finishedAt: new Date(),
        attentionCount: result.attention.length,
        summary: result.summary as Prisma.InputJsonValue,
        attention: result.attention as unknown as Prisma.InputJsonValue,
        planned: planned as unknown as Prisma.InputJsonValue,
        mode: "dry",
        ...triggerData(trigger),
      },
    });
  }

  async saveFailed(
    source: PaymentMarkSource,
    errorCode: string,
    trigger: PaidMarkTrigger = { kind: "schedule" },
    mode: "auto" | "dry" = "auto",
  ): Promise<void> {
    await prisma.paidMarkRun.create({
      data: {
        source,
        finishedAt: new Date(),
        summary: {},
        attention: [],
        errorCode,
        mode,
        ...triggerData(trigger),
      },
    });
  }

  /** The latest run of every source that has one. */
  async latest() {
    const rows = await prisma.paidMarkRun.findMany({
      orderBy: { startedAt: "desc" },
      distinct: ["source"],
      select: {
        source: true,
        startedAt: true,
        finishedAt: true,
        writtenCount: true,
        failedCount: true,
        attentionCount: true,
        summary: true,
        attention: true,
        errorCode: true,
        mode: true,
        trigger: true,
        triggeredById: true,
        planned: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    }));
  }
}
