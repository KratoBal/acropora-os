import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Prisma, prisma } from "@acropora/database";
import { OpgError } from "./opg-xml.js";
import { parseReceipts } from "./opg-receipts.js";
import type { OpgFile, RegisterStatus } from "./opg-client.js";
@Injectable()
export class CashRegisterRepository {
  async startRun(trigger: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.cashRegisterSyncRun.updateMany({
          where: {
            activeKey: "OPG",
            updatedAt: { lt: new Date(Date.now() - 30 * 60000) },
          },
          data: {
            activeKey: null,
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "OPG_RUN_ABANDONED",
          },
        });
        return tx.cashRegisterSyncRun.create({
          data: { activeKey: "OPG", trigger },
        });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        throw new OpgError("OPG_ALREADY_RUNNING");
      throw e;
    }
  }
  async heartbeat(runId: string) {
    const result = await prisma.cashRegisterSyncRun.updateMany({
      where: { id: runId, activeKey: "OPG" },
      data: { updatedAt: new Date() },
    });
    if (!result.count) throw new OpgError("OPG_LEASE_LOST");
  }
  async finish(
    runId: string,
    counts: {
      filesFetched: number;
      receiptsCreated: number;
      gapsRecorded: number;
    },
    errorCode?: string,
  ) {
    await prisma.cashRegisterSyncRun.updateMany({
      where: { id: runId, activeKey: "OPG" },
      data: {
        ...counts,
        activeKey: null,
        status: errorCode ? "FAILED" : "SUCCEEDED",
        completedAt: new Date(),
        errorCode,
      },
    });
  }
  async prepare(status: RegisterStatus) {
    return prisma.$transaction(async (tx) => {
      const register = await tx.cashRegister.upsert({
        where: { apNumber: status.apNumber },
        create: {
          apNumber: status.apNumber,
          lastFileNumber: Math.max(0, status.min - 1),
          lastSeenAt: new Date(),
        },
        update: { lastSeenAt: new Date() },
      });
      const cursor = register.lastFileNumber ?? Math.max(0, status.min - 1);
      let gap = 0;
      if (cursor + 1 < status.min) {
        await tx.cashRegisterGap.upsert({
          where: {
            apNumber_fromFileNumber_toFileNumber: {
              apNumber: status.apNumber,
              fromFileNumber: cursor + 1,
              toFileNumber: status.min - 1,
            },
          },
          create: {
            apNumber: status.apNumber,
            fromFileNumber: cursor + 1,
            toFileNumber: status.min - 1,
            reason: "NAV_RETENTION_EXPIRED",
          },
          update: {},
        });
        gap = 1;
      }
      const next = Math.max(cursor + 1, status.min);
      await tx.cashRegister.update({
        where: { apNumber: status.apNumber },
        data: { lastFileNumber: Math.max(cursor, next - 1) },
      });
      return { next, gap };
    });
  }
  async existing(apNumber: string, min: number, max: number) {
    const files = await prisma.cashRegisterFile.findMany({
      where: { apNumber, fileNumber: { gte: min, lte: max } },
      select: { fileNumber: true },
    });
    return new Set(files.map((f) => f.fileNumber));
  }
  async save(file: OpgFile, runId: string) {
    const receipts = parseReceipts(file.xml, file.apNumber, file.number),
      hash = createHash("sha256").update(file.xml).digest("hex");
    return prisma.$transaction(async (tx) => {
      // Fence stale runs before file/cursor changes; update obtains the row lock.
      const lease = await tx.cashRegisterSyncRun.updateMany({
        where: { id: runId, activeKey: "OPG" },
        data: { updatedAt: new Date() },
      });
      if (!lease.count) throw new OpgError("OPG_LEASE_LOST");
      const existing = await tx.cashRegisterFile.findUnique({
        where: {
          apNumber_fileNumber: {
            apNumber: file.apNumber,
            fileNumber: file.number,
          },
        },
      });
      if (existing) {
        if (existing.payloadSha256 !== hash)
          throw new OpgError("OPG_FILE_CHANGED");
        return 0;
      }
      const register = await tx.cashRegister.findUniqueOrThrow({
        where: { apNumber: file.apNumber },
      });
      const cursor = register.lastFileNumber ?? file.number - 1;
      if (file.number > cursor + 1) throw new OpgError("OPG_FILE_GAP");
      await tx.cashRegisterFile.create({
        data: {
          apNumber: file.apNumber,
          fileNumber: file.number,
          fileName: file.name,
          validationCode: file.validation,
          payloadGzip: gzipSync(file.xml),
          payloadSha256: hash,
          receipts: {
            create: receipts.map(({ lines, payments, ...receipt }) => ({
              ...receipt,
              apNumber: file.apNumber,
              payments: payments as unknown as Prisma.InputJsonValue,
              lines: { create: lines },
            })),
          },
        },
      });
      if (file.number === cursor + 1)
        await tx.cashRegister.update({
          where: { apNumber: file.apNumber },
          data: { lastFileNumber: file.number },
        });
      return receipts.length;
    });
  }
}
