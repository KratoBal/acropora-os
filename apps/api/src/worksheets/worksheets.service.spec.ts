import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import type {
  AmendWorksheetDto,
  CreateWorksheetDto,
  UpdateWorksheetDraftDto,
} from "./dto/worksheet.dto.js";
import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";
import type {
  WorksheetDetailRow,
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
    fulfillmentDate: new Date("2026-06-15T00:00:00.000Z"),
    dueDate: new Date("2026-06-16T00:00:00.000Z"),
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
    lines: [
      {
        id: "line-1",
        worksheetVersionId: "version-1",
        position: 1,
        description: "Kompresszor bevizsgálás",
        detail: "LFX0.7-10 TM 50 230/1/50 CE",
        assetId: null,
        quantity: decimal("2"),
        unit: "óra",
        unitNet: decimal("15000"),
        vatRatePercent: decimal("27"),
        netAmount: decimal("30000"),
        vatAmount: decimal("8100"),
        grossAmount: decimal("38100"),
        asset: null,
      },
    ],
    ...overrides,
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
    continuesWorksheetId: null,
    continues: null,
    continuedBy: [],
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
      parentId: null,
      code: "BIO",
      name: "Biodóm",
      isActive: true,
    },
    createdBy: { displayName: "Teszt Elek" },
    assignees: [],
    versions: [versionRow()],
    ...overrides,
  };
}

function repository(
  overrides: Partial<Record<keyof WorksheetsRepository, unknown>> = {},
) {
  return {
    detail: async () => worksheetRow(),
    customer: async () => ({
      id: "customer-1",
      customerNumber: "VEVO-1",
      displayName: "Fővárosi Állat- És Növénykert",
      worksheetPartnerCode: "FANK",
      isActive: true,
    }),
    department: async () => ({
      id: "department-1",
      customerId: "customer-1",
      code: "BIO",
      isActive: true,
    }),
    existingAssetIds: async () => new Set<string>(),
    createDraft: async () => "worksheet-1",
    replaceDraftContent: async () => true,
    close: async () => ({ ok: true }),
    amend: async () => ({ ok: true, version: 2 }),
    sign: async () => ({ ok: true }),
    ...overrides,
  } as unknown as WorksheetsRepository;
}

function contentDto(): CreateWorksheetDto {
  return {
    customerId: "customer-1",
    departmentId: "department-1",
    subject: "Cápasuli kompresszorok bevizsgálása",
    lines: [
      {
        description: "Kompresszor bevizsgálás",
        quantity: 2,
        unit: "óra",
        unitNet: 15000,
        vatRatePercent: 27,
      },
    ],
  };
}

describe("WorksheetsService", () => {
  it("refuses to close a worksheet whose partner has no abbreviation", async () => {
    const service = new WorksheetsService(
      repository({
        close: async () => ({ ok: false, reason: "PARTNER_CODE_MISSING" }),
      }),
    );
    await assert.rejects(
      service.close("worksheet-1", "user-1"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("rövidítés"),
    );
  });

  it("refuses to close a worksheet without lines", async () => {
    const service = new WorksheetsService(
      repository({ close: async () => ({ ok: false, reason: "NO_LINES" }) }),
    );
    await assert.rejects(
      service.close("worksheet-1", "user-1"),
      BadRequestException,
    );
  });

  it("keeps a closed worksheet out of the draft editor", async () => {
    const service = new WorksheetsService(
      repository({
        detail: async () =>
          worksheetRow({
            number: "FANK-BIO-2026-001",
            numberYear: 2026,
            sequence: 1,
            versions: [
              versionRow({
                status: "AWAITING_SIGNATURE",
                closedAt: new Date("2026-06-16T08:00:00.000Z"),
              }),
            ],
          }),
      }),
    );
    await assert.rejects(
      service.updateDraft(
        "worksheet-1",
        contentDto() as UpdateWorksheetDraftDto,
      ),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes("új verziót"),
    );
  });

  it("refuses a new version while the worksheet is still a draft", async () => {
    const service = new WorksheetsService(
      repository({ amend: async () => ({ ok: false, reason: "NOT_CLOSED" }) }),
    );
    const input: AmendWorksheetDto = {
      ...contentDto(),
      changeReason: "Az ügyfél kérte a mennyiség javítását.",
    };
    await assert.rejects(
      service.amend("worksheet-1", input, "user-1"),
      ConflictException,
    );
  });

  it("refuses a signature on a version that is not awaiting one", async () => {
    const service = new WorksheetsService(
      repository({
        sign: async () => ({ ok: false, reason: "NOT_AWAITING_SIGNATURE" }),
      }),
    );
    await assert.rejects(
      service.sign(
        "worksheet-1",
        { decision: "ACCEPTED", signerName: "Kovács Béla" },
        "user-1",
      ),
      ConflictException,
    );
  });

  it("refuses a department that belongs to another partner", async () => {
    const service = new WorksheetsService(
      repository({
        department: async () => ({
          id: "department-9",
          customerId: "customer-9",
          code: "PPU",
          isActive: true,
        }),
      }),
    );
    await assert.rejects(
      service.create(contentDto(), "user-1"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("alegység"),
    );
  });

  /**
   * The id is the partner's mirror customer row, and every path that reaches
   * here started from a partner: the partner page, or the worksheet's partner
   * picker. Telling the reader the customer was not found names a record they
   * never chose.
   */
  it("names the partner, not the customer, when the record is missing", async () => {
    const service = new WorksheetsService(
      repository({ customer: async () => null }),
    );
    await assert.rejects(
      service.create(contentDto(), "user-1"),
      (error: unknown) =>
        error instanceof NotFoundException &&
        error.message.includes("partner") &&
        !/vev[őo]/i.test(error.message),
    );
  });

  it("refuses a line that points at an unknown asset", async () => {
    const input = contentDto();
    input.lines[0]!.assetId = "asset-missing";
    const service = new WorksheetsService(
      repository({ existingAssetIds: async () => new Set<string>() }),
    );
    await assert.rejects(
      service.create(input, "user-1"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("eszköz"),
    );
  });

  it("has nothing to compare on the first version", async () => {
    const service = new WorksheetsService(repository());
    await assert.rejects(service.diff("worksheet-1", 1), BadRequestException);
  });

  it("answers who changed what and why between two versions", async () => {
    const service = new WorksheetsService(
      repository({
        detail: async () =>
          worksheetRow({
            number: "FANK-BIO-2026-001",
            numberYear: 2026,
            sequence: 1,
            versions: [
              versionRow({
                id: "version-2",
                version: 2,
                status: "AWAITING_SIGNATURE",
                changeReason: "Az ügyfél kérte a mennyiség javítását.",
                closedAt: new Date("2026-06-20T08:00:00.000Z"),
                createdBy: { displayName: "Nagy Anna" },
                lines: [
                  {
                    ...versionRow().lines[0]!,
                    id: "line-2",
                    worksheetVersionId: "version-2",
                    quantity: decimal("3"),
                    netAmount: decimal("45000"),
                  },
                ],
                netAmount: decimal("45000"),
              }),
              versionRow({
                status: "SIGNED",
                closedAt: new Date("2026-06-16T08:00:00.000Z"),
              }),
            ],
          }),
      }),
    );

    const diff = await service.diff("worksheet-1", 2);
    assert.equal(diff.fromVersion, 1);
    assert.equal(diff.toVersion, 2);
    assert.equal(diff.changedByName, "Nagy Anna");
    assert.equal(diff.changeReason, "Az ügyfél kérte a mennyiség javítását.");
    assert.deepEqual(
      diff.changes.map((change) => change.field),
      ["netAmount", "lines.1.quantity", "lines.1.netAmount"],
    );
  });

  /**
   * AZ ELUTASÍTÁS OKA KÖTELEZŐ (Balázs döntése, 2026-08-26), ÉS A SZERVEREN AZ.
   *
   * Indok nélkül a visszautasítás annyit mond, hogy „nem", és sem a lapon
   * dolgozó szerelő, sem a hibajegy kezelője nem tudja, mit kell javítani. A
   * felületen kötelezővé tett mező nem elég: a végpont a felületet megkerülve is
   * hívható, és akkor a lapon egy néma elutasítás állna.
   *
   * A tároló hívása is állítás: az elutasításnak EL SEM KELL JUTNIA odáig.
   */
  it("refuses a rejection with no reason, before it reaches the store", async () => {
    let signCalled = false;
    const service = new WorksheetsService(
      repository({
        sign: async () => {
          signCalled = true;
          return { ok: true };
        },
      }),
    );

    await assert.rejects(
      service.sign(
        "worksheet-1",
        { decision: "REJECTED", signerName: "Kovács Béla" },
        "user-1",
      ),
      BadRequestException,
    );
    assert.equal(signCalled, false);
  });

  it("treats a reason of only whitespace as no reason", async () => {
    const service = new WorksheetsService(repository());

    await assert.rejects(
      service.sign(
        "worksheet-1",
        { decision: "REJECTED", signerName: "Kovács Béla", note: "   " },
        "user-1",
      ),
      BadRequestException,
    );
  });

  it("lets a rejection through once it says why", async () => {
    let received: { note?: string | null } | null = null;
    const service = new WorksheetsService(
      repository({
        sign: async (input: { note?: string | null }) => {
          received = input;
          return { ok: true };
        },
      }),
    );

    await service.sign(
      "worksheet-1",
      {
        decision: "REJECTED",
        signerName: "Kovács Béla",
        note: "A 3. sor mennyisége nem egyezik a leszállítottal.",
      },
      "user-1",
    );

    assert.equal(
      (received as { note?: string | null } | null)?.note,
      "A 3. sor mennyisége nem egyezik a leszállítottal.",
    );
  });

  /**
   * AZ ELFOGADÁS ÚTJA VÁLTOZATLAN. Ha az indok ott is kötelezővé válna, a
   * szabály nem szigorúbb lenne, hanem MÁS, és a partner az aláírásnál akadna el.
   */
  it("leaves acceptance without a note exactly as it was", async () => {
    const service = new WorksheetsService(repository());

    await service.sign(
      "worksheet-1",
      { decision: "ACCEPTED", signerName: "Kovács Béla" },
      "user-1",
    );
  });

  it("reports a missing worksheet as not found", async () => {
    const service = new WorksheetsService(
      repository({ detail: async () => null }),
    );
    await assert.rejects(service.detail("worksheet-9"), NotFoundException);
  });
});
