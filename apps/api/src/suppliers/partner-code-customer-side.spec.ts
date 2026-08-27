import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertPartnerCodeFreeForCustomer } from "./suppliers.repository.js";

interface Row {
  customer: { id: string; displayName: string } | null;
  partner: { name: string; customerId: string | null } | null;
}

/**
 * A stub that answers both lookups and records the filters it was given. The
 * real thing needs a database and the unit gate keeps those runs out of
 * `pnpm test`, so what is asserted here is the decision: which row was
 * consulted, and what the function concluded from it.
 */
function stub(rows: Row, asked: unknown[] = []) {
  return {
    customer: {
      findFirst: async (args: unknown) => {
        asked.push(args);
        return rows.customer;
      },
    },
    supplier: {
      findFirst: async (args: unknown) => {
        asked.push(args);
        return rows.partner;
      },
    },
  } as never;
}

describe("the partner code, checked from the customer side", () => {
  /**
   * THE NEGATIVE CONTROL, and the input is the exact case nothing catches
   * today: a code held by a supplier with NO mirror row. The customer-side
   * unique index cannot see it -- there is no customer row carrying that code
   * -- so before this check the write went through, and the failure surfaced
   * later, on the supplier's next save, in a message naming a customer for a
   * code that supplier had held all along.
   *
   * `customerId: null` is the whole point of the case. A supplier only has a
   * mirror when it is a service partner; a code on a non-service partner is
   * reachable through the API and leaves no customer row behind.
   */
  it("refuses a code held by a supplier that has no mirror row", async () => {
    await assert.rejects(
      () =>
        assertPartnerCodeFreeForCustomer(
          stub({
            customer: null,
            partner: { name: "Csak Beszállító Kft.", customerId: null },
          }),
          "FANK",
          "customer-7",
        ),
      /PARTNER_CODE_TAKEN:Csak Beszállító Kft\./,
    );
  });

  it("refuses a code another customer already holds, and names them", async () => {
    await assert.rejects(
      () =>
        assertPartnerCodeFreeForCustomer(
          stub({
            customer: { id: "customer-1", displayName: "Fankó Kft." },
            partner: null,
          }),
          "FANK",
          "customer-7",
        ),
      /PARTNER_CODE_TAKEN:Fankó Kft\./,
    );
  });

  /**
   * The mirror is the case that must NOT be refused: a service partner and the
   * customer row carrying its worksheets hold the same code on purpose, and the
   * partner screen writes both in one transaction. A check that flagged this
   * would make every such save fail.
   */
  it("lets a mirror row keep the code its own partner carries", async () => {
    await assertPartnerCodeFreeForCustomer(
      stub({
        customer: { id: "customer-7", displayName: "Fankó Kft." },
        partner: { name: "Fankó Kft.", customerId: "customer-7" },
      }),
      "FANK",
      "customer-7",
    );
  });

  /**
   * The lookups filter on the code alone. Narrowing them with a negated filter
   * on `customerId` would be the obvious shortcut and would drop exactly the
   * row the first test is about: `NOT (customerId = 'x')` is NULL, not true,
   * when the column is NULL.
   */
  it("asks by code alone and decides in code, not in a negated filter", async () => {
    const asked: unknown[] = [];

    await assertPartnerCodeFreeForCustomer(
      stub({ customer: null, partner: null }, asked),
      "FANK",
      "customer-7",
    );

    assert.deepEqual(asked, [
      {
        where: { worksheetPartnerCode: "FANK" },
        select: { id: true, displayName: true },
      },
      {
        where: { worksheetPartnerCode: "FANK" },
        select: { name: true, customerId: true },
      },
    ]);
  });
});
