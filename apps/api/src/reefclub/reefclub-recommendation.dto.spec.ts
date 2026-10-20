import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  ReefClubAnswerDto,
  ReefClubRecommendDto,
  ReefClubRecordDoseDto,
} from "./reefclub-recommendation.dto.js";

/**
 * THE RECOMMENDATION AND DOSE BODIES (ReefClub slice 8, endpoints). Made-up
 * values. What matters: the parameter is narrowed to the five the
 * recommendation covers before anything is read, a dose needs its operation
 * id, and "another product" and "amount not known" are explicit nulls.
 */
async function errors<T extends object>(
  type: new () => T,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const found = await validate(plainToInstance(type, plain));
  return found.map((entry) => entry.property).sort();
}

const DOSE = {
  parameter: "KH",
  productId: "p-kh",
  amount: 8,
  unit: "ML",
  administeredAt: "2026-10-21T10:00:00.000Z",
  clientOperationId: "dose-op-12345",
};

describe("ajánlás kérése", () => {
  it("csak az öt paraméter egyike", async () => {
    for (const parameter of ["KH", "KALCIUM", "MAGNEZIUM", "NITRAT", "FOSZFAT"])
      assert.deepEqual(await errors(ReefClubRecommendDto, { parameter }), []);
    for (const parameter of ["PH", "GH", "kh", "", 5, undefined, null])
      assert.deepEqual(
        await errors(ReefClubRecommendDto, { parameter }),
        ["parameter"],
        String(parameter),
      );
  });
});

describe("az ajánlásra adott válasz", () => {
  it("a három válasz egyike; a mennyiség nem negatív; az azonosító alakja kötött", async () => {
    for (const answer of ["GIVEN", "PARTIAL", "NOT_GIVEN"])
      assert.deepEqual(await errors(ReefClubAnswerDto, { answer }), []);
    assert.deepEqual(await errors(ReefClubAnswerDto, { answer: "MAYBE" }), [
      "answer",
    ]);
    assert.deepEqual(
      await errors(ReefClubAnswerDto, { answer: "PARTIAL", amount: -1 }),
      ["amount"],
    );
    assert.deepEqual(
      await errors(ReefClubAnswerDto, {
        answer: "GIVEN",
        clientOperationId: "rövid",
      }),
      ["clientOperationId"],
    );
  });
});

describe("a beadott adag rögzítése", () => {
  it("a teljes törzs rendben", async () => {
    assert.deepEqual(await errors(ReefClubRecordDoseDto, DOSE), []);
  });

  it("a művelet-azonosító KÖTELEZŐ (a telefon kettős küldése ellen)", async () => {
    const { clientOperationId: _omitted, ...without } = DOSE;
    assert.deepEqual(await errors(ReefClubRecordDoseDto, without), [
      "clientOperationId",
    ]);
    assert.deepEqual(
      await errors(ReefClubRecordDoseDto, { ...DOSE, clientOperationId: "x" }),
      ["clientOperationId"],
    );
  });

  it("a 'más termék' és az 'ismeretlen mennyiség' kifejezett null; a hiányzó mező hiba", async () => {
    assert.deepEqual(
      await errors(ReefClubRecordDoseDto, {
        ...DOSE,
        productId: null,
        amount: null,
        unit: null,
      }),
      [],
    );
    for (const field of ["productId", "amount", "unit"]) {
      const { [field]: _omitted, ...without } = DOSE as Record<string, unknown>;
      assert.deepEqual(
        await errors(ReefClubRecordDoseDto, without),
        [field],
        field,
      );
    }
  });

  it("a paraméter az ötből való; a mértékegység a listából; az időpont szigorú ISO", async () => {
    assert.deepEqual(
      await errors(ReefClubRecordDoseDto, { ...DOSE, parameter: "PH" }),
      ["parameter"],
    );
    assert.deepEqual(
      await errors(ReefClubRecordDoseDto, { ...DOSE, unit: "L" }),
      ["unit"],
    );
    assert.deepEqual(
      await errors(ReefClubRecordDoseDto, {
        ...DOSE,
        administeredAt: "tegnap",
      }),
      ["administeredAt"],
    );
  });
});
