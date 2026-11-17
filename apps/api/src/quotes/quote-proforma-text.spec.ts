import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  proformaLineDescription,
  proformaNote,
} from "./quote-proforma-text.js";

/*
  A DÍJBEKÉRŐ FELIRATA (Luca, 2026-11-17): MI PIROSIT: ha a 60%-os mérföldkő „(6%)” feliratot kapna a tételen vagy a megjegyzésben (a
  Decimal szövege tizedespont nélkül jön, és a nullát nem szabad levágni); ha egy valódi tizedes (62,5%) elveszne; ha a megjegyzés és a
  tétel két külön százalékot mondana.
*/
const base = { label: "Előleg megrendeléskor", quoteNumber: "AJ-2026-0016" };

describe("a díjbekérő felirata", () => {
  it("a kerek százalék ép: 60, 50, 40, 10, 100 (Decimal-ból, ahogy a tárolt érték jön)", () => {
    for (const value of ["60", "50", "40", "10", "100", "60.00"]) {
      const percent = new Prisma.Decimal(value);
      const expected = value === "60.00" ? "60" : value;
      assert.equal(
        proformaLineDescription({ ...base, percent }),
        `Előleg megrendeléskor (${expected}%), AJ-2026-0016`,
        value,
      );
      assert.equal(
        proformaNote({ ...base, percent }),
        `Előleg megrendeléskor (${expected}%) a(z) AJ-2026-0016 ajánlathoz.`,
        value,
      );
    }
  });

  it("a valódi tizedes megmarad, a tétel és a megjegyzés ugyanazt a százalékot mondja", () => {
    const percent = new Prisma.Decimal("62.5");
    assert.match(proformaLineDescription({ ...base, percent }), /\(62\.5%\)/);
    assert.match(proformaNote({ ...base, percent }), /\(62\.5%\)/);
  });
});
