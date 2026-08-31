import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { amendRefusal } from "./worksheet-amendment.js";

describe("whether a worksheet version may be amended", () => {
  /**
   * The case that changed, and the reason this rule was pulled out of the
   * transaction: a SIGNED version used to be amendable. The signature would
   * then sit on a version nobody reads any more, while the document it was
   * given for had changed underneath it -- and nothing anywhere said so.
   */
  it("refuses a signed version, because a signed sheet is final", () => {
    assert.equal(amendRefusal("SIGNED"), "SIGNED");
  });

  /** A draft is edited, not amended: there is no closed version to supersede. */
  it("refuses a draft, and says so differently", () => {
    assert.equal(amendRefusal("DRAFT"), "NOT_CLOSED");
  });

  /**
   * The one that stays amendable, asserted rather than left implied. A rule
   * that only ever refuses would pass a test suite that never checks what it
   * lets through, and then nobody could amend anything.
   */
  it("lets a closed but unsigned sheet be amended", () => {
    assert.equal(amendRefusal("AWAITING_SIGNATURE"), null);
  });

  /**
   * REJECTED HAS ITS OWN TEST BECAUSE IT IS THE ONE STATE WHERE TWO READINGS
   * OF THE SAME RULE DISAGREE, and grouping it with AWAITING_SIGNATURE hid
   * that: it reads as one obvious case with two obvious members.
   *
   * The rule branches on the status name. The other reading - "the boundary is
   * the signature" - would refuse here, because a rejection DOES write a
   * signature row (`decision: "REJECTED"`, same transaction as the status
   * change; see WorksheetsRepository.sign).
   *
   * So this assertion is not a detail of the enum. It records which reading is
   * in force, and a change of mind has to come here and say so.
   */
  it("lets a rejected sheet be amended, even though a rejection is signed", () => {
    assert.equal(amendRefusal("REJECTED"), null);
  });
});
