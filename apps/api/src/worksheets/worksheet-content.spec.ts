import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WorksheetContentDto } from "./dto/worksheet.dto.js";
import { normalizeWorksheetContent, toDateOnly } from "./worksheet-content.js";

function content(
  overrides: Partial<WorksheetContentDto> = {},
): WorksheetContentDto {
  return {
    subject: "  Cápasuli kompresszorok bevizsgálása  ",
    lines: [
      {
        description: "Kompresszor bevizsgálás",
        quantity: 2,
        unit: "óra",
        unitNet: 15000,
        vatRatePercent: 27,
      },
    ],
    ...overrides,
  } as WorksheetContentDto;
}

describe("worksheet content normalisation", () => {
  it("trims the subject and drops whitespace-only optional fields", () => {
    const normalized = normalizeWorksheetContent(
      content({ unitText: "   ", description: "  PP Üzemeltetés  " }),
    );
    assert.equal(normalized.subject, "Cápasuli kompresszorok bevizsgálása");
    assert.equal(normalized.unitText, null);
    assert.equal(normalized.description, "PP Üzemeltetés");
  });

  it("numbers the lines by the submitted order", () => {
    const normalized = normalizeWorksheetContent(
      content({
        lines: [
          {
            description: "Kiszállás",
            quantity: 1,
            unit: "db",
            unitNet: 8000,
            vatRatePercent: 27,
          },
          {
            description: "Kompresszor bevizsgálás",
            quantity: 2,
            unit: "óra",
            unitNet: 15000,
            vatRatePercent: 27,
          },
        ],
      }),
    );
    assert.deepEqual(
      normalized.lines.map((line) => line.position),
      [1, 2],
    );
    assert.equal(normalized.totals.netAmount.toString(), "38000");
    assert.equal(normalized.totals.grossAmount.toString(), "48260");
  });

  it("keeps a date as a day, not as a moment in time", () => {
    assert.equal(
      toDateOnly("2026-06-15")?.toISOString(),
      "2026-06-15T00:00:00.000Z",
    );
    // Egy időpontos érték napja marad meg: időzóna-eltolással különben
    // egy nappal odébb csúszna a teljesítés a nyomtatott lapon.
    assert.equal(
      toDateOnly("2026-06-15T23:30:00.000Z")?.toISOString(),
      "2026-06-15T00:00:00.000Z",
    );
    assert.equal(toDateOnly(null), null);
  });

  it("refuses a date it cannot read instead of guessing one", () => {
    assert.throws(() => toDateOnly("2026.06.15"));
  });

  it("totals an empty worksheet to zero", () => {
    const normalized = normalizeWorksheetContent(content({ lines: [] }));
    assert.equal(normalized.lines.length, 0);
    assert.equal(normalized.totals.grossAmount.toString(), "0");
  });
});
