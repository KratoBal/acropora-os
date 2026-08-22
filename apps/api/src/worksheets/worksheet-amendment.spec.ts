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
   * The two that stay amendable, asserted rather than left implied. A rule
   * that only ever refuses would pass a test suite that never checks what it
   * lets through, and then nobody could amend anything.
   */
  it("lets a closed sheet be amended, signed or refused by the customer", () => {
    assert.equal(amendRefusal("AWAITING_SIGNATURE"), null);
    assert.equal(amendRefusal("REJECTED"), null);
  });
});
