import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PartnerDuplicateReportService,
  type CustomerReferenceCounts,
  type PartnerDuplicateRepository,
} from "./partner-duplicate-report.service.js";
import type { CustomerRow, SupplierRow } from "./partner-duplicate-groups.js";
import { partnerDuplicateReportEnabled } from "./partner-duplicate-report.scheduler.js";

/*
  WHAT TURNS THIS RED (egy partnertörzs, 1. lépés). A lista hivatkozás-szám nélkül (az összevonásnál nem látszana, melyik
  sor viszi a történetet); a naplósor és a lista más számokat mondana; a mérés ÍRNA az adatbázist; egy hibás futás leállítaná
  az API-t (a hiba tovább dobódik a naplózásból); a kapcsoló nem pontosan a "false" értékre kapcsol ki.
*/
const row = (id: string, taxNumber: string): CustomerRow => ({
  id,
  customerNumber: `VEVO-${id}`,
  displayName: `Név ${id}`,
  companyName: null,
  type: "COMPANY",
  taxNumber,
  euTaxNumber: null,
  partnerMirror: false,
  fromUnas: false,
});

function service(
  over: Partial<Record<keyof PartnerDuplicateRepository, unknown>> = {},
) {
  const calls: string[] = [];
  const counts = new Map<string, CustomerReferenceCounts>([
    [
      "a",
      {
        invoices: 7,
        salesOrders: 2,
        contracts: 0,
        worksheets: 0,
        quotes: 1,
        serviceJobs: 0,
      },
    ],
    [
      "b",
      {
        invoices: 0,
        salesOrders: 0,
        contracts: 1,
        worksheets: 4,
        quotes: 0,
        serviceJobs: 2,
      },
    ],
  ]);
  const repository = {
    customers: async () => {
      calls.push("customers");
      return [
        row("a", "12345678-1-42"),
        row("b", "HU12345678142"),
        row("c", "87654321-2-13"),
      ];
    },
    suppliers: async () => {
      calls.push("suppliers");
      return [] as SupplierRow[];
    },
    referenceCounts: async (ids: readonly string[]) => {
      calls.push(`counts:${[...ids].sort().join(",")}`);
      return counts;
    },
    ...over,
  } as unknown as PartnerDuplicateRepository;
  return { service: new PartnerDuplicateReportService(repository), calls };
}

describe("PartnerDuplicateReportService", () => {
  it("gives the groups with the reference counts of the rows in them, and only those rows", async () => {
    const { service: svc, calls } = service();
    const result = await svc.build();
    assert.equal(result.strong.length, 1);
    assert.deepEqual(
      result.strong[0]!.customers.map((c) => [
        c.id,
        c.references.invoices,
        c.references.worksheets,
      ]),
      [
        ["a", 7, 0],
        ["b", 0, 4],
      ],
    );
    // the counts were asked for the two rows of the group, not for the whole register
    assert.ok(calls.includes("counts:a,b"));
  });

  it("the log line and the list say the same numbers", async () => {
    const { service: svc } = service();
    const result = await svc.build();
    assert.match(result.summary, /eros_csoport=1 eros_sor=2/);
    assert.equal(result.strong.length, 1);
  });

  it("only reads: the repository has no write method to call", async () => {
    const { service: svc, calls } = service();
    await svc.build();
    for (const call of calls)
      assert.match(call, /^(customers|suppliers|counts:)/);
  });

  it("a failing read is a log line, never an error that reaches the caller", async () => {
    const { service: svc } = service({
      customers: async () => {
        throw new TypeError("secret details");
      },
    });
    const line = await svc.logOnce();
    assert.equal(line, "PARTNER-DUPLIKATUM hiba=TypeError");
    assert.equal(line.includes("secret details"), false);
  });

  it("the switch turns off only for exactly false, and is on otherwise", () => {
    assert.equal(partnerDuplicateReportEnabled({}), true);
    assert.equal(
      partnerDuplicateReportEnabled({
        PARTNER_DUPLICATE_REPORT_ENABLED: "true",
      }),
      true,
    );
    assert.equal(
      partnerDuplicateReportEnabled({ PARTNER_DUPLICATE_REPORT_ENABLED: "0" }),
      true,
    );
    assert.equal(
      partnerDuplicateReportEnabled({
        PARTNER_DUPLICATE_REPORT_ENABLED: "false",
      }),
      false,
    );
  });
});
