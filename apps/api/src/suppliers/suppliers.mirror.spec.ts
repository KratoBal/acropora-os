import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { syncWorksheetMirror } from "./suppliers.repository.js";

interface Call {
  table: string;
  action: string;
  args: Record<string, unknown>;
}

/**
 * A stub transaction that records what was asked of it. The real thing needs a
 * database, and the integration gate keeps those runs out of `pnpm test`, so
 * what is asserted here is the decision rather than the write: which call is
 * made, and with what.
 */
function stubTransaction(calls: Call[], createdId = "customer-new") {
  return {
    customer: {
      update: async (args: Record<string, unknown>) => {
        calls.push({ table: "customer", action: "update", args });
        return {};
      },
      create: async (args: Record<string, unknown>) => {
        calls.push({ table: "customer", action: "create", args });
        return { id: createdId };
      },
    },
    supplier: {
      update: async (args: Record<string, unknown>) => {
        calls.push({ table: "supplier", action: "update", args });
        return {};
      },
    },
  } as never;
}

describe("the service partner's mirror customer", () => {
  /**
   * The failure this guards against is silence: a partner renamed on the
   * partner screen, the mirror left alone, and every worksheet written
   * afterwards carrying the old name. Nothing errors, so nothing reports it.
   */
  it("carries a renamed partner's name over to the mirror", async () => {
    const calls: Call[] = [];

    await syncWorksheetMirror(stubTransaction(calls), {
      id: "supplier-1",
      name: "Új Név Kft.",
      isService: true,
      customerId: "customer-7",
    });

    assert.deepEqual(calls, [
      {
        table: "customer",
        action: "update",
        args: {
          where: { id: "customer-7" },
          data: { displayName: "Új Név Kft.", companyName: "Új Név Kft." },
        },
      },
    ]);
  });

  /** A partner is recorded once, by hand. The row that carries its worksheets
   * is the system's job, so ticking "Szerviz" is enough to bring it into
   * being, and the partner is linked to it in the same transaction. */
  it("creates the mirror and links it when a partner becomes a service partner", async () => {
    const calls: Call[] = [];

    await syncWorksheetMirror(stubTransaction(calls), {
      id: "supplier-1",
      name: "Szerviz Bt.",
      isService: true,
      customerId: null,
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.action, "create");
    assert.deepEqual(calls[1], {
      table: "supplier",
      action: "update",
      args: {
        where: { id: "supplier-1" },
        data: { customerId: "customer-new" },
      },
    });
  });

  /**
   * Un-ticking "Szerviz" must not drop the row. Worksheets may already point
   * at it, and the relation refuses the delete anyway -- but the reason to
   * assert it here is that the tempting cleanup would look tidy and would take
   * a partner's history with it.
   */
  it("leaves an existing mirror alone when the partner is no longer service", async () => {
    const calls: Call[] = [];

    const kept = await syncWorksheetMirror(stubTransaction(calls), {
      id: "supplier-1",
      name: "Csak Beszállító Kft.",
      isService: false,
      customerId: "customer-7",
    });

    assert.deepEqual(calls, []);
    assert.equal(kept, "customer-7");
  });

  /** A partner that was never a service partner gets no row at all: the point
   * of the mirror is worksheets, and a supplier we only buy from has none. */
  it("does not invent a mirror for a partner we only buy from", async () => {
    const calls: Call[] = [];

    const none = await syncWorksheetMirror(stubTransaction(calls), {
      id: "supplier-1",
      name: "Csak Beszállító Kft.",
      isService: false,
      customerId: null,
    });

    assert.deepEqual(calls, []);
    assert.equal(none, null);
  });
});
