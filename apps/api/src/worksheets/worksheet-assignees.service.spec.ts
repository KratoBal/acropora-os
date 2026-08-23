import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";
import type {
  WorksheetDetailRow,
  WorksheetVersionRow,
} from "./worksheets.types.js";

const CREATED_AT = new Date("2026-06-15T08:00:00.000Z");
const ASSIGNED_AT = new Date("2026-06-15T09:30:00.000Z");

function decimal(value: string) {
  return new Prisma.Decimal(value);
}

function versionRow(): WorksheetVersionRow {
  return {
    id: "version-1",
    worksheetId: "worksheet-1",
    version: 1,
    status: "DRAFT",
    subject: "Cápasuli kompresszorok bevizsgálása",
    unitName: "PP Üzemeltetés",
    description: null,
    issueDate: null,
    fulfillmentDate: null,
    dueDate: null,
    currency: "HUF",
    netAmount: decimal("0"),
    vatAmount: decimal("0"),
    grossAmount: decimal("0"),
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
  };
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
    assignableUserIds: async (ids: readonly string[]) => new Set(ids),
    setAssignees: async () => ({ ok: true, added: [] }),
    ...overrides,
  } as unknown as WorksheetsRepository;
}

describe("WorksheetsService assignees", () => {
  it("refuses a colleague whose role cannot edit the worksheet", async () => {
    let written = false;
    const service = new WorksheetsService(
      repository({
        assignableUserIds: async () => new Set(["user-2"]),
        setAssignees: async () => {
          written = true;
          return { ok: true, added: [] };
        },
      }),
    );

    await assert.rejects(
      service.setAssignees(
        "worksheet-1",
        { userIds: ["user-2", "user-3"] },
        "user-1",
      ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("szerepköre"),
    );
    // A visszautasított listából EGYIK nevet sem szabad kiosztani: a
    // félig végrehajtott kiosztás rosszabb, mint a semmi.
    assert.equal(written, false);
  });

  it("assigns the same person once, however many times the form sent them", async () => {
    let received: readonly string[] = [];
    const service = new WorksheetsService(
      repository({
        setAssignees: async (input: { userIds: readonly string[] }) => {
          received = input.userIds;
          return { ok: true, added: [] };
        },
      }),
    );

    await service.setAssignees(
      "worksheet-1",
      { userIds: ["user-2", " user-2 ", "user-3"] },
      "user-1",
    );
    assert.deepEqual(received, ["user-2", "user-3"]);
  });

  it("accepts an empty list: a wrongly assigned worksheet can be taken back", async () => {
    let received: readonly string[] | null = null;
    const service = new WorksheetsService(
      repository({
        assignableUserIds: async () => {
          throw new Error("Ures listahoz nem kell felhasznalot ellenorizni.");
        },
        setAssignees: async (input: { userIds: readonly string[] }) => {
          received = input.userIds;
          return { ok: true, added: [] };
        },
      }),
    );

    await service.setAssignees("worksheet-1", { userIds: [] }, "user-1");
    assert.deepEqual(received, []);
  });

  it("reports a missing worksheet instead of silently doing nothing", async () => {
    const service = new WorksheetsService(
      repository({ detail: async () => null }),
    );
    await assert.rejects(
      service.setAssignees("worksheet-1", { userIds: [] }, "user-1"),
      NotFoundException,
    );
  });

  it("reports a worksheet deleted between the check and the write", async () => {
    const service = new WorksheetsService(
      repository({ setAssignees: async () => false }),
    );
    await assert.rejects(
      service.setAssignees("worksheet-1", { userIds: [] }, "user-1"),
      NotFoundException,
    );
  });

  // A kiosztás belső munkaszervezés, ezért a felületre a becenév kerül. A
  // hivatalos név a dokumentumon marad (aláírás), ahol az számít.
  it("shows an assignee by the name the team calls them", async () => {
    const service = new WorksheetsService(
      repository({
        detail: async () =>
          worksheetRow({
            assignees: [
              {
                userId: "user-2",
                assignedAt: ASSIGNED_AT,
                user: { displayName: "Nagy Sándor", nickname: "Sanyi" },
              },
              {
                userId: "user-3",
                assignedAt: ASSIGNED_AT,
                user: { displayName: "Kiss Péter", nickname: null },
              },
            ],
          }),
      }),
    );

    const detail = await service.detail("worksheet-1");
    assert.deepEqual(detail.assignees, [
      {
        userId: "user-2",
        name: "Sanyi",
        assignedAt: ASSIGNED_AT.toISOString(),
      },
      {
        userId: "user-3",
        name: "Kiss Péter",
        assignedAt: ASSIGNED_AT.toISOString(),
      },
    ]);
  });

  /**
   * Only the colleagues who were not already responsible. Saving the same
   * sheet again, or adding a second name, must not buzz the phone of somebody
   * who has been on it all along - the office corrects a line far more often
   * than it hands work over.
   */
  it("notifies the colleagues who are new to the sheet, and only them", async () => {
    const notified: Array<{ userIds: readonly string[]; subject: string }> = [];
    const service = new WorksheetsService(
      repository({
        setAssignees: async () => ({ ok: true, added: ["user-3"] }),
      }),
      {
        notifyWorksheetAssignment: (notice: {
          userIds: readonly string[];
          subject: string;
        }) => {
          notified.push(notice);
        },
      } as never,
    );

    await service.setAssignees(
      "worksheet-1",
      { userIds: ["user-2", "user-3"] },
      "user-1",
    );

    assert.equal(notified.length, 1);
    assert.deepEqual(notified[0]?.userIds, ["user-3"]);
  });

  it("stays quiet when the same people are saved again", async () => {
    let notified = 0;
    const service = new WorksheetsService(
      repository({ setAssignees: async () => ({ ok: true, added: [] }) }),
      {
        notifyWorksheetAssignment: () => {
          notified += 1;
        },
      } as never,
    );

    await service.setAssignees(
      "worksheet-1",
      { userIds: ["user-2"] },
      "user-1",
    );

    assert.equal(notified, 0);
  });
});
