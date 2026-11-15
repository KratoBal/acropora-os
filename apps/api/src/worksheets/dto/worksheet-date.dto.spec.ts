import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  AmendWorksheetDto,
  CreateWorksheetDto,
  UpdateWorksheetDraftDto,
} from "./worksheet.dto.js";

/*
  AN IMPOSSIBLE DAY IS A 400, NOT A SILENT NEXT MONTH (t-20261115-munkalap-datum). The non-strict `IsISO8601`
  accepted 2026-02-30, and `new Date` turned it into 2026-03-02 on the document a bill is based on. What turns
  this red: the strict mode removed from one of the three fields, or a real day (a leap day, a day with a time)
  refused. Only the date fields' own errors are read.
*/
const FIELDS = ["issueDate", "fulfillmentDate", "dueDate"] as const;

async function dateErrors(
  dto:
    | typeof CreateWorksheetDto
    | typeof UpdateWorksheetDraftDto
    | typeof AmendWorksheetDto,
  field: (typeof FIELDS)[number],
  value: string,
) {
  const errors = await validate(plainToInstance(dto, { [field]: value }));
  return errors
    .filter((error) => error.property === field)
    .flatMap((error) => Object.keys(error.constraints ?? {}));
}

describe("worksheet dates", () => {
  it("refuses an impossible day on every date field of every content DTO", async () => {
    for (const dto of [
      CreateWorksheetDto,
      UpdateWorksheetDraftDto,
      AmendWorksheetDto,
    ])
      for (const field of FIELDS)
        for (const day of ["2026-02-30", "2026-04-31"])
          assert.deepEqual(
            await dateErrors(dto, field, day),
            ["isIso8601"],
            `${dto.name}.${field} ${day}`,
          );
  });

  it("accepts a real day, a leap day and a day with a time", async () => {
    for (const field of FIELDS)
      for (const day of [
        "2026-11-15",
        "2028-02-29",
        "2026-06-15T23:30:00.000Z",
      ])
        assert.deepEqual(
          await dateErrors(UpdateWorksheetDraftDto, field, day),
          [],
          `${field} ${day}`,
        );
  });
});
