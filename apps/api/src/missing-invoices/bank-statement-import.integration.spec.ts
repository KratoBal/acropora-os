import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { BankStatementImportRepository } from "./bank-statement-import.repository.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";

/**
 * A KIVONAT-FELTÖLTÉS VALÓDI ADATBÁZISON: a bankszámla egyszer jön létre; a
 * második, átfedő export csak az új sorát írja be; ugyanaz a fájl másodszor
 * semmit; egy exporton belüli két azonos sor két tétel.
 */
const gate = integrationDatabaseGate(process.env);
const ACCOUNT = "9999000011112222";
const IMPORTER = "missing-invoices-it";
const USER = { id: IMPORTER } as AuthenticatedUser;

const line = (day: string, amount: number, name: string) =>
  `"${ACCOUNT}";T;-${amount};HUF;${day};${day};;;"${name}";"teszt";;;KÁRTYÁS VÁSÁRLÁS;;`;
const file = (name: string, lines: string[]) => ({
  originalname: name,
  buffer: Buffer.from(lines.join("\r\n"), "utf8"),
});

async function removeLeftovers() {
  await prisma.bankTransaction.deleteMany({
    where: { bankAccount: { accountNumber: ACCOUNT } },
  });
  await prisma.bankStatementImport.deleteMany({
    where: { importedByUserId: IMPORTER },
  });
  await prisma.bankAccount.deleteMany({ where: { accountNumber: ACCOUNT } });
}

describe("a havi kivonat feltöltése", { skip: gate.mode === "skip" }, () => {
  const service = new BankStatementImportService(
    new BankStatementImportRepository(),
  );

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
  });

  after(async () => {
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "a suite bankszámlája bent maradt",
        darab: await prisma.bankAccount.count({
          where: { accountNumber: ACCOUNT },
        }),
      },
    ]);
  });

  it("writes each payment once across overlapping exports, and keeps two identical payments of one export", async () => {
    const july = file("export-24.csv", [
      line("20260730", 1000, "Bolt"),
      line("20260803", 23810, "Alza"),
      line("20260803", 23810, "Alza"),
    ]);
    const first = await service.import(july, USER);
    assert.deepEqual(
      [first.rowCount, first.createdCount, first.skippedCount],
      [3, 3, 0],
    );
    assert.deepEqual(first.months, ["2026-07", "2026-08"]);

    // the August export repeats the overlapping day, and adds one new row
    const august = file("export-27.csv", [
      line("20260803", 23810, "Alza"),
      line("20260803", 23810, "Alza"),
      line("20260805", 500, "Posta"),
    ]);
    const second = await service.import(august, USER);
    assert.deepEqual([second.createdCount, second.skippedCount], [1, 2]);

    const again = await service.import(july, USER);
    assert.deepEqual([again.createdCount, again.skippedCount], [0, 3]);

    assert.equal(
      await prisma.bankAccount.count({ where: { accountNumber: ACCOUNT } }),
      1,
    );
    assert.equal(
      await prisma.bankTransaction.count({
        where: { bankAccount: { accountNumber: ACCOUNT } },
      }),
      4,
    );
  });
});
