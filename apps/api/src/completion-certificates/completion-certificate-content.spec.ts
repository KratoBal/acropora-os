import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  completionCertificateContent,
  formatQuantity,
  isoDate,
} from "./completion-certificate-content.js";

describe("isoDate", () => {
  it("egy csupasz UTC éjfél előtti bélyegre ugyanazt a napot adja", () => {
    assert.equal(isoDate(new Date("2026-07-28T20:00:00Z")), "2026-07-28");
  });

  /**
   * KALIBRÁCIÓ: A NAPTÁRI NAP BUDAPESTI IDŐ SZERINT ÁLL, NEM UTC SZERINT.
   *
   * A `2026-07-28T22:30:00Z` bélyeg Budapesten (nyári időszámítás, UTC+2)
   * MÁR `2026-07-29` 00:30 -- egy UTC-s olvasás (a korábbi, hibás alak)
   * `2026-07-28`-at adott volna, egy nappal korábbit a valódinál.
   *
   * ÉLŐBEN VISSZAMÉRVE: a korábbi `getUTCFullYear`/`getUTCMonth`/
   * `getUTCDate`-alapú függvényre ez PONTOSAN ez az egy állítás pirosodott
   * ("2026-07-28" jött "2026-07-29" helyett), a többi zöld maradt.
   */
  it("egy UTC éjfél körüli bélyegre a BUDAPESTI naptár szerinti KÖVETKEZŐ napot adja", () => {
    assert.equal(isoDate(new Date("2026-07-28T22:30:00Z")), "2026-07-29");
  });

  /** UGYANEZ TÉLEN (UTC+1), hogy a zóna-eltolás ne csak a nyári esetre álljon. */
  it("télen (UTC+1) is a budapesti naptár szerinti napot adja", () => {
    assert.equal(isoDate(new Date("2026-01-01T23:30:00Z")), "2026-01-02");
  });
});

/**
 * A MENNYISÉG KIÍRÁSA (Megrendelések S2). MI PIROSÍT: ha a tört mennyiség pontot
 * kap a lapon; ha az egész mennyiség ("1 alkalom") megváltozik; ha a Decimal
 * fölösleges nullái a lapra kerülnek.
 */
describe("formatQuantity", () => {
  it("tizedesvesszővel írja a tört mennyiséget, az egészet változatlanul", () => {
    assert.equal(formatQuantity(new Prisma.Decimal("2.5")), "2,5");
    assert.equal(formatQuantity(new Prisma.Decimal("0.125")), "0,125");
    assert.equal(formatQuantity(new Prisma.Decimal("1")), "1");
    assert.equal(formatQuantity(new Prisma.Decimal("12")), "12");
    assert.equal(formatQuantity(new Prisma.Decimal("2.500000")), "2,5");
  });

  it("a lap mennyiség-oszlopa ezt az alakot kapja", () => {
    const content = completionCertificateContent({
      certificateNumber: "TI-2026-001",
      issuedAt: new Date("2026-11-04T10:00:00Z"),
      completedAt: new Date("2026-11-04T10:00:00Z"),
      subject: "Akvárium karbantartás",
      customer: { name: "Teszt Kft.", addressLines: [] },
      items: [
        {
          description: "Üvegtisztítás",
          quantity: "2.5",
          quantityUnit: "m2",
          unitPrice: "1000",
          vatRatePercent: "27",
        },
        {
          description: "Karbantartás",
          quantity: 1,
          quantityUnit: "alkalom",
          unitPrice: "5000",
          vatRatePercent: "27",
        },
      ],
    });
    assert.deepEqual(
      content.lines.map((line) => line.quantityLabel),
      ["2,5 m2", "1 alkalom"],
    );
  });
});
