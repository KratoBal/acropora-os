import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSameClaim,
  parseReviewInput,
  type DuplicateCandidate,
} from "./claim-review.js";
import {
  DuplicateClaim,
  duplicateGuard,
  findVerifiedDuplicate,
} from "./claim-review.repository.js";

/*
  THE SAME CLAIM ACCEPTED TWICE (card 1e4790e4, acrobot 62304). On the test OS three separate VERIFIED records carried the same effect, direction, species and source (accepted within 80 seconds). WHAT TURNS
  THESE RED: a repeat that is not refused; a different quantity (another measurement) that is refused; a species order that changes the answer; a withdrawn or discarded copy that blocks a correct claim; a
  confirmation flag that does not travel; the first (oldest) claim not named.
*/
const dec = (value: string | null) =>
  value === null ? null : { toString: () => value };

const candidate = (
  over: Partial<DuplicateCandidate> = {},
): DuplicateCandidate => ({
  id: "claim-1",
  originalMin: null,
  originalMax: null,
  originalUnit: null,
  evidence: [{ species: ["ACROPORA_DIVARICATA"] }],
  ...over,
});
const columns = (over: Record<string, unknown> = {}) =>
  ({
    species: ["ACROPORA_DIVARICATA"],
    quantity: null,
    ...over,
  }) as Parameters<typeof isSameClaim>[1];

describe("isSameClaim", () => {
  it("the same species and no quantity on both sides is the same claim", () => {
    assert.equal(isSameClaim(candidate(), columns()), true);
  });

  it("the species order and repeats do not matter", () => {
    const stored = candidate({
      evidence: [{ species: ["ACROPORA", "PORITES"] }],
    });
    assert.equal(
      isSameClaim(
        stored,
        columns({ species: ["PORITES", "ACROPORA", "ACROPORA"] }),
      ),
      true,
    );
  });

  it("another species set is another claim", () => {
    assert.equal(
      isSameClaim(candidate(), columns({ species: ["PORITES"] })),
      false,
    );
    assert.equal(
      isSameClaim(
        candidate(),
        columns({ species: ["ACROPORA_DIVARICATA", "PORITES"] }),
      ),
      false,
    );
  });

  it("a quantity must match in min, max and unit; a different value is another measurement", () => {
    const stored = candidate({
      originalMin: dec("0.1"),
      originalMax: dec("0.5"),
      originalUnit: "µmol/l",
    });
    const same = columns({ quantity: { min: 0.1, max: 0.5, unit: "µmol/l" } });
    assert.equal(isSameClaim(stored, same), true);
    assert.equal(
      isSameClaim(
        stored,
        columns({ quantity: { min: 0.1, max: 0.9, unit: "µmol/l" } }),
      ),
      false,
    );
    assert.equal(
      isSameClaim(
        stored,
        columns({ quantity: { min: 0.1, max: 0.5, unit: "mg/l" } }),
      ),
      false,
    );
    // a stored quantity against none, and none against a stored quantity
    assert.equal(isSameClaim(stored, columns()), false);
    assert.equal(
      isSameClaim(
        candidate(),
        columns({ quantity: { min: 1, max: null, unit: "mg/l" } }),
      ),
      false,
    );
  });
});

describe("findVerifiedDuplicate", () => {
  const target = {
    claimId: "claim-new",
    subject: "PHOSPHATE",
    sourceId: "source-1",
    columns: {
      species: ["ACROPORA_DIVARICATA"],
      effect: "SYMBIONT_PHOSPHOROUS_RESERVES",
      direction: "INCREASE" as const,
      quantity: null,
    },
  };

  const clientWith = (rows: DuplicateCandidate[]) => {
    const calls: unknown[] = [];
    return {
      calls,
      client: {
        knowledgeClaim: {
          findMany: async (args: unknown) => {
            calls.push(args);
            return rows;
          },
        },
      } as never,
    };
  };

  it("asks only for VERIFIED claims of the same subject, effect, direction and source, not the claim itself", async () => {
    const { client, calls } = clientWith([]);
    await findVerifiedDuplicate(client, target);
    const where = (calls[0] as { where: Record<string, unknown> }).where;
    assert.deepEqual(where.id, { not: "claim-new" });
    assert.equal(where.status, "VERIFIED");
    assert.equal(where.subject, "PHOSPHATE");
    assert.equal(where.effect, "SYMBIONT_PHOSPHOROUS_RESERVES");
    assert.equal(where.direction, "INCREASE");
    assert.deepEqual(where.evidence, {
      some: { passage: { sourceVersion: { sourceId: "source-1" } } },
    });
  });

  it("names the OLDEST matching claim (the first acceptance is the original)", async () => {
    const { client } = clientWith([
      candidate({ id: "first" }),
      candidate({ id: "second" }),
    ]);
    assert.equal(await findVerifiedDuplicate(client, target), "first");
  });

  it("skips a candidate that differs in species or quantity, and finds none when nothing is the same", async () => {
    const { client } = clientWith([
      candidate({ id: "other-species", evidence: [{ species: ["PORITES"] }] }),
      candidate({
        id: "other-value",
        originalMin: dec("1"),
        originalUnit: "mg/l",
      }),
    ]);
    assert.equal(await findVerifiedDuplicate(client, target), null);
  });

  it("returns null with no candidates", async () => {
    const { client } = clientWith([]);
    assert.equal(await findVerifiedDuplicate(client, target), null);
  });
});

describe("DuplicateClaim and the confirmation", () => {
  it("is a conflict that carries the first claim's id in its message", () => {
    const error = new DuplicateClaim("claim-1");
    assert.equal(error.name, "DuplicateClaim");
    assert.equal(error.existingClaimId, "claim-1");
    assert.match(error.message, /already verified: claim-1/);
  });

  it("the review body carries confirmDuplicate: absent is false, true is true, anything else is refused", () => {
    const body = { decisions: [], applicability: null };
    assert.equal(parseReviewInput(body).confirmDuplicate, false);
    assert.equal(
      parseReviewInput({ ...body, confirmDuplicate: true }).confirmDuplicate,
      true,
    );
    assert.throws(
      () => parseReviewInput({ ...body, confirmDuplicate: "yes" }),
      /confirmDuplicate: true or false/,
    );
  });
});

describe("duplicateGuard", () => {
  it("no twin: nothing to refuse and nothing to audit", () => {
    assert.deepEqual(duplicateGuard(null, false), {});
    assert.deepEqual(duplicateGuard(null, true), {});
  });

  it("a twin without confirmation is refused, naming it", () => {
    assert.throws(
      () => duplicateGuard("claim-1", false),
      (error: unknown) =>
        error instanceof DuplicateClaim && error.existingClaimId === "claim-1",
    );
  });

  it("a confirmed twin passes and the audit names the claim it repeats", () => {
    assert.deepEqual(duplicateGuard("claim-1", true), {
      duplicateOf: "claim-1",
      duplicateConfirmed: true,
    });
  });
});
