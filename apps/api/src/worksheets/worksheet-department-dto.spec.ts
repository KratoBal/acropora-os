// The decorators on the DTO read their metadata through `Reflect`, which the
// application installs in `main.ts`. A unit test starts without it, so the
// import has to come first, before the DTO module is evaluated.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { CreateWorksheetDepartmentDto } from "./dto/worksheet.dto.js";

function messagesFor(input: unknown): string[] {
  const dto = plainToInstance(CreateWorksheetDepartmentDto, input);
  return validateSync(dto).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

describe("create worksheet department input", () => {
  it("accepts a three-letter code with a real name", () => {
    assert.deepEqual(messagesFor({ code: "BIO", name: "Biodóm" }), []);
  });

  it("says every complaint in Hungarian, including the ones about the name", () => {
    const messages = messagesFor({});

    assert.ok(messages.length > 0, "an empty body has to be refused");
    for (const message of messages) {
      // The default validator text is English ("name must be a string"), and
      // it used to reach the shop floor verbatim, next to a Hungarian
      // sentence.
      assert.ok(
        !/must be|should be/i.test(message),
        `untranslated validator message: ${message}`,
      );
    }
  });

  it("refuses a code that is not three letters, and says why", () => {
    const messages = messagesFor({ code: "BIOD", name: "Biodóm" });

    assert.deepEqual(messages, [
      "A részleg kódja legfeljebb három betű lehet (pl. BIO).",
    ]);
  });
});
