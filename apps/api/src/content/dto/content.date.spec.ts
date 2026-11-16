import { describe, it } from "node:test";

import { assertStrictIsoDates } from "../../testing/strict-iso-date.js";
import { ContentCalendarQueryDto, ContentCreateDto } from "./content.dto.js";

// An impossible day is a 400, not a silent next month (t-20261115-dto-datum-strict): the content calendar range and the planned day.
describe("strict ISO dates: the content calendar range and the planned day", () => {
  it("ContentCalendarQueryDto: from, to", async () => {
    await assertStrictIsoDates(ContentCalendarQueryDto, ["from", "to"]);
  });
  it("ContentCreateDto: plannedFor", async () => {
    await assertStrictIsoDates(ContentCreateDto, ["plannedFor"]);
  });
});
