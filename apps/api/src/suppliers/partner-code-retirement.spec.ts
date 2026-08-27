import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertPartnerCodeNeverNumbered,
  assertPartnerCodeUnlocked,
} from "./suppliers.repository.js";

/**
 * A stub that answers for `WorksheetNumberSequence` and records what it was
 * asked. The real table needs a database, and the unit gate keeps those runs
 * out of `pnpm test`, so what is asserted here is the QUESTION -- which code
 * was looked up -- and the decision taken from the answer.
 */
function stubSequence(row: { partnerCode: string } | null, asked: unknown[]) {
  return {
    worksheetNumberSequence: {
      findFirst: async (args: unknown) => {
        asked.push(args);
        return row;
      },
    },
  } as never;
}

describe("a partner code that has already numbered a sheet", () => {
  /**
   * The ambiguity this prevents is on paper. A number of the old shape
   * (`FANK-BIO-2026-001`) names its partner by those four characters, and that
   * sheet is already in somebody's folder. Handing the code to another partner
   * would make the folder lie, and nothing in the system would report it.
   */
  it("cannot be handed to another partner", async () => {
    const asked: unknown[] = [];

    await assert.rejects(
      () =>
        assertPartnerCodeNeverNumbered(
          stubSequence({ partnerCode: "FANK" }, asked),
          "FANK",
        ),
      /^Error: PARTNER_CODE_USED_IN_NUMBERS$/,
    );

    // The lookup is by code alone. Narrowing it by partner would defeat the
    // rule: the point is codes whose holder has already let go of them.
    assert.deepEqual(asked, [
      { where: { partnerCode: "FANK" }, select: { partnerCode: true } },
    ]);
  });

  it("cannot be changed or cleared by the partner that holds it", async () => {
    const asked: unknown[] = [];

    await assert.rejects(
      () =>
        assertPartnerCodeUnlocked(
          stubSequence({ partnerCode: "FANK" }, asked),
          "FANK",
        ),
      /^Error: PARTNER_CODE_LOCKED$/,
    );
    assert.deepEqual(asked, [
      { where: { partnerCode: "FANK" }, select: { partnerCode: true } },
    ]);
  });

  /**
   * Two different errors on purpose, and this is what keeps them apart. The
   * messages they turn into say different things to different people: one is
   * "pick another code", the other is "this one cannot move any more". A
   * single error would force one sentence to cover both, and the person
   * reading it would not know which of the two applied.
   */
  it("says which of the two rules it is", async () => {
    const reason = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error: unknown) => (error as Error).message,
      );

    const taking = await reason(
      assertPartnerCodeNeverNumbered(
        stubSequence({ partnerCode: "FANK" }, []),
        "FANK",
      ),
    );
    const moving = await reason(
      assertPartnerCodeUnlocked(
        stubSequence({ partnerCode: "FANK" }, []),
        "FANK",
      ),
    );

    assert.equal(taking, "PARTNER_CODE_USED_IN_NUMBERS");
    assert.equal(moving, "PARTNER_CODE_LOCKED");
    assert.notEqual(taking, moving);
  });

  /** A code no number was ever built from is free to move, in both directions.
   * Since 2026-08-27 new numbers do not carry the abbreviation at all, so this
   * is the ordinary case from now on, not the exception. */
  it("stays movable while no number was ever built from it", async () => {
    await assertPartnerCodeNeverNumbered(stubSequence(null, []), "BIOD");
    await assertPartnerCodeUnlocked(stubSequence(null, []), "BIOD");
  });
});
