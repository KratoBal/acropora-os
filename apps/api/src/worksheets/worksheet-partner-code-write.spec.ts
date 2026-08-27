import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { writePartnerCode } from "./worksheets.repository.js";

interface Written {
  where: unknown;
  data: unknown;
}

interface World {
  /** The partner whose mirror this customer row is, if it is one. */
  mirrorOf?: { name: string } | null;
  /** The supplier that already holds the code, if any. */
  codeHolder?: { name: string; customerId: string | null } | null;
}

/**
 * A stub transaction. The two supplier lookups are told apart by what they
 * filter on, because the order of the checks is part of what is asserted here:
 * a mirror row is refused before the code is even looked at.
 */
function stubTransaction(world: World, written: Written[]) {
  return {
    customer: {
      findUniqueOrThrow: async () => ({ worksheetPartnerCode: null }),
      findFirst: async () => null,
      update: async (args: Written) => {
        written.push(args);
        return {};
      },
    },
    supplier: {
      findFirst: async (args: { where: Record<string, unknown> }) =>
        "customerId" in args.where
          ? (world.mirrorOf ?? null)
          : (world.codeHolder ?? null),
    },
    // A kód-visszavonulás ellenőrzése (#185) ugyanebben a törzsben fut: üres
    // előzmény, mert ezek a próbák nem arról szólnak.
    worksheetNumberSequence: { findFirst: async () => null },
  } as never;
}

describe("writing the partner code from the worksheet side", () => {
  /**
   * THE NEGATIVE CONTROL for the WIRING, not for the rule. The rule itself is
   * asserted in partner-code-customer-side.spec.ts; this one fails if the check
   * is ever dropped from the write path, which is the failure that actually
   * happened: for months this endpoint wrote the column with nothing in front
   * of it.
   *
   * It lives outside the repository method on purpose -- the method sits behind
   * `$transaction`, so a unit test could not reach it, and a guard that cannot
   * run is not a guard.
   */
  it("refuses to write a code a mirrorless supplier already holds", async () => {
    const written: Written[] = [];

    await assert.rejects(
      () =>
        writePartnerCode(
          stubTransaction(
            { codeHolder: { name: "Csak Beszállító Kft.", customerId: null } },
            written,
          ),
          "customer-7",
          "FANK",
        ),
      /PARTNER_CODE_TAKEN_BY_SUPPLIER:Csak Beszállító Kft\./,
    );

    // And nothing was written. A check that throws after the update would read
    // as green here and would still have changed the row.
    assert.deepEqual(written, []);
  });

  /**
   * THE SECOND NEGATIVE CONTROL, for the other hole: the mirror row. Its code
   * is a derived value -- the supplier's row is the source, and
   * `syncWorksheetMirror` writes it back on every save. Setting it here does not
   * merely get lost later: until the write-back it is the value the worksheet
   * number would be built from, so it can hand out a wrong number first.
   */
  it("refuses to write onto a mirror row, and says where the code belongs", async () => {
    const written: Written[] = [];

    await assert.rejects(
      () =>
        writePartnerCode(
          stubTransaction({ mirrorOf: { name: "Fankó Kft." } }, written),
          "customer-7",
          "FANK",
        ),
      /PARTNER_CODE_MIRROR_ROW:Fankó Kft\./,
    );

    assert.deepEqual(written, []);
  });

  it("writes the code when nobody else carries it", async () => {
    const written: Written[] = [];

    await writePartnerCode(stubTransaction({}, written), "customer-7", "FANK");

    assert.deepEqual(written, [
      {
        where: { id: "customer-7" },
        data: { worksheetPartnerCode: "FANK" },
        select: {
          id: true,
          customerNumber: true,
          displayName: true,
          worksheetPartnerCode: true,
        },
      },
    ]);
  });
});
