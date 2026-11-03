import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  hostOfDatabaseUrl,
  runDemoData,
  type DemoCounts,
  type DemoStore,
} from "./demo-data.cli.js";
import { POS_MANUAL_VAT_RATES } from "@acropora/types";

import { DEMO_PREFIX, demoPlan, plusDays } from "./demo-data.plan.js";

/*
  WHAT TURNS THIS RED (card c958804d, T6.3). A plan row without the DEMO- prefix (it would
  not be found again, and `--remove` would leave it); a quote that points at a customer the
  plan does not carry; an amount that does not add up (the list and the editor would show a
  number that is wrong by construction); a write that happens without the host being named
  or with a host that is not the DATABASE_URL's; a plan run that touches the store; a second
  run that claims to have written.
*/

const DAY = "2026-11-04";
/** A repo gyokere: a forditott spec a `test-dist/demo-data/` alatt fut. */
const REPO = new globalThis.URL("../../../../", import.meta.url).pathname;
const template = (name: string) => readFileSync(`${REPO}${name}`, "utf8");
const DB_URL = "postgresql://u:p@db-stage.internal:5432/acropora";

function fakeStore(counts: Partial<DemoCounts> = {}) {
  const calls: string[] = [];
  const full: DemoCounts = {
    customers: 0,
    quotes: 0,
    posSales: 0,
    incomingInvoices: 0,
    ...counts,
  };
  const store: DemoStore = {
    apply: async () => {
      calls.push("apply");
      return full;
    },
    remove: async () => {
      calls.push("remove");
      return full;
    },
  };
  return { calls, store };
}

async function run(
  argv: string[],
  opts: {
    url?: string | undefined;
    allowed?: string | undefined;
    counts?: Partial<DemoCounts>;
  } = {},
) {
  const { calls, store } = fakeStore(opts.counts);
  const out: string[] = [];
  const err: string[] = [];
  const code = await runDemoData(
    argv,
    { stdout: (t) => out.push(t), stderr: (t) => err.push(t) },
    {
      databaseUrl: "url" in opts ? opts.url : DB_URL,
      allowed: "allowed" in opts ? opts.allowed : "stage",
      today: DAY,
      store: () => store,
    },
  );
  return { code, calls, out: out.join(""), err: err.join("") };
}

describe("the demo plan", () => {
  const plan = demoPlan(DAY);

  it("carries the DEMO- marker on every business key it will be found by", () => {
    for (const c of plan.customers)
      assert.ok(c.customerNumber.startsWith(DEMO_PREFIX), c.customerNumber);
    for (const q of plan.quotes)
      assert.ok(q.quoteNumber.startsWith(DEMO_PREFIX), q.quoteNumber);
    for (const p of plan.posSales)
      assert.ok(p.orderNumber.startsWith(DEMO_PREFIX), p.orderNumber);
    for (const i of plan.incomingInvoices) {
      assert.ok(i.externalId.startsWith(DEMO_PREFIX), i.externalId);
      assert.ok(i.documentNumber.startsWith(DEMO_PREFIX), i.documentNumber);
    }
  });

  it("has unique keys, and every quote names a customer of the plan", () => {
    const customers = plan.customers.map((c) => c.customerNumber);
    assert.equal(new Set(customers).size, customers.length);
    const quotes = plan.quotes.map((q) => q.quoteNumber);
    assert.equal(new Set(quotes).size, quotes.length);
    const externals = plan.incomingInvoices.map((i) => i.externalId);
    assert.equal(new Set(externals).size, externals.length);
    for (const q of plan.quotes)
      assert.ok(customers.includes(q.customerNumber), q.customerNumber);
    const orders = plan.posSales.map((p) => p.orderNumber);
    assert.equal(new Set(orders).size, orders.length);
    for (const p of plan.posSales)
      if (p.customerNumber !== null)
        assert.ok(customers.includes(p.customerNumber), p.orderNumber);
  });

  it("is the same for the same day and moves with the day", () => {
    assert.deepEqual(demoPlan(DAY), plan);
    assert.notDeepEqual(demoPlan("2026-12-01"), plan);
    for (const q of plan.quotes) assert.ok(q.validUntil > DAY, q.quoteNumber);
  });

  it("keeps the amounts consistent: line = summary = total, paid = gross", () => {
    for (const i of plan.incomingInvoices) {
      const lines = i.lines as unknown as { grossAmount: string }[];
      const summary = i.vatSummary as unknown as {
        netAmount: string;
        vatAmount: string;
        grossAmount: string;
      }[];
      const net = Number(i.netAmount);
      const vat = Number(i.vatAmount);
      assert.equal(Number(i.grossAmount), net + vat, i.documentNumber);
      assert.equal(Number(lines[0]!.grossAmount), net + vat, i.documentNumber);
      assert.equal(Number(summary[0]!.netAmount), net, i.documentNumber);
      const payments = i.payments as unknown as { amount: string }[];
      if (Number(i.paidAmount) > 0) {
        assert.equal(Number(i.paidAmount), net + vat, i.documentNumber);
        assert.equal(payments.length, 1, i.documentNumber);
      } else {
        assert.equal(payments.length, 0, i.documentNumber);
      }
    }
  });

  it("covers the states worth trying: paid, unpaid, overdue, foreign, payments unknown", () => {
    const rows = plan.incomingInvoices;
    const due = (r: (typeof rows)[number]) =>
      (r.dueDate as Date).toISOString().slice(0, 10);
    assert.ok(
      rows.some((r) => Number(r.paidAmount) > 0),
      "paid",
    );
    assert.ok(
      rows.some(
        (r) => Number(r.paidAmount) === 0 && r.paymentsKnown && due(r) > DAY,
      ),
      "unpaid, not due",
    );
    assert.ok(
      rows.some(
        (r) => Number(r.paidAmount) === 0 && r.paymentsKnown && due(r) < DAY,
      ),
      "overdue",
    );
    assert.ok(
      rows.some((r) => r.currency === "EUR"),
      "foreign",
    );
    assert.ok(
      rows.some((r) => r.paymentsKnown === false),
      "payments unknown",
    );
  });

  it("keeps the POS totals consistent and the lines manual-only with a rate the POS allows", () => {
    for (const p of plan.posSales) {
      const orderFactor = 1 - Number(p.discountPercent ?? 0) / 100;
      const gross =
        p.lines.reduce(
          (sum, l) =>
            sum +
            Number(l.unitGross) *
              Number(l.quantity) *
              (1 - Number(l.discountPercent ?? 0) / 100),
          0,
        ) * orderFactor;
      assert.ok(Math.abs(Number(p.totalGross) - gross) < 0.001, p.orderNumber);
      assert.ok(
        Math.abs(
          Number(p.totalNet) + Number(p.totalTax) - Number(p.totalGross),
        ) < 0.001,
        p.orderNumber,
      );
      assert.ok(Number(p.totalNet) < Number(p.totalGross), p.orderNumber);
      for (const l of p.lines)
        assert.ok(
          (POS_MANUAL_VAT_RATES as readonly number[]).includes(l.vatRate),
          `${p.orderNumber} ${l.description}`,
        );
      assert.ok(p.completedAt.slice(0, 10) <= DAY, p.orderNumber);
    }
  });

  it("covers every payment method, a customer sale and a discounted order", () => {
    const methods = new Set(plan.posSales.map((p) => p.paymentMethod));
    for (const m of ["CASH", "CARD", "TRANSFER", "CASH_DESK"])
      assert.ok(methods.has(m as never), m);
    assert.ok(plan.posSales.some((p) => p.customerNumber !== null));
    assert.ok(plan.posSales.some((p) => p.discountPercent !== null));
  });

  it("has milestones that add up to 100 percent where a quote has any", () => {
    const withMilestones = plan.quotes.filter((q) => q.milestones.length > 0);
    assert.ok(withMilestones.length > 0);
    for (const q of withMilestones)
      assert.equal(
        q.milestones.reduce((sum, m) => sum + Number(m.percent), 0),
        100,
        q.quoteNumber,
      );
  });

  it("adds days on the calendar, not on the clock", () => {
    assert.equal(plusDays("2026-10-30", 3), "2026-11-02");
    assert.equal(plusDays("2026-03-01", -1), "2026-02-28");
  });
});

describe("the host of a database URL", () => {
  it("reads the host, lower-cased, and nothing else", () => {
    assert.equal(hostOfDatabaseUrl(DB_URL), "db-stage.internal");
    assert.equal(
      hostOfDatabaseUrl("postgresql://u:p@DB-Stage.Internal/x"),
      "db-stage.internal",
    );
  });
  it("is null when there is nothing to read", () => {
    assert.equal(hostOfDatabaseUrl(undefined), null);
    assert.equal(hostOfDatabaseUrl(""), null);
    assert.equal(hostOfDatabaseUrl("nem url"), null);
  });
});

describe("the command", () => {
  it("prints the plan and never touches the store without --apply or --remove", async () => {
    const r = await run([]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.calls, []);
    assert.match(r.out, /nem ír semmit/);
    assert.match(r.out, /DEMO-AJ-001/);
  });

  it("refuses a write without --db-host, and names the host it would need", async () => {
    for (const mode of ["--apply", "--remove"]) {
      const r = await run([mode]);
      assert.equal(r.code, 1, mode);
      assert.deepEqual(r.calls, [], mode);
      assert.match(r.err, /meg kell adni a --db-host/, mode);
      assert.match(r.err, /db-stage\.internal/, mode);
    }
  });

  it("refuses a write without the stage signal, EVEN WHEN --db-host matches", async () => {
    for (const mode of ["--apply", "--remove"]) {
      for (const allowed of [undefined, "", "production", "STAGE", " stage"]) {
        const r = await run([mode, "--db-host", "db-stage.internal"], {
          allowed,
        });
        assert.equal(r.code, 1, `${mode} ${JSON.stringify(allowed)}`);
        assert.deepEqual(r.calls, [], `${mode} ${JSON.stringify(allowed)}`);
        assert.match(r.err, /DEMO_DATA_ALLOWED=stage/);
      }
    }
  });

  it("still prints the plan without the signal: the plan writes nothing", async () => {
    const r = await run([], { allowed: undefined });
    assert.equal(r.code, 0);
    assert.deepEqual(r.calls, []);
  });

  it("refuses a host that is not the DATABASE_URL's", async () => {
    for (const mode of ["--apply", "--remove"]) {
      const r = await run([mode, "--db-host", "db-prod.internal"]);
      assert.equal(r.code, 1, mode);
      assert.deepEqual(r.calls, [], mode);
      assert.match(r.err, /nem egyezik/, mode);
    }
  });

  it("refuses a write when the DATABASE_URL is missing or unreadable", async () => {
    for (const url of [undefined, "nem url"]) {
      const r = await run(["--apply", "--db-host", "x"], { url });
      assert.equal(r.code, 1);
      assert.deepEqual(r.calls, []);
    }
  });

  it("applies once the named host matches (case does not matter)", async () => {
    const r = await run(["--apply", "--db-host", "DB-STAGE.internal"], {
      counts: { customers: 3, quotes: 3, posSales: 4, incomingInvoices: 5 },
    });
    assert.equal(r.code, 0);
    assert.deepEqual(r.calls, ["apply"]);
    assert.match(r.out, /3 ügyfél, 3 ajánlat, 4 POS eladás, 5 bejövő számla/);
  });

  it("says so when everything was already there, and removes on --remove", async () => {
    const again = await run(["--apply", "--db-host", "db-stage.internal"]);
    assert.match(again.out, /Mind megvan már/);
    // a run that created only one kind of row still says it wrote
    for (const only of [
      { customers: 1 },
      { quotes: 1 },
      { posSales: 1 },
      { incomingInvoices: 1 },
    ]) {
      const partial = await run(["--apply", "--db-host", "db-stage.internal"], {
        counts: only,
      });
      assert.match(partial.out, /Létrehozva/, JSON.stringify(only));
    }
    const gone = await run(["--remove", "--db-host", "db-stage.internal"], {
      counts: { customers: 3, quotes: 3, posSales: 4, incomingInvoices: 5 },
    });
    assert.deepEqual(gone.calls, ["remove"]);
    assert.match(gone.out, /Törölve: 3 ügyfél/);
  });

  it("refuses --apply with --remove, and an unknown argument", async () => {
    const both = await run([
      "--apply",
      "--remove",
      "--db-host",
      "db-stage.internal",
    ]);
    assert.equal(both.code, 1);
    assert.deepEqual(both.calls, []);
    const typo = await run(["--aply", "--db-host", "db-stage.internal"]);
    assert.equal(typo.code, 1);
    assert.deepEqual(typo.calls, []);
  });
});

describe("the stage signal in the environment templates", () => {
  const value = (file: string) =>
    template(file).match(/^DEMO_DATA_ALLOWED=(.*)$/m)?.[1];

  it("is empty in the development and the production template, and `stage` only in the staging one", () => {
    assert.equal(value(".env.example"), "");
    assert.equal(value(".env.production.example"), "");
    assert.equal(value(".env.staging.example"), "stage");
  });
});
