import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import { prisma } from "@acropora/database";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { CashRegisterRepository } from "./cash-register.repository.js";
import { receiptList } from "./cash-register.controller.js";
const gate = integrationDatabaseGate(process.env);
if (gate.mode === "refuse") throw new Error(gate.reason);
describe(
  "OPG transaction and reporting",
  { skip: gate.mode === "skip" },
  () => {
    const repo = new CashRegisterRepository(),
      apNumber = "A09999999";
    let runId: string;
    const xml = Buffer.from(
      readFileSync(
        new URL(
          "../../src/cash-registers/fixtures/A01413081-11575.xml",
          import.meta.url,
        ),
        "utf8",
      )
        .replaceAll("A01413081", apNumber)
        .replaceAll("2026-10-03", "2099-10-03"),
    );
    const file = {
      apNumber,
      number: 11575,
      name: `${apNumber}_12345678_20991003095247_11575.p7b`,
      validation: "OK",
      xml,
    };
    it("creates register and a fenced run, rejects concurrent runs", async () => {
      await repo.prepare({ apNumber, min: 11575, max: 11579 });
      runId = (await repo.startRun("TEST")).id;
      await assert.rejects(repo.startRun("TEST"), /OPG_ALREADY_RUNNING/);
    });
    it("writes all lines and the cursor atomically and replays without duplicates", async () => {
      assert.equal(await repo.save(file, runId), 7);
      assert.equal(await repo.save(file, runId), 0);
      assert.equal(
        await prisma.cashRegisterReceipt.count({ where: { apNumber } }),
        7,
      );
      assert.equal(
        (await prisma.cashRegister.findUniqueOrThrow({ where: { apNumber } }))
          .lastFileNumber,
        11575,
      );
      const stored = await prisma.cashRegisterFile.findUniqueOrThrow({
        where: { apNumber_fileNumber: { apNumber, fileNumber: 11575 } },
      });
      assert.deepEqual(gunzipSync(stored.payloadGzip), xml);
      assert.equal(
        (
          await prisma.cashRegisterReceipt.findFirstOrThrow({
            where: { apNumber, receiptNumber: "2820/00002" },
            include: { lines: true },
          })
        ).lines.length,
        5,
      );
    });
    it("uses all receipts in daily totals, exact payment means and lists lines", async () => {
      const result = await receiptList("2099-10-03", 1);
      assert.equal(result.total, 7);
      assert.equal(result.summary.total, "469890");
      assert.deepEqual(
        Object.fromEntries(
          result.summary.payments.map((p) => [p.category, p.amount]),
        ),
        { CARD: "458090", CASH: "11800" },
      );
      assert.equal(result.items[0]!.lines[0]!.name, "GYŰJTŐ 1");
    });
    it("rejects identity errors, gaps and changed files without cursor advancement", async () => {
      await assert.rejects(
        repo.save({ ...file, number: 11577 }, runId),
        /OPG_LOG_IDENTITY_MISMATCH/,
      );
      await assert.rejects(
        repo.save(
          {
            ...file,
            number: 11577,
            xml: Buffer.from(
              xml.toString().replace("<LFN>11575", "<LFN>11577"),
            ),
          },
          runId,
        ),
        /OPG_FILE_GAP/,
      );
      await assert.rejects(
        repo.save(
          {
            ...file,
            xml: Buffer.from(xml.toString().replace("<SUM>2000", "<SUM>2001")),
          },
          runId,
        ),
        /OPG_FILE_CHANGED/,
      );
      assert.equal(
        (await prisma.cashRegister.findUniqueOrThrow({ where: { apNumber } }))
          .lastFileNumber,
        11575,
      );
    });
    it("records expired ranges and moves the cursor in the same transaction", async () => {
      const result = await repo.prepare({ apNumber, min: 11578, max: 11579 });
      assert.deepEqual(result, { next: 11578, gap: 1 });
      assert.equal(
        (await prisma.cashRegisterGap.findFirstOrThrow({ where: { apNumber } }))
          .fromFileNumber,
        11576,
      );
      assert.equal(
        (await prisma.cashRegisterGap.findFirstOrThrow({ where: { apNumber } }))
          .toFileNumber,
        11577,
      );
      await repo.prepare({ apNumber, min: 11578, max: 11579 });
      assert.equal(
        await prisma.cashRegisterGap.count({ where: { apNumber } }),
        1,
      );
      assert.ok(
        (await receiptList("2099-10-03", 1)).gaps.some(
          (g) => g.apNumber === apNumber,
        ),
      );
    });
    it("stores safe failure status and fences finished runs", async () => {
      await repo.finish(
        runId,
        { filesFetched: 1, receiptsCreated: 7, gapsRecorded: 1 },
        "OPG_FILE_GAP",
      );
      assert.equal(
        (
          await prisma.cashRegisterSyncRun.findUniqueOrThrow({
            where: { id: runId },
          })
        ).activeKey,
        null,
      );
      await assert.rejects(repo.save(file, runId), /OPG_LEASE_LOST/);
    });
    after(async () => {
      await prisma.cashRegisterReceiptLine.deleteMany({
        where: { receipt: { apNumber } },
      });
      await prisma.cashRegisterReceipt.deleteMany({ where: { apNumber } });
      await prisma.cashRegisterFile.deleteMany({ where: { apNumber } });
      await prisma.cashRegisterGap.deleteMany({ where: { apNumber } });
      await prisma.cashRegister.deleteMany({ where: { apNumber } });
      if (runId)
        await prisma.cashRegisterSyncRun.deleteMany({ where: { id: runId } });
      await prisma.$disconnect();
    });
  },
);
