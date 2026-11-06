import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fillRentalContractTemplate,
  RENTAL_CONTRACT_VARIABLES,
  rentalContractBlocks,
  unknownRentalContractVariables,
  type RentalContractValues,
} from "./rental-contract.js";

/*
  WHAT TURNS THIS RED. A known place left unfilled, or filled with spaces around the name not tolerated; an unknown place
  silently emptied (a typo would vanish from the printed contract); the save check missing an unknown place, or reporting it
  twice; a heading not recognised, a paragraph split on a single line break, empty lines kept as empty paragraphs, or the signature mark read as text.
*/
const values = Object.fromEntries(
  Object.keys(RENTAL_CONTRACT_VARIABLES).map((key) => [key, `<${key}>`]),
) as RentalContractValues;

describe("the rental contract template", () => {
  it("fills known places, spaces inside the braces too, and leaves an unknown one visible", () => {
    assert.equal(
      fillRentalContractTemplate(
        "Bérlő: {{berlo_nev}}, díj: {{ napi_dij }}, hely: {{kelt_hely}}",
        values,
      ),
      "Bérlő: <berlo_nev>, díj: <napi_dij>, hely: {{kelt_hely}}",
    );
  });

  it("lists each unknown place once, and none for a clean template", () => {
    assert.deepEqual(
      unknownRentalContractVariables(
        "{{kelt_hely}} {{berlo_nev}} {{ kelt_hely }} {{berlo_neve}}",
      ),
      ["kelt_hely", "berlo_neve"],
    );
    assert.deepEqual(
      unknownRentalContractVariables(
        Object.keys(RENTAL_CONTRACT_VARIABLES)
          .map((key) => `{{${key}}}`)
          .join(" "),
      ),
      [],
    );
  });

  it("reads headings, paragraphs and kept line breaks", () => {
    assert.deepEqual(
      rentalContractBlocks(
        "## 1. A felek\r\n\r\nBérbeadó: X\nBérlő: Y\n\n\n\nZáró sor  \n[[alairas]]\n",
      ),
      [
        { kind: "heading", text: "1. A felek" },
        { kind: "paragraph", lines: ["Bérbeadó: X", "Bérlő: Y"] },
        { kind: "paragraph", lines: ["Záró sor"] },
        { kind: "signatures" },
      ],
    );
  });
});
