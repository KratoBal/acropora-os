import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import type { PaymentMarkSource } from "../../integrations/szamlazz/outgoing-payment-marks.js";
import type { PaidMarksRunResult } from "./paid-marks-auto.js";

/** The automatic paid-mark runs (`PaidMarkRun`), and the latest one per source. */
@Injectable()
export class PaidMarkRunRepository {
  async save(result: PaidMarksRunResult): Promise<void> {
    await prisma.paidMarkRun.create({
      data: {
        source: result.source,
        finishedAt: new Date(),
        writtenCount: result.writtenCount,
        failedCount: result.failedCount,
        attentionCount: result.attention.length,
        summary: result.summary as Prisma.InputJsonValue,
        attention: result.attention as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async saveFailed(
    source: PaymentMarkSource,
    errorCode: string,
  ): Promise<void> {
    await prisma.paidMarkRun.create({
      data: {
        source,
        finishedAt: new Date(),
        summary: {},
        attention: [],
        errorCode,
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
      },
    });
    return rows.map((row) => ({
      ...row,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    }));
  }
}
