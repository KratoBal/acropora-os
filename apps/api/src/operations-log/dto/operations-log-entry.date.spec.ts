import { describe, it } from "node:test";

import { assertStrictIsoDates } from "../../testing/strict-iso-date.js";
import {
  CreateOperationsLogEntryDto,
  OperationsLogEntryListQueryDto,
} from "./operations-log-entry.dto.js";

// An impossible day is a 400, not a silent next month (t-20261115-dto-datum-strict): a log entry and the log filter.
describe("strict ISO dates: a log entry and the log filter", () => {
  it("CreateOperationsLogEntryDto: startedAt, finishedAt", async () => {
    await assertStrictIsoDates(CreateOperationsLogEntryDto, [
      "startedAt",
      "finishedAt",
    ]);
  });
  it("OperationsLogEntryListQueryDto: from, to", async () => {
    await assertStrictIsoDates(OperationsLogEntryListQueryDto, ["from", "to"]);
  });
});
