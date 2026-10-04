import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  toWorksheetListItem,
  type WorksheetSummaryRow,
} from "./worksheets.types.js";

/**
 * THE LIST ROW'S LABOUR HOURS AND LINKED JOB (service redesign E4, Balázs,
 * 2026-10-04): the web list's "Munkaóra" and "Hibajegy" columns and the
 * phone's "Felelős: … · 4,0 óra" line.
 *
 * Both are read-only and come from what the sheet's own detail already
 * returns: the hours from the same rule (`sumWorksheetLaborHours`), the job
 * as the same `{ id, jobNumber }` pair. A partner therefore sees nothing on
 * its list that its sheet detail does not already show.
 */
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ws-1",
    number: "ML-2026-00001",
    updatedAt: new Date("2026-10-04T08:00:00.000Z"),
    hiddenAt: null,
    customer: { displayName: "Kitalált Partner Kft." },
    department: { id: "unit-1", code: "KIT" },
    assignees: [],
    serviceJob: { id: "job-1", jobNumber: "HJ-2026-0001" },
    _count: { versions: 1 },
    versions: [
      {
        version: 1,
        status: "DRAFT",
        subject: "Kitalált munka",
        grossAmount: new Prisma.Decimal("0"),
        _count: { lines: 3 },
        lines: [
          // 1.5 h done by two people: 3 h
          {
            kind: "LABOR",
            quantity: new Prisma.Decimal("1.5"),
            workerCount: 2,
          },
          // 1 h alone: 1 h
          { kind: "LABOR", quantity: new Prisma.Decimal("1"), workerCount: 1 },
          // material: no hours, whatever its quantity
          { kind: "OTHER", quantity: new Prisma.Decimal("5"), workerCount: 1 },
        ],
      },
    ],
    ...overrides,
  } as unknown as WorksheetSummaryRow;
}

describe("a munkalap-lista sora", () => {
  it("kiadja a jelenlegi verzió összes munkaóráját", () => {
    assert.equal(toWorksheetListItem(row()).laborHours, "4");
  });

  it("tétel nélküli lapnál a munkaóra nulla, nem hiány", () => {
    const item = toWorksheetListItem(
      row({
        versions: [
          {
            version: 1,
            status: "DRAFT",
            subject: "Üres",
            grossAmount: new Prisma.Decimal("0"),
            _count: { lines: 0 },
            lines: [],
          },
        ],
      }),
    );
    assert.equal(item.laborHours, "0");
  });

  it("kiadja a kapcsolódó hibajegyet", () => {
    assert.deepEqual(toWorksheetListItem(row()).serviceJob, {
      id: "job-1",
      jobNumber: "HJ-2026-0001",
    });
  });

  it("hibajegy nélküli lapnál a mező null", () => {
    assert.equal(
      toWorksheetListItem(row({ serviceJob: null })).serviceJob,
      null,
    );
  });

  it("az ár nem kerül a sorba a munkaóra miatt", () => {
    // the hours read only kind, quantity and worker count; the list row keeps
    // exactly the one amount it had before (grossAmount), nothing more
    const item = toWorksheetListItem(row());
    const keys = Object.keys(item).filter((key) => /amount|price/i.test(key));
    assert.deepEqual(keys, ["grossAmount"]);
  });
});
