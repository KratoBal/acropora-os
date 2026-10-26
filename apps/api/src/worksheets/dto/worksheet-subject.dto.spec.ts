import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { AmendWorksheetDto, UpdateWorksheetDraftDto } from "./worksheet.dto.js";

/*
  THE SUBJECT IS MEASURED AFTER THE TRIM (barracuda, #1892 review). Before,
  `MinLength(1)` measured the raw value, so "   " passed and was stored empty.
  What turns this red: a whitespace-only subject accepted again, or a real one
  refused. Only the subject's own errors are read: the other fields of the body
  are not this spec's question.
*/
async function subjectErrors(
  dto: typeof UpdateWorksheetDraftDto | typeof AmendWorksheetDto,
  subject: unknown,
) {
  const errors = await validate(plainToInstance(dto, { subject }));
  return errors
    .filter((error) => error.property === "subject")
    .flatMap((error) => Object.keys(error.constraints ?? {}));
}

describe("worksheet subject", () => {
  it("refuses a whitespace-only subject, on a draft and on an amendment", async () => {
    for (const dto of [UpdateWorksheetDraftDto, AmendWorksheetDto]) {
      assert.deepEqual(await subjectErrors(dto, "   "), ["minLength"]);
      assert.deepEqual(await subjectErrors(dto, "\t\n "), ["minLength"]);
    }
  });

  it("accepts a subject with spaces around it, trimmed", async () => {
    assert.deepEqual(
      await subjectErrors(UpdateWorksheetDraftDto, "  Szűrőcsere "),
      [],
    );
    const instance = plainToInstance(UpdateWorksheetDraftDto, {
      subject: "  Szűrőcsere ",
    });
    assert.equal(instance.subject, "Szűrőcsere");
  });

  it("still refuses a missing or non-string subject", async () => {
    assert.ok(
      (await subjectErrors(UpdateWorksheetDraftDto, undefined)).includes(
        "isString",
      ),
    );
    assert.ok(
      (await subjectErrors(UpdateWorksheetDraftDto, 42)).includes("isString"),
    );
  });

  // the limit holds for the trimmed value too
  it("measures the 500-character limit on the trimmed value", async () => {
    assert.deepEqual(
      await subjectErrors(UpdateWorksheetDraftDto, ` ${"a".repeat(500)} `),
      [],
    );
    assert.deepEqual(
      await subjectErrors(UpdateWorksheetDraftDto, "a".repeat(501)),
      ["maxLength"],
    );
  });
});
