import { describe, it } from "node:test";

import { assertStrictIsoDates } from "../../testing/strict-iso-date.js";
import { BillingDocumentDraftDto } from "./billing-document-draft.dto.js";

// An impossible day is a 400, not a silent next month (t-20261115-dto-datum-strict): a billing draft save.
describe("strict ISO dates: a billing draft save", () => {
  it("BillingDocumentDraftDto: expectedUpdatedAt", async () => {
    await assertStrictIsoDates(BillingDocumentDraftDto, ["expectedUpdatedAt"]);
  });
});
