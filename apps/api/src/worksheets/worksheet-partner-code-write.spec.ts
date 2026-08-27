import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { writePartnerCode } from "./worksheets.repository.js";

interface Written {
  where: unknown;
  data: unknown;
}

/**
 * A stub transaction. `supplier.findFirst` answers with a partner that holds
 * the code and has NO mirror row -- the case the customer-side unique index
 * cannot see, because no customer row carries that code at all.
 */
function stubTransaction(
  partner: { name: string; customerId: string | null } | null,
  written: Written[],
) {
  return {
    customer: {
      findUniqueOrThrow: async () => ({ worksheetPartnerCode: null }),
      findFirst: async () => null,
      update: async (args: Written) => {
        written.push(args);
        return {};
      },
    },
    supplier: { findFirst: async () => partner },
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
            { name: "Csak Beszállító Kft.", customerId: null },
            written,
          ),
          "customer-7",
          "FANK",
        ),
      /PARTNER_CODE_TAKEN:Csak Beszállító Kft\./,
    );

    // And nothing was written. A check that throws after the update would read
    // as green here and would still have changed the row.
    assert.deepEqual(written, []);
  });

  it("writes the code when nobody else carries it", async () => {
    const written: Written[] = [];

    await writePartnerCode(
      stubTransaction(null, written),
      "customer-7",
      "FANK",
    );

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
