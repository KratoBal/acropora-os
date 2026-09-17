import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedUser } from "@acropora/types";

import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

const PARTNER = {
  id: "partner-a-user",
  role: "PARTNER_SERVICE",
  customerId: "customer-a",
  supplierId: null,
} as AuthenticatedUser;

describe("partneri munkalap-aláírás", () => {
  it("a partner nem tudja aláírni másik partner munkalapját", async () => {
    let signCalled = false;
    const repository = {
      detail: async () => null,
      sign: async () => {
        signCalled = true;
        return { ok: true };
      },
    } as unknown as WorksheetsRepository;
    const service = new WorksheetsService(repository);

    await assert.rejects(
      () =>
        service.sign(
          "other-partner-sheet",
          { decision: "ACCEPTED", signerName: "Teszt aláíró" },
          PARTNER,
        ),
      (error: { status?: number }) => error.status === 404,
    );
    assert.equal(signCalled, false);
  });
});
