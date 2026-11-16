import "reflect-metadata";

import assert from "node:assert/strict";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

/*
  AN IMPOSSIBLE DAY IS A 400 ON EVERY DATE FIELD (t-20261115-dto-datum-strict). The non-strict `IsISO8601` accepted
  2026-02-30, and a later `new Date` turned it into 2026-03-02 without a word. Each DTO file's spec runs this on its
  own fields. Only the field's own errors are read: the rest of the body is not the question.
*/
const IMPOSSIBLE = ["2026-02-30", "2026-04-31", "2026-02-29T10:00:00.000Z"];
const REAL = ["2026-11-15", "2028-02-29", "2026-06-15T23:30:00.000Z"];

async function fieldErrors(
  dto: new () => object,
  field: string,
  value: string,
): Promise<string[]> {
  const errors = await validate(plainToInstance(dto, { [field]: value }));
  return errors
    .filter((error) => error.property === field)
    .flatMap((error) => Object.keys(error.constraints ?? {}));
}

/** Every field refuses an impossible day with `isIso8601`, and accepts a real day, a leap day and a day with a time. */
export async function assertStrictIsoDates(
  dto: new () => object,
  fields: readonly string[],
): Promise<void> {
  for (const field of fields) {
    for (const day of IMPOSSIBLE)
      assert.deepEqual(
        await fieldErrors(dto, field, day),
        ["isIso8601"],
        `${dto.name}.${field} ${day}`,
      );
    for (const day of REAL)
      assert.deepEqual(
        await fieldErrors(dto, field, day),
        [],
        `${dto.name}.${field} ${day}`,
      );
  }
}
