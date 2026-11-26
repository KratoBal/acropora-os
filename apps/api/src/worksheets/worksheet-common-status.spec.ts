import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import { commonWorksheetStatus } from "@acropora/types";

import {
  toWorksheetDetail,
  toWorksheetListItem,
  type WorksheetDetailRow,
  type WorksheetSummaryRow,
} from "./worksheets.types.js";

/**
 * A MUNKALAP VÁLASZA HOZZA A KÖZÖS ÁLLAPOTOT ÉS AZ OKÁT (kártya 7f23785c, acrobot 62402): a lista-soron és az adatlapon, a legutolsó változat
 * állapotából és tételszámából, a közös szótár `commonWorksheetStatus` függvényével. MI PIROSÍT: ha a lista-sor vagy az adatlap nem hozza a két
 * mezőt; ha a lista és az adatlap ugyanarra a lapra mást mond; ha a piszkozat tétel nélkül és tétellel ugyanazt az állapotot kapja; ha az
 * elutasított lap nem Folyamatban · elutasítva; ha az aláírásra váró nem Elkészült · aláírásra vár; ha az aláírt nem Lezárt; ha az állapotot nem a
 * LEGUTOLSÓ változatból veszi (a mai állapot a legmagasabb sorszámú verzió).
 */
type Status = "DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED";

const EXPECTED: [Status, number, string, string | null][] = [
  ["DRAFT", 0, "NEW", null],
  ["DRAFT", 3, "IN_PROGRESS", null],
  ["REJECTED", 3, "IN_PROGRESS", "REJECTED"],
  ["AWAITING_SIGNATURE", 3, "DONE", "AWAITING_SIGNATURE"],
  ["SIGNED", 3, "CLOSED", null],
];

function listRow(status: Status, lines: number): WorksheetSummaryRow {
  return {
    id: "ws-1",
    number: "ML-2026-00001",
    createdAt: new Date("2026-10-03T21:30:00.000Z"),
    updatedAt: new Date("2026-10-04T08:00:00.000Z"),
    hiddenAt: null,
    customer: { displayName: "Kitalált Partner Kft." },
    department: { id: "unit-1", code: "KIT" },
    assignees: [],
    serviceJob: null,
    _count: { versions: 1 },
    versions: [
      {
        version: 1,
        status,
        subject: "Kitalált munka",
        sentForSignatureAt: null,
        grossAmount: new Prisma.Decimal("0"),
        _count: { lines },
        lines: [],
      },
    ],
  } as unknown as WorksheetSummaryRow;
}

function version(status: Status, number: number, lines: number) {
  return {
    id: `v-${number}`,
    version: number,
    status,
    changeReason: null,
    createdBy: null,
    createdAt: new Date("2026-10-03T21:30:00.000Z"),
    closedAt: null,
    closedBy: null,
    sentForSignatureAt: null,
    sentForSignatureTo: null,
    netAmount: new Prisma.Decimal("0"),
    vatAmount: new Prisma.Decimal("0"),
    grossAmount: new Prisma.Decimal("0"),
    subject: "Kitalált munka",
    unitName: null,
    description: null,
    issueDate: null,
    fulfillmentDate: null,
    dueDate: null,
    currency: "HUF",
    signature: null,
    lines: Array.from({ length: lines }, (_, i) => ({
      id: `l-${number}-${i}`,
      position: i + 1,
      description: "tétel",
      detail: null,
      assetId: null,
      asset: null,
      quantity: new Prisma.Decimal("1"),
      unit: "db",
      kind: "OTHER",
      workerCount: 1,
      unitNet: null,
      vatRatePercent: null,
      netAmount: null,
      vatAmount: null,
      grossAmount: null,
    })),
  };
}

function detailRow(versions: ReturnType<typeof version>[]): WorksheetDetailRow {
  return {
    id: "ws-1",
    hiddenAt: null,
    number: "ML-2026-00001",
    numberYear: 2026,
    sequence: 1,
    customer: {
      id: "c-1",
      customerNumber: "C-1",
      displayName: "Kitalált Partner Kft.",
      worksheetPartnerCode: "KIT",
    },
    department: {
      id: "unit-1",
      parentId: null,
      code: "KIT",
      name: "Kitalált egység",
      isActive: true,
    },
    departmentPath: null,
    createdBy: null,
    handedOverAt: null,
    handedOverBy: null,
    serviceJob: null,
    assignees: [],
    assets: [],
    createdAt: new Date("2026-10-03T21:30:00.000Z"),
    updatedAt: new Date("2026-10-04T08:00:00.000Z"),
    continues: null,
    continuedBy: [],
    versions,
  } as unknown as WorksheetDetailRow;
}

describe("a munkalap közös állapota a válaszban", () => {
  it("POZITÍV KONTROLL: a várt táblázat a közös szótár függvényéből áll elő (nem kézzel egyezik)", () => {
    for (const [status, lines, common, reason] of EXPECTED) {
      assert.deepEqual(commonWorksheetStatus(status, lines), {
        status: common,
        reason,
      });
    }
  });

  for (const [status, lines, common, reason] of EXPECTED) {
    it(`${status}, ${lines} tétel: a lista-sor és az adatlap is ${common} / ${reason}`, () => {
      const item = toWorksheetListItem(listRow(status, lines));
      assert.deepEqual(
        [item.commonStatus, item.commonReason],
        [common, reason],
        "lista-sor",
      );
      const detail = toWorksheetDetail(detailRow([version(status, 1, lines)]));
      assert.deepEqual(
        [detail.commonStatus, detail.commonReason],
        [common, reason],
        "adatlap",
      );
    });
  }

  it("az adatlapon a LEGUTOLSÓ változat dönt (a mai állapot a legmagasabb sorszámú verzió, az első elem)", () => {
    const detail = toWorksheetDetail(
      detailRow([version("DRAFT", 2, 1), version("SIGNED", 1, 3)]),
    );
    assert.deepEqual(
      [detail.commonStatus, detail.commonReason],
      ["IN_PROGRESS", null],
    );
  });
});
