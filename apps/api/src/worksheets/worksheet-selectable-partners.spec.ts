import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WorksheetsRepository } from "./worksheets.repository.js";

describe("the partners a worksheet may be written for", () => {
  /**
   * All five conditions asserted together, because each one keeps out a
   * different kind of unusable partner and dropping any of them looks
   * harmless:
   *
   * - not a service partner: we buy from it, we do not work for it.
   * - inactive: a partner nobody deals with any more.
   * - deleted: somebody meant to remove it, and only an older record kept the
   *   row alive. Offering it for a new sheet would mean the deletion never
   *   happened; the name still shows on the sheets it already has.
   * - no partner code: the sheet could be opened and then refuse to close,
   *   because the number cannot be built without its first segment. The
   *   technician would find that out in front of the customer.
   * - no mirror customer row: nothing for the sheet to belong to.
   *
   * Asserted as the whole object rather than key by key: a condition silently
   * removed is exactly the failure this guards, and a per-key check would not
   * notice one going missing.
   */
  it("keeps out every partner a sheet could not be finished for", () => {
    assert.deepEqual(WorksheetsRepository.selectablePartnerWhere(), {
      isService: true,
      isActive: true,
      deletedAt: null,
      worksheetPartnerCode: { not: null },
      customerId: { not: null },
    });
  });
});
