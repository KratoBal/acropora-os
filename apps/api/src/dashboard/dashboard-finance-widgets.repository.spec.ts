import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DashboardFinanceWidgetsRepository } from "./dashboard-finance-widgets.repository.js";
import { OVERDUE_COUNTED_KIND_CODES } from "./overdue-invoices.js";

interface Call {
  model: string;
  method: string;
  args: unknown;
}

function repositoryWith(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const database = new Proxy(
    {},
    {
      get: (_, name: string) =>
        new Proxy(
          { fields: { grossAmount: "<grossAmount field>" } },
          {
            get: (target, method: string) => {
              if (method === "fields") return target.fields;
              return async (args: unknown) => {
                calls.push({ model: name, method, args });
                const answer = answers[`${name}.${method}`];
                return typeof answer === "function" ? answer(args) : answer;
              };
            },
          },
        ),
    },
  );
  const repository = new DashboardFinanceWidgetsRepository();
  (repository as unknown as { database: unknown }).database = database;
  return { repository, calls };
}
const json = (value: unknown) => JSON.stringify(value);

describe("the finance widget reads", () => {
  it("narrows the overdue candidates only by what is certain", async () => {
    const { repository, calls } = repositoryWith({
      "externalBillingDocument.findMany": [],
    });
    await repository.overdueInvoiceRows(new Date("2026-10-02T10:00:00Z"), 7);
    const where = (calls[0]?.args as { where: Record<string, unknown> }).where;
    assert.equal(where.cancelled, false);
    assert.deepEqual(where.kindCode, { in: [...OVERDUE_COUNTED_KIND_CODES] });
    // the last day of the window, as a calendar day
    assert.equal(
      json(where.dueDate),
      json({ not: null, lte: new Date("2026-10-09T00:00:00Z") }),
    );
    // only invoices FULLY paid by recorded payments are dropped in SQL
    assert.equal(
      json(where.NOT),
      json({ paymentsKnown: true, paidAmount: { gte: "<grossAmount field>" } }),
    );
  });

  it("incoming: unbooked NAV invoices with the expected-arrivals filter, NAV errors, failed and late-corrected mail documents", async () => {
    const { repository, calls } = repositoryWith({
      "navIncomingInvoice.count": (args: unknown) =>
        json(args).includes("ERROR") ? 1 : 4,
      "incomingSupplierDocument.count": (args: unknown) =>
        json(args).includes("FAILED") ? 2 : 3,
    });
    assert.deepEqual(await repository.incomingInvoices(), {
      navToBook: 4,
      navErrors: 1,
      mailboxFailed: 2,
      lateCorrections: 3,
    });
    assert.equal(
      json(calls[0]?.args),
      json({
        where: {
          status: { in: ["NEW", "DATA_FETCHED"] },
          purchaseInvoiceId: null,
          invoiceOperation: "CREATE",
        },
      }),
    );
  });

  it("settlements: review and error counts per source, SimplePay included, and each last run", async () => {
    const at = new Date("2026-10-02T05:00:00Z");
    const { repository } = repositoryWith({
      "foxpostSettlement.count": (args: unknown) =>
        json(args).includes("ERROR") ? 1 : 2,
      "glsCodReport.count": 3,
      "simplePayReport.count": 4,
      "foxpostSyncRun.findFirst": { status: "FAILED", startedAt: at },
      "glsSyncRun.findFirst": null,
      "simplePaySyncRun.findFirst": { status: "APPLIED", startedAt: at },
    });
    const data = await repository.settlements();
    assert.deepEqual(
      data.sources.map((s) => [
        s.source,
        s.needsReview,
        s.errors,
        s.lastRun?.status ?? null,
      ]),
      [
        ["FOXPOST", 2, 1, "FAILED"],
        ["GLS", 3, 0, null],
        ["SIMPLEPAY", 4, 0, "APPLIED"],
      ],
    );
  });
});
