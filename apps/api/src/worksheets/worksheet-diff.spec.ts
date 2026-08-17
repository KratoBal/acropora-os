import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  diffWorksheetVersions,
  type ComparableWorksheetLine,
  type ComparableWorksheetVersion,
} from "./worksheet-diff.js";

function line(
  overrides: Partial<ComparableWorksheetLine> = {},
): ComparableWorksheetLine {
  return {
    position: 1,
    description: "Kompresszor bevizsgálás",
    detail: "LFX0.7-10 TM 50 230/1/50 CE",
    assetNumber: null,
    quantity: "2",
    unit: "óra",
    unitNet: "15000",
    vatRatePercent: "27",
    netAmount: "30000",
    ...overrides,
  };
}

function version(
  overrides: Partial<ComparableWorksheetVersion> = {},
): ComparableWorksheetVersion {
  return {
    subject: "Cápasuli kompresszorok bevizsgálása",
    unitName: "PP Üzemeltetés",
    description: null,
    issueDate: "2026-06-15",
    fulfillmentDate: "2026-06-15",
    dueDate: "2026-06-16",
    currency: "HUF",
    netAmount: "30000",
    vatAmount: "8100",
    grossAmount: "38100",
    lines: [line()],
    ...overrides,
  };
}

describe("worksheet version diff", () => {
  it("reports nothing when the two versions carry the same content", () => {
    assert.deepEqual(diffWorksheetVersions(version(), version()), []);
  });

  it("does not report a change when only the stored scale differs", () => {
    const previous = version({ lines: [line({ quantity: "2" })] });
    const current = version({ lines: [line({ quantity: "2.000000" })] });
    assert.deepEqual(diffWorksheetVersions(previous, current), []);
  });

  it("names the changed header field with a Hungarian label", () => {
    const changes = diffWorksheetVersions(
      version(),
      version({ dueDate: "2026-06-20" }),
    );
    assert.deepEqual(changes, [
      {
        field: "dueDate",
        label: "Határidő",
        previous: "2026-06-16",
        current: "2026-06-20",
      },
    ]);
  });

  it("reports a changed line field by position", () => {
    const changes = diffWorksheetVersions(
      version(),
      version({
        lines: [line({ quantity: "3", netAmount: "45000" })],
        netAmount: "45000",
      }),
    );
    assert.deepEqual(
      changes.map((change) => change.field),
      ["netAmount", "lines.1.quantity", "lines.1.netAmount"],
    );
    assert.equal(changes[1]?.label, "1. tétel - mennyiség");
  });

  it("reports an added and a removed line", () => {
    const added = diffWorksheetVersions(
      version(),
      version({
        lines: [line(), line({ position: 2, description: "Kiszállás" })],
      }),
    );
    assert.equal(added.length, 1);
    assert.equal(added[0]?.field, "lines.2");
    assert.equal(added[0]?.previous, null);

    const removed = diffWorksheetVersions(version(), version({ lines: [] }));
    assert.equal(removed[0]?.field, "lines.1");
    assert.equal(removed[0]?.current, null);
  });
});
