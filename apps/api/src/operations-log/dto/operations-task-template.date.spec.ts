import { describe, it } from "node:test";

import { assertStrictIsoDates } from "../../testing/strict-iso-date.js";
import { UpdateOperationsTaskTemplateDto } from "./operations-task-template.dto.js";

// An impossible day is a 400, not a silent next month (t-20261115-dto-datum-strict): a task template edit.
describe("strict ISO dates: a task template edit", () => {
  it("UpdateOperationsTaskTemplateDto: expectedUpdatedAt", async () => {
    await assertStrictIsoDates(UpdateOperationsTaskTemplateDto, [
      "expectedUpdatedAt",
    ]);
  });
});
