import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WorksheetContentDto } from "./dto/worksheet.dto.js";
import {
  normalizeWorksheetContent,
  normalizeWorksheetLine,
  toDateOnly,
} from "./worksheet-content.js";

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
      content({ description: "  Kiszállás nélkül  " }),
    );
    assert.equal(normalized.subject, "Cápasuli kompresszorok bevizsgálása");
    assert.equal(normalized.description, "Kiszállás nélkül");
  });

  it("does not accept the unit as content: it comes from the sub-unit row", () => {
    const normalized = normalizeWorksheetContent(content());
    assert.equal("unitName" in normalized, false);
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

describe("az ár elhagyható, de a hiány nem nulla", () => {
  const base = {
    description: "Szivattyú tisztítás",
    quantity: 2,
    unit: "óra",
  } as unknown as Parameters<typeof normalizeWorksheetLine>[0];

  /**
   * AZ EGÉSZ VÁLTOZTATÁS OKA EGY ÁLLÍTÁSBAN. Ha a hiányzó ár nullává válna,
   * a lapon egy 0 forintos tétel állna, ami ÉRTÉKNEK látszik: aki ránéz, nem
   * tudja megkülönböztetni az ingyenes munkától, és semmi nem szól, ha valaki
   * elfelejtette kitölteni.
   */
  it("ár nélkül a sor összegei null-ok, nem nullák", () => {
    const line = normalizeWorksheetLine(base);

    assert.equal(line.unitNet, null);
    assert.equal(line.vatRatePercent, null);
    assert.equal(line.netAmount, null);
    assert.equal(line.vatAmount, null);
    assert.equal(line.grossAmount, null);
  });

  it("árral a sor összegei kiszámolódnak", () => {
    const line = normalizeWorksheetLine({
      ...base,
      unitNet: 1000,
      vatRatePercent: 27,
    } as unknown as Parameters<typeof normalizeWorksheetLine>[0]);

    assert.equal(line.unitNet?.toString(), "1000");
    assert.equal(line.netAmount?.toString(), "2000");
    assert.equal(line.vatAmount?.toString(), "540");
  });

  /**
   * FÉL ÁRON NEM ÁLLHAT A SOR. Ha csak az egyik ármező érkezik, összeget nem
   * lehet képezni belőle, tehát a sor ár nélkülinek számít - egy félig
   * kitöltött ár csendben rossz összeget adna.
   */
  it("csak az egyik ármezővel is ár nélkülinek számít", () => {
    const line = normalizeWorksheetLine({
      ...base,
      unitNet: 1000,
    } as unknown as Parameters<typeof normalizeWorksheetLine>[0]);

    assert.equal(line.unitNet, null);
    assert.equal(line.netAmount, null);
  });

  /**
   * A LAP ÖSSZEGE CSAK AZ ÁRAS SOROKBÓL JÖN, ÉS A SOR MEGTARTJA A HIÁNYT.
   *
   * AZ ELSŐ VÁLTOZATOM ITT CSAK AZ ÖSSZEGET NÉZTE, ÉS AZ NEM MÉRT SEMMIT: a
   * nulla hozzáadása nem változtat az összegen, tehát a "nullaként számít
   * bele" hiba mellett is 2000 jött volna ki. A kalibráció mutatta meg - a
   * másik két állítás pirosodott, ez zöld maradt.
   *
   * Amit MÉR: hogy az összeg az áras sorból jön (ha a szűrő fordítva
   * hibázna és mindent kizárna, ez nullát adna), ÉS hogy az ár nélküli sor
   * `null`-lal marad a listában, nem nullával.
   */
  it("a lap összege az áras sorból jön, az ár nélküli sor null-lal marad", () => {
    const content = normalizeWorksheetContent({
      subject: "Havi karbantartás",
      lines: [{ ...base, unitNet: 1000, vatRatePercent: 27 }, { ...base }],
    } as unknown as Parameters<typeof normalizeWorksheetContent>[0]);

    assert.equal(content.totals.netAmount.toString(), "2000");
    assert.equal(content.lines.length, 2);
    assert.equal(content.lines[0]!.netAmount?.toString(), "2000");
    assert.equal(content.lines[1]!.netAmount, null);
  });
});
