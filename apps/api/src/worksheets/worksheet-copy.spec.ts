import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { WorksheetDetail } from "@acropora/types";

import type { CreateWorksheetDto } from "./dto/worksheet.dto.js";
import { copyOperationId, worksheetCopyInput } from "./worksheet-copy.js";
import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

/*
  A MUNKALAP MÁSOLÁSA (kártya a785e580, 2. szelet; acrobot 57048). MI PIROSÍT: egy dátum, a sorszám vagy az aláírás
  átjön; a szülő, a helyszín, a felelősök, az eszközök vagy a tételsor ára elvész; a másolat nem a kézi nyitás útján
  készül (ott dől el a felelős-követő jelző); egy lap hibája a többit is megállítja; egy újraküldött kérés új lapokat ad;
  partnerként másolni lehet; 50-nél több lap vagy üres lista átmegy.
*/
const BELSOS = { id: "user-1", customerId: null, supplierId: null } as never;
const PARTNER = {
  id: "user-9",
  customerId: "customer-1",
  supplierId: null,
} as never;

const source = (over: Partial<WorksheetDetail> = {}): WorksheetDetail =>
  ({
    id: "ws-1",
    number: "ACR-2026/00041",
    customer: { id: "customer-1" },
    department: { id: "dept-1" },
    serviceJob: { id: "job-1", jobNumber: "KL-2026-0007", kind: "MAINTENANCE" },
    assignees: [
      { userId: "user-2", name: "Kati", assignedAt: "x" },
      { userId: "user-3", name: "Feri", assignedAt: "y" },
    ],
    assets: [
      {
        id: "link-1",
        assetId: "asset-1",
        assetNumber: "E-1",
        assetName: "Szivattyú",
        attachedAt: "z",
      },
    ],
    currentVersion: {
      subject: "Havi karbantartás",
      description: "Szűrőcsere",
      issueDate: "2026-11-01",
      fulfillmentDate: "2026-11-02",
      dueDate: "2026-11-10",
      lines: [
        {
          id: "line-1",
          description: "Szűrő",
          detail: "50 mikron",
          assetId: "asset-1",
          quantity: "2.000000",
          unit: "db",
          kind: "MATERIAL",
          workerCount: 1,
          unitNet: "4500.0000",
          vatRatePercent: "27.00",
        },
        {
          id: "line-2",
          description: "Munkadíj",
          detail: null,
          assetId: null,
          quantity: "1.5",
          unit: "óra",
          kind: "LABOR",
          workerCount: 2,
          unitNet: null,
          vatRatePercent: null,
        },
      ],
    },
    ...over,
  }) as unknown as WorksheetDetail;

describe("worksheetCopyInput", () => {
  it("copies the parent, place, subject, lines with their prices, assignees and assets", () => {
    const input = worksheetCopyInput(source());
    assert.equal(input.customerId, "customer-1");
    assert.equal(input.departmentId, "dept-1");
    assert.equal(input.serviceJobId, "job-1");
    assert.equal(input.subject, "Havi karbantartás");
    assert.equal(input.description, "Szűrőcsere");
    assert.deepEqual(input.assigneeIds, ["user-2", "user-3"]);
    assert.deepEqual(input.assetIds, ["asset-1"]);
    assert.deepEqual(input.lines, [
      {
        description: "Szűrő",
        detail: "50 mikron",
        assetId: "asset-1",
        quantity: 2,
        unit: "db",
        kind: "MATERIAL",
        workerCount: 1,
        unitNet: 4500,
        vatRatePercent: 27,
      },
      {
        description: "Munkadíj",
        detail: null,
        assetId: null,
        quantity: 1.5,
        unit: "óra",
        kind: "LABOR",
        workerCount: 2,
      },
    ]);
  });

  it("brings no date, no number, no signature; a standalone sheet stays standalone", () => {
    const input = worksheetCopyInput(source());
    assert.deepEqual(
      [input.issueDate, input.fulfillmentDate, input.dueDate],
      [null, null, null],
    );
    for (const key of [
      "number",
      "status",
      "signature",
      "entries",
      "closedAt",
      "id",
    ])
      assert.equal(key in input, false, key);
    assert.equal(
      worksheetCopyInput(source({ serviceJob: null })).serviceJobId,
      null,
    );
  });

  it("the copy's operation id comes from the request and the SOURCE sheet, not its place", () => {
    assert.equal(copyOperationId(undefined, "ws-1"), undefined);
    assert.equal(
      copyOperationId("req-abcdef12", "ws-3"),
      "req-abcdef12:masolat:ws-3",
    );
    assert.equal(
      worksheetCopyInput(source(), "req-abcdef12:masolat:ws-1")
        .clientOperationId,
      "req-abcdef12:masolat:ws-1",
    );
    // the longest request id and a cuid stay inside the 128-character operation id
    assert.ok(copyOperationId("r".repeat(64), "c".repeat(25))!.length <= 128);
    assert.equal("clientOperationId" in worksheetCopyInput(source()), false);
  });
});

describe("WorksheetsService.copyWorksheets", () => {
  /** The service with its own `detail` and `create` watched: the copy goes through the manual-open path. */
  const service = (fail: Record<string, Error> = {}) => {
    const svc = new WorksheetsService({} as unknown as WorksheetsRepository);
    const created: CreateWorksheetDto[] = [];
    svc.detail = async (id: string) => {
      if (fail[id]) throw fail[id];
      return source({ id });
    };
    // like `createDraft`: a known operation id answers the sheet it made before
    const byOperation = new Map<string, WorksheetDetail>();
    svc.create = async (input: CreateWorksheetDto) => {
      const known = input.clientOperationId
        ? byOperation.get(input.clientOperationId)
        : undefined;
      if (known) return known;
      created.push(input);
      const made = {
        id: `copy-${created.length}`,
        number: `ACR-2026/0010${created.length}`,
      } as WorksheetDetail;
      if (input.clientOperationId)
        byOperation.set(input.clientOperationId, made);
      return made;
    };
    return { svc, created };
  };

  it("one new draft per sheet through create, in order, each answered", async () => {
    const { svc, created } = service();
    const result = await svc.copyWorksheets(
      ["ws-1", "ws-2", "ws-1"],
      BELSOS,
      "req-abcdef12",
    );
    assert.deepEqual(result.results, [
      { sourceId: "ws-1", ok: true, id: "copy-1", number: "ACR-2026/00101" },
      { sourceId: "ws-2", ok: true, id: "copy-2", number: "ACR-2026/00102" },
    ]);
    assert.deepEqual(
      created.map((c) => c.clientOperationId),
      ["req-abcdef12:masolat:ws-1", "req-abcdef12:masolat:ws-2"],
    );
  });

  it("a resent request with the list reordered gives each source its own copy back (barracuda, #2746)", async () => {
    const { svc, created } = service();
    const first = await svc.copyWorksheets(
      ["ws-1", "ws-2"],
      BELSOS,
      "req-abcdef12",
    );
    const again = await svc.copyWorksheets(
      ["ws-2", "ws-1"],
      BELSOS,
      "req-abcdef12",
    );
    const pairs = (r: typeof first) =>
      Object.fromEntries(
        r.results.map((row) => [row.sourceId, row.ok ? row.id : null]),
      );
    assert.deepEqual(pairs(again), pairs(first));
    assert.deepEqual(pairs(first), { "ws-1": "copy-1", "ws-2": "copy-2" });
    assert.equal(created.length, 2);
  });

  it("a sheet that fails says why in its own row, the others are still copied", async () => {
    const { svc, created } = service({
      "ws-2": new NotFoundException("A munkalap nem található."),
    });
    const result = await svc.copyWorksheets(["ws-1", "ws-2", "ws-3"], BELSOS);
    assert.deepEqual(
      result.results.map((r) => [r.sourceId, r.ok]),
      [
        ["ws-1", true],
        ["ws-2", false],
        ["ws-3", true],
      ],
    );
    assert.equal(
      (result.results[1] as { message: string }).message,
      "A munkalap nem található.",
    );
    assert.equal(created.length, 2);
  });

  it("refuses a partner, an empty list and more than fifty sheets, before reading any", async () => {
    const { svc, created } = service();
    await assert.rejects(
      svc.copyWorksheets(["ws-1"], PARTNER),
      ForbiddenException,
    );
    await assert.rejects(svc.copyWorksheets([], BELSOS), BadRequestException);
    await assert.rejects(
      svc.copyWorksheets(
        Array.from({ length: 51 }, (_, i) => `ws-${i}`),
        BELSOS,
      ),
      BadRequestException,
    );
    assert.equal(created.length, 0);
  });
});
