// The DTO's decorators read their metadata through `Reflect`, which the
// application installs in `main.ts`. A unit test starts without it, so the
// import has to come first, before the DTO module is evaluated.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { CreateWorksheetDepartmentDto } from "./dto/worksheet.dto.js";
import { WORKSHEET_NUMBER_ISSUE_MESSAGES } from "./worksheet-number.js";

/**
 * One word per idea, and it has to be the word on screen.
 *
 * The schema calls this a `WorksheetDepartment` and the code still does. Every
 * screen calls it an "alegység" - the label above the field, the button, the
 * page's own error messages - and "részleg" appears nowhere a colleague can
 * see. A server message using the schema's word names something that is not on
 * their screen, and it arrives exactly when they are already stuck.
 */
describe("worksheet wording", () => {
  it("never says részleg in a message that reaches a screen", () => {
    for (const message of Object.values(WORKSHEET_NUMBER_ISSUE_MESSAGES)) {
      assert.ok(
        !/részleg/i.test(message),
        `a closing message still says "részleg": ${message}`,
      );
    }
  });

  it("says alegység in the code rule the unit form shows", () => {
    // Hat karakter: a hatar 2026-09-23-tol ot, tehat a negy karakteres
    // "BIOD" ma mar ERVENYES lenne -- ez a kod ket kulon dolgot bizonyitana
    // egyszerre, ha a hatar valaha ujra eltolodna alatta.
    const dto = plainToInstance(CreateWorksheetDepartmentDto, {
      code: "BIODOM",
      name: "Biodóm",
    });
    const messages = validateSync(dto).flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );

    assert.deepEqual(messages, [
      "Az alegység kódja legfeljebb öt betű vagy szám lehet (pl. BIO vagy LSS01).",
    ]);
  });
});
