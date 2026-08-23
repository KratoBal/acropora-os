import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PARTNER_REFERENCE_KINDS,
  planPartnerDeletion,
} from "./partner-deletion.js";

describe("partner deletion plan", () => {
  it("deletes the row when nothing points at the partner", () => {
    assert.deepEqual(planPartnerDeletion({}), {
      action: "delete",
      alsoRemoved: [],
    });
  });

  /**
   * A single reference is enough. It is not the quantity that decides, but
   * whether there is an older record the name would disappear from.
   */
  it("keeps the row for a single worksheet", () => {
    const plan = planPartnerDeletion({ worksheets: 1 });

    assert.equal(plan.action, "mark-deleted");
    if (plan.action !== "mark-deleted") return;
    assert.deepEqual(plan.blockedBy, [{ label: "munkalap", count: 1 }]);
  });

  /**
   * The one the database would NOT have stopped. `SET NULL` leaves no error
   * behind: a physical delete would quietly empty the partner's name on an
   * old sales order, and nothing would report it. This is why the decision is
   * made here rather than left to the foreign keys.
   */
  it("keeps the row for a sales order, which the database would have let through", () => {
    const plan = planPartnerDeletion({ salesOrders: 2 });

    assert.equal(plan.action, "mark-deleted");
    if (plan.action !== "mark-deleted") return;
    assert.deepEqual(plan.blockedBy, [
      { label: "értékesítési rendelés", count: 2 },
    ]);
  });

  it("names every kind that holds the partner back, not just the first", () => {
    const plan = planPartnerDeletion({
      purchaseInvoices: 3,
      worksheets: 1,
      aquariums: 5,
    });

    assert.equal(plan.action, "mark-deleted");
    if (plan.action !== "mark-deleted") return;
    assert.deepEqual(
      plan.blockedBy.map((entry) => entry.label),
      ["beszerzési számla", "akvárium", "munkalap"],
    );
  });

  /**
   * What was created with the partner goes with it, and does not hold the
   * deletion back - but the confirmation has to name it, because the reader
   * loses it too.
   */
  it("deletes despite its own rows, and says what goes with it", () => {
    const plan = planPartnerDeletion({
      supplierProducts: 4,
      mirrorAddresses: 1,
    });

    assert.equal(plan.action, "delete");
    if (plan.action !== "delete") return;
    assert.deepEqual(plan.alsoRemoved, [
      { label: "beszállítói termékkapcsolat", count: 4 },
      { label: "cím a tükör vevő-soron", count: 1 },
    ]);
  });

  /**
   * The list is the whole point of this module: a kind left out of it would
   * be a physical delete on a partner something still points at. Fifteen is
   * what the schema allows today - six on the partner row, nine through the
   * mirror customer row.
   */
  it("covers every reference the schema allows", () => {
    assert.equal(PARTNER_REFERENCE_KINDS.length, 15);
    assert.equal(
      new Set(PARTNER_REFERENCE_KINDS.map((kind) => kind.key)).size,
      15,
    );
    for (const kind of PARTNER_REFERENCE_KINDS) {
      assert.ok(kind.label.length > 0, `${kind.key} has no label`);
      assert.ok(
        kind.label === kind.label.toLowerCase() ||
          /[A-ZÁÉÍÓÖŐÚÜŰ]/.test(kind.label) === false,
        `${kind.key} label should read inside a sentence`,
      );
    }
  });
});
