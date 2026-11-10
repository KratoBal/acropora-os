import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RENTAL_CONTRACT_MISSING_VALUE,
  rentalContractBlocks,
  unknownRentalContractVariables,
  type Rental,
} from "@acropora/types";

import {
  PDF_CONTENT_BOTTOM,
  PDF_CONTINUATION_CONTENT_TOP,
  PDF_FIRST_CONTENT_TOP,
} from "../documents/pdf/branded-document.js";
import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";
import { DEFAULT_RENTAL_CONTRACT_TEMPLATE } from "./rental-contract-default.js";
import {
  contractLayoutPlan,
  rentalContractDocument,
  rentalContractValues,
} from "./rental-contract-document.js";

/*
  WHAT TURNS THIS RED. A time printed in UTC instead of on the Budapest clock; the device's CURRENT terms printed instead of the
  rental's own copy; an undecided late-return setting printed as a number (0, or an invented default) instead of "not set yet";
  the built-in text carrying a place the renderer does not know; the contract losing a Hungarian letter (ő, ű) or the renter's
  details on paper; the signature mark printed as text; today's Settings or the day of a reprint printed instead of what the
  rental froze when it was recorded (barracuda, #2360).
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
  lateFeeMultiplier: null,
  replacementAfterDays: null,
  accessories: "tápegység, 2 tömlő",
  expectedFeeHuf: 7500,
  note: null,
  returnedAt: null,
  settlement: null,
  createdAt: "2026-11-06T09:00:00.000Z",
};
const PRINTED = new Date("2026-11-06T09:05:00.000Z");

describe("the rental contract's values", () => {
  it("prints the rental's own terms, on the Budapest clock", () => {
    const values = rentalContractValues(rental);
    assert.equal(values.berles_kezdete, "2026. 11. 06. 10:00");
    assert.equal(values.tervezett_visszahozas, "2026. 11. 08. 10:30");
    assert.match(values.kaucio, /^20\s000 Ft$/);
    assert.match(values.varhato_dij, /^7\s?500 Ft$/);
    assert.equal(values.atadaskori_megjegyzes, "nincs");
    assert.equal(values.kelt_datum, "2026. 11. 06.");
  });

  it("is dated on the rental's first Budapest day, whenever it is printed (barracuda, #2360)", () => {
    // 23:30 UTC on the 6th is already the 7th in Budapest
    const late = { ...rental, startsAt: "2026-11-06T23:30:00.000Z" };
    assert.equal(rentalContractValues(late).kelt_datum, "2026. 11. 07.");
  });

  it("says the late-return settings were not set when agreed, and prints the rental's own when they were", () => {
    const unset = rentalContractValues(rental);
    assert.equal(unset.kesedelmi_szorzo, RENTAL_CONTRACT_MISSING_VALUE);
    assert.equal(unset.kesedelem_napok, RENTAL_CONTRACT_MISSING_VALUE);
    const set = rentalContractValues({
      ...rental,
      lateFeeMultiplier: 1.5,
      replacementAfterDays: 14,
    });
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

  it("splits a paragraph longer than a page between the content edges, losing no word (barracuda, #2360)", async () => {
    const words = 2500;
    const template = `## Első\n\n${Array(words).fill("szerzodes").join(" ")}\n\n## VÉGE`;
    const lines = await readPdfTextLines(
      await rentalContractDocument({ rental, template, printedAt: PRINTED }),
    );
    const body = lines.filter((line) => line.text.includes("szerzodes"));
    assert.ok(new Set(body.map((line) => line.pageNumber)).size >= 3);
    for (const line of body) {
      const top =
        line.pageNumber === 1
          ? PDF_FIRST_CONTENT_TOP
          : PDF_CONTINUATION_CONTENT_TOP;
      // a line read back without a position fails both checks (NaN compares false)
      const lineTop = line.top ?? Number.NaN;
      const lineBottom = lineTop + (line.height ?? Number.NaN);
      assert.ok(lineTop >= top - 1, `page ${line.pageNumber} top ${lineTop}`);
      assert.ok(
        lineBottom <= PDF_CONTENT_BOTTOM + 1,
        `page ${line.pageNumber} bottom ${lineBottom}`,
      );
    }
    const count = body
      .map(
        (line) =>
          line.text.split(/\s+/).filter((w) => w === "szerzodes").length,
      )
      .reduce((a, b) => a + b, 0);
    assert.equal(count, words);
    assert.ok(lines.some((line) => line.text === "VÉGE"));
  });

  /*
    BALÁZS, 2026-11-10 14:15 UTC (msg 1569717175214670000): the printed contract was three pages, the last one only the signature.
    WHAT TURNS THIS RED: the built-in text with a full rental on more than two pages; a page holding nothing but a signature block,
    whatever the length of an edited text.
  */
  it("the built-in text with a full rental fits two pages, the signatures on a page with text", async () => {
    const full: Rental = {
      ...rental,
      customer: {
        ...rental.customer,
        displayName: "Kiss Anna Mária",
        address: "1111 Budapest, Fő utca 1. 2. emelet 3. ajtó",
      },
      accessories: "tápegység, 2 tömlő, szűrőbetét, nyomásmérő",
      note: "Karcos burkolat a bal oldalon, a kijelző sarka repedt.",
    };
    const lines = await readPdfTextLines(
      await rentalContractDocument({
        rental: full,
        template: DEFAULT_RENTAL_CONTRACT_TEMPLATE,
        printedAt: PRINTED,
      }),
    );
    assert.equal(Math.max(...lines.map((l) => l.pageNumber)), 2);
    assert.deepEqual(lonelySignaturePages(lines), []);
  });

  it("a text whose signature would stand alone in both spacings: the paragraph before it goes over with it", async () => {
    // measured: 18 paragraphs of 56 words leave the signature alone with the normal and the compact spacing alike
    const template = `## Szerződés\n\n${Array.from(
      { length: 18 },
      (_, i) => `${i + 1}. ` + "szöveg ".repeat(56),
    ).join("\n\n")}\n\n[[alairas]]`;
    const plan = contractLayoutPlan(rentalContractBlocks(template));
    assert.deepEqual(
      [...plan.breakBefore],
      [18],
      "the case reaches the keep-with path",
    );
    const lines = await readPdfTextLines(
      await rentalContractDocument({ rental, template, printedAt: PRINTED }),
    );
    assert.deepEqual(lonelySignaturePages(lines), []);
    // the last page holds the moved paragraph, then the signatures
    const last = Math.max(...lines.map((l) => l.pageNumber));
    assert.ok(
      lines.some((l) => l.pageNumber === last && l.text.startsWith("18. ")),
    );
  });

  it("never leaves a signature block alone on a page, whatever the length of the text before it", async () => {
    for (let paragraphs = 1; paragraphs <= 40; paragraphs += 3) {
      const filler = Array.from(
        { length: paragraphs },
        (_, i) => `${i + 1}. bekezdés: ` + "a szerződés szövege ".repeat(18),
      ).join("\n\n");
      const lines = await readPdfTextLines(
        await rentalContractDocument({
          rental,
          template: `## Szerződés\n\n${filler}\n\n[[alairas]]`,
          printedAt: PRINTED,
        }),
      );
      assert.deepEqual(
        lonelySignaturePages(lines),
        [],
        `${paragraphs} paragraphs`,
      );
    }
  });

  it("gives the same bytes for the same rental at the same moment", async () => {
    const make = () =>
      rentalContractDocument({
        rental,
        template: DEFAULT_RENTAL_CONTRACT_TEMPLATE,
        printedAt: PRINTED,
      });
    assert.deepEqual(await make(), await make());
  });
});

/** The pages whose body holds only the signature labels (the header and the footer are outside the content band). */
function lonelySignaturePages(
  lines: { pageNumber: number; text: string; top?: number }[],
): number[] {
  const pages = new Set(lines.map((l) => l.pageNumber));
  return [...pages].filter((page) => {
    const body = lines.filter(
      (l) =>
        l.pageNumber === page &&
        (l.top ?? 0) >= PDF_CONTINUATION_CONTENT_TOP - 1 &&
        (l.top ?? 0) <= PDF_CONTENT_BOTTOM,
    );
    return (
      body.some((l) => l.text === "Bérbeadó Bérlő") &&
      body.every((l) => l.text === "Bérbeadó Bérlő")
    );
  });
}
