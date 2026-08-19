import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import type { CreateWorksheetLineDto } from "./dto/worksheet.dto.js";
import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";
import type {
  WorksheetDetailRow,
  WorksheetLineWriteResult,
  WorksheetVersionRow,
} from "./worksheets.types.js";

const CREATED_AT = new Date("2026-06-15T08:00:00.000Z");

function decimal(value: string) {
  return new Prisma.Decimal(value);
}

function versionRow(
  overrides: Partial<WorksheetVersionRow> = {},
): WorksheetVersionRow {
  return {
    id: "version-1",
    worksheetId: "worksheet-1",
    version: 1,
    status: "DRAFT",
    subject: "Cápasuli kompresszorok bevizsgálása",
    unitName: "PP Üzemeltetés",
    description: null,
    issueDate: new Date("2026-06-15T00:00:00.000Z"),
    fulfillmentDate: null,
    dueDate: null,
    currency: "HUF",
    netAmount: decimal("30000"),
    vatAmount: decimal("8100"),
    grossAmount: decimal("38100"),
    changeReason: null,
    createdById: "user-1",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    closedAt: null,
    closedById: null,
    createdBy: { displayName: "Teszt Elek" },
    closedBy: null,
    signature: null,
    lines: [],
    ...overrides,
  } as WorksheetVersionRow;
}

function worksheetRow(
  overrides: Partial<WorksheetDetailRow> = {},
): WorksheetDetailRow {
  return {
    id: "worksheet-1",
    number: null,
    numberYear: null,
    sequence: null,
    customerId: "customer-1",
    departmentId: "department-1",
    createdById: "user-1",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    customer: {
      id: "customer-1",
      customerNumber: "VEVO-1",
      displayName: "Fővárosi Állat- És Növénykert",
      worksheetPartnerCode: "FANK",
    },
    department: {
      id: "department-1",
      code: "BIO",
      name: "Biodóm",
      isActive: true,
    },
    createdBy: { displayName: "Teszt Elek" },
    assignees: [],
    versions: [versionRow()],
    ...overrides,
  } as WorksheetDetailRow;
}

function repository(
  overrides: Partial<Record<keyof WorksheetsRepository, unknown>> = {},
) {
  return {
    detail: async () => worksheetRow(),
    existingAssetIds: async () => new Set<string>(),
    addLine: async (): Promise<WorksheetLineWriteResult> => ({
      outcome: "ok",
      alreadyPresent: false,
    }),
    updateLine: async (): Promise<WorksheetLineWriteResult> => ({
      outcome: "ok",
      alreadyPresent: false,
    }),
    removeLine: async (): Promise<WorksheetLineWriteResult> => ({
      outcome: "ok",
      alreadyPresent: false,
    }),
    ...overrides,
  } as unknown as WorksheetsRepository;
}

function lineDto(
  overrides: Partial<CreateWorksheetLineDto> = {},
): CreateWorksheetLineDto {
  return {
    description: "Kompresszor bevizsgálás",
    quantity: 2,
    unit: "óra",
    unitNet: 15000,
    vatRatePercent: 27,
    ...overrides,
  } as CreateWorksheetLineDto;
}

describe("worksheet line endpoints", () => {
  describe("addLine", () => {
    it("writes one line without touching the rest of the sheet", async () => {
      // This is the whole reason line endpoints exist: a worksheet can have
      // several people on it, and the whole-content save deletes everybody
      // else's lines on every write.
      let received: unknown;
      const service = new WorksheetsService(
        repository({
          addLine: async (input: unknown) => {
            received = input;
            return { outcome: "ok", alreadyPresent: false };
          },
        }),
      );

      await service.addLine("worksheet-1", lineDto());

      assert.equal(
        (received as { versionId: string }).versionId,
        "version-1",
        "a sor a jelenlegi piszkozat-verzióra megy",
      );
    });

    it("computes the amounts on the server, never from the client", async () => {
      let received: { line: { netAmount: Prisma.Decimal } } | undefined;
      const service = new WorksheetsService(
        repository({
          addLine: async (input: unknown) => {
            received = input as typeof received;
            return { outcome: "ok", alreadyPresent: false };
          },
        }),
      );

      await service.addLine("worksheet-1", lineDto());

      assert.equal(received?.line.netAmount.toString(), "30000");
    });

    it("takes the client's id, so a resent line is not a second line", async () => {
      // The phone queues work offline and resends what it could not
      // deliver. With a server-generated id, that resend would silently
      // duplicate every line the technician recorded.
      let received: { lineId: string } | undefined;
      const service = new WorksheetsService(
        repository({
          addLine: async (input: unknown) => {
            received = input as typeof received;
            return { outcome: "ok", alreadyPresent: false };
          },
        }),
      );

      await service.addLine("worksheet-1", lineDto({ id: "line-from-phone" }));

      assert.equal(received?.lineId, "line-from-phone");
    });

    it("invents an id only when the client did not bring one", async () => {
      let received: { lineId: string } | undefined;
      const service = new WorksheetsService(
        repository({
          addLine: async (input: unknown) => {
            received = input as typeof received;
            return { outcome: "ok", alreadyPresent: false };
          },
        }),
      );

      await service.addLine("worksheet-1", lineDto());

      assert.ok(received?.lineId);
      assert.notEqual(received?.lineId, "");
    });

    it("accepts a line that was already written, because a resend is not a failure", async () => {
      const service = new WorksheetsService(
        repository({
          addLine: async (): Promise<WorksheetLineWriteResult> => ({
            outcome: "ok",
            alreadyPresent: true,
          }),
        }),
      );

      await service.addLine("worksheet-1", lineDto({ id: "line-1" }));
    });

    it("refuses to add a line to a closed sheet", async () => {
      const service = new WorksheetsService(
        repository({
          detail: async () =>
            worksheetRow({ versions: [versionRow({ status: "SIGNED" })] }),
        }),
      );

      await assert.rejects(
        () => service.addLine("worksheet-1", lineDto()),
        ConflictException,
      );
    });

    it("reports a conflict when the sheet was closed mid-write", async () => {
      const service = new WorksheetsService(
        repository({
          addLine: async (): Promise<WorksheetLineWriteResult> => ({
            outcome: "version-gone",
          }),
        }),
      );

      await assert.rejects(
        () => service.addLine("worksheet-1", lineDto()),
        ConflictException,
      );
    });
  });

  describe("updateLine", () => {
    it("replaces the line it was given", async () => {
      let received: { lineId: string } | undefined;
      const service = new WorksheetsService(
        repository({
          updateLine: async (input: unknown) => {
            received = input as typeof received;
            return { outcome: "ok", alreadyPresent: false };
          },
        }),
      );

      await service.updateLine("worksheet-1", "line-9", lineDto());

      assert.equal(received?.lineId, "line-9");
    });

    it("says so when the line is gone", async () => {
      const service = new WorksheetsService(
        repository({
          updateLine: async (): Promise<WorksheetLineWriteResult> => ({
            outcome: "line-gone",
          }),
        }),
      );

      await assert.rejects(
        () => service.updateLine("worksheet-1", "missing", lineDto()),
        NotFoundException,
      );
    });
  });

  describe("removeLine", () => {
    it("removes the line it was given", async () => {
      let received: { lineId: string } | undefined;
      const service = new WorksheetsService(
        repository({
          removeLine: async (input: unknown) => {
            received = input as typeof received;
            return { outcome: "ok", alreadyPresent: false };
          },
        }),
      );

      await service.removeLine("worksheet-1", "line-9");

      assert.equal(received?.lineId, "line-9");
    });

    it("treats a repeated delete as done, not as an error", async () => {
      // Same reasoning as the resent line: the queue retries, and the
      // second attempt finds nothing to delete. That is the requested
      // state, not a failure.
      const service = new WorksheetsService(
        repository({
          removeLine: async (): Promise<WorksheetLineWriteResult> => ({
            outcome: "ok",
            alreadyPresent: true,
          }),
        }),
      );

      await service.removeLine("worksheet-1", "line-9");
    });

    it("refuses to remove from a closed sheet", async () => {
      const service = new WorksheetsService(
        repository({
          detail: async () =>
            worksheetRow({ versions: [versionRow({ status: "SIGNED" })] }),
        }),
      );

      await assert.rejects(
        () => service.removeLine("worksheet-1", "line-9"),
        ConflictException,
      );
    });
  });
});
