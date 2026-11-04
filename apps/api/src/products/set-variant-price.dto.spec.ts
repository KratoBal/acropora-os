// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { SetVariantPriceDto } from "./dto/set-variant-price.dto.js";

/**
 * EGÉSZ FORINT (T4.1-D3, barracuda #2130): a felület egész forintot mutat, tehát
 * egy tizedes ár mást írna a boltba, mint amit a lap mutat. MI PIROSÍT: ha egy
 * tizedes, nulla, negatív, vezető nullás vagy tízjegyű ár átmegy; ha egy rendes
 * egész ár elakad.
 */
const hibas = (grossPrice: unknown) =>
  validateSync(plainToInstance(SetVariantPriceDto, { grossPrice })).length > 0;

describe("SetVariantPriceDto", () => {
  it("egész forintot fogad, legfeljebb kilenc jeggyel", () => {
    for (const ok of ["1", "12990", "999999999"])
      assert.equal(hibas(ok), false, ok);
  });

  it("a tizedest, a nullát és a hibás alakot elutasítja", () => {
    for (const rossz of [
      "12990.50",
      "12990,5",
      "0",
      "00",
      "-5",
      "0129",
      "1000000000",
      "",
      12990,
    ])
      assert.equal(hibas(rossz), true, String(rossz));
  });
});
