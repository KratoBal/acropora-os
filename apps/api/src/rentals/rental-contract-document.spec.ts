import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RENTAL_CONTRACT_MISSING_VALUE,
  unknownRentalContractVariables,
  type Rental,
} from "@acropora/types";

import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";
import { DEFAULT_RENTAL_CONTRACT_TEMPLATE } from "./rental-contract-default.js";
import {
  rentalContractDocument,
  rentalContractValues,
} from "./rental-contract-document.js";

/*
  WHAT TURNS THIS RED. A time printed in UTC instead of on the Budapest clock; the device's CURRENT terms printed instead of the
  rental's own copy; an undecided late-return setting printed as a number (0, or an invented default) instead of "not set yet";
  the built-in text carrying a place the renderer does not know; the contract losing a Hungarian letter (ő, ű) or the renter's
  details on paper; the signature mark printed as text.
*/
const rental: Rental = {
  id: "r-1",
  rentalNumber: "BER-TESZT-1",
  status: "OPEN",
  equipment: { id: "eq-1", name: "Ozmózis víztisztító", serialNumber: "SN-1" },
  customer: {
    id: "c-1",
    customerNumber: "VEVO-1",
    displayName: "Őri Ünőke",
    phone: "+36 30 123 4567",
    email: "uno@example.com",
    address: "1111 Budapest, Fő utca 1.",
  },
  startsAt: "2026-11-06T09:00:00.000Z",
  plannedReturnAt: "2026-11-08T09:30:00.000Z",
  dailyFeeHuf: 2500,
  depositHuf: 20000,
  replacementValueHuf: 120000,
  accessories: "tápegység, 2 tömlő",
  expectedFeeHuf: 7500,
  note: null,
  returnedAt: null,
  createdAt: "2026-11-06T09:00:00.000Z",
};
const PRINTED = new Date("2026-11-06T09:05:00.000Z");
const UNSET = { lateFeeMultiplier: null, replacementAfterDays: null };

describe("the rental contract's values", () => {
  it("prints the rental's own terms, on the Budapest clock", () => {
    const values = rentalContractValues(rental, UNSET, PRINTED);
    assert.equal(values.berles_kezdete, "2026. 11. 06. 10:00");
    assert.equal(values.tervezett_visszahozas, "2026. 11. 08. 10:30");
    assert.match(values.kaucio, /^20\s000 Ft$/);
    assert.match(values.varhato_dij, /^7\s?500 Ft$/);
    assert.equal(values.atadaskori_megjegyzes, "nincs");
    assert.equal(values.kelt_datum, "2026. 11. 06.");
  });

  it("says the late-return settings are not set, and prints them once they are", () => {
    const unset = rentalContractValues(rental, UNSET, PRINTED);
    assert.equal(unset.kesedelmi_szorzo, RENTAL_CONTRACT_MISSING_VALUE);
    assert.equal(unset.kesedelem_napok, RENTAL_CONTRACT_MISSING_VALUE);
    const set = rentalContractValues(
      rental,
      { lateFeeMultiplier: 1.5, replacementAfterDays: 14 },
      PRINTED,
    );
    assert.equal(set.kesedelmi_szorzo, "1,5");
    assert.equal(set.kesedelem_napok, "14");
  });

  it("the built-in text uses only known places", () => {
    assert.deepEqual(
      unknownRentalContractVariables(DEFAULT_RENTAL_CONTRACT_TEMPLATE),
      [],
    );
  });
});

describe("the rental contract PDF", () => {
  it("carries the number, the renter with accents, the terms and two signature labels", async () => {
    const bytes = await rentalContractDocument({
      rental,
      template: DEFAULT_RENTAL_CONTRACT_TEMPLATE,
      settings: UNSET,
      printedAt: PRINTED,
    });
    const lines = (await readPdfTextLines(bytes)).map((l) => l.text);
    const text = lines.join("\n");
    // the eyebrow is drawn letter-spaced, and reads back with a space between the letters
    assert.ok(
      text.replace(/\s/g, "").includes("ESZKÖZBÉRLETISZERZŐDÉS"),
      "eyebrow",
    );

    for (const needle of [
      "BER-TESZT-1",
      "Őri Ünőke",
      "1111 Budapest, Fő utca 1.",
      "Gyári szám: SN-1",
      "Kezdete: 2026. 11. 06. 10:00",
      RENTAL_CONTRACT_MISSING_VALUE,
    ])
      assert.ok(text.includes(needle), needle);
    assert.ok(!text.includes("[[alairas]]"), "the signature mark printed");
    assert.ok(!text.includes("{{"), "an unfilled place printed");
    assert.equal(
      lines.filter((line) => line === "Bérbeadó Bérlő").length,
      2,
      "two signature blocks",
    );
  });

  it("gives the same bytes for the same rental at the same moment", async () => {
    const make = () =>
      rentalContractDocument({
        rental,
        template: DEFAULT_RENTAL_CONTRACT_TEMPLATE,
        settings: UNSET,
        printedAt: PRINTED,
      });
    assert.deepEqual(await make(), await make());
  });
});
