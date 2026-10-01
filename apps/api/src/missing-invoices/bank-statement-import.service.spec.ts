import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import type { BankStatementImportRepository } from "./bank-statement-import.repository.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";

const USER = { id: "user-1" } as AuthenticatedUser;
const BOOKED =
  '"1171400626009841";T;-23810;HUF;20260810;20260810;;;"Alza";"55,380EUR";;;KÁRTYÁS VÁSÁRLÁS;;';
const PENDING =
  '"1171400626009841";T;-12990;HUF;;;;;"FIGMA";"2026.09.29 7413124583 FIGMA";;;Kártyás művelet;;';
const file = (lines: string[]) => ({
  originalname: "export-3.csv",
  buffer: Buffer.from(lines.join("\r\n"), "utf8"),
});

/*
  A FÜGGŐ KÁRTYÁS TÉTEL A VÁLASZBAN (acrobot 25637). MI PIROSÍT: ha a függő sor
  elutasítottnak számítana; ha a válasz nem nevezné meg; ha egy csak függő
  sorokból álló fájl az „olvashatatlan” vagy az „üres” mondatot kapná.
*/
describe("BankStatementImportService, pending card lines", () => {
  const service = () => {
    const imported: number[] = [];
    const repository = {
      importRows: async (input: { rows: unknown[]; rejectedCount: number }) => {
        imported.push(input.rows.length, input.rejectedCount);
        return { importId: "imp-1", createdCount: input.rows.length };
      },
    } as unknown as BankStatementImportRepository;
    return { service: new BankStatementImportService(repository), imported };
  };

  it("names the pending lines apart from the rejected ones", async () => {
    const { service: s, imported } = service();
    const result = await s.import(file([BOOKED, PENDING]), USER);
    assert.deepEqual(
      [
        result.rowCount,
        result.rejectedCount,
        result.pendingCount,
        result.pending,
        imported,
      ],
      [
        1,
        0,
        1,
        [{ line: 2, partner: "FIGMA", amount: "12990", currency: "HUF" }],
        [1, 0],
      ],
    );
  });

  it("a file of pending lines only says so", async () => {
    const { service: s } = service();
    await assert.rejects(
      s.import(file([PENDING]), USER),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /csak függő kártyás tétel/.test(error.message),
    );
  });
});
