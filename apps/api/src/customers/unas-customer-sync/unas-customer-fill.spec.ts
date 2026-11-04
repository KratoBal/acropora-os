import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnasApiCustomer, UnasApiCustomerAddress } from "@acropora/types";

import { parseUnasCustomerResponse } from "../../imports/unas/unas-api.client.js";
import {
  emptyBackfillCounts,
  fillIfEmpty,
  mergedFrom,
  unasCustomerFill,
  unasTaxBackfillBucket,
  unasTaxBackfillLine,
} from "./unas-customer-fill.js";
import { UnasCustomerSyncScheduler } from "./unas-customer-sync.scheduler.js";

/*
  WHAT TURNS THIS RED (Balázs 2026-11-04 19:07 UTC, acrobot 42670: the UNAS tax number did not reach the OS row). A
  company's UNAS tax number, EU tax number or name that does not reach an empty row; a filled row overwritten; a
  private person's number taken; a foreign-shaped value in the Hungarian field; the EUTaxNumber not parsed; a merged
  reference (murena 42674) not seen; a backfill line with another head or a name in it; a second backfill in one process.
*/
const address = (
  over: Partial<UnasApiCustomerAddress> = {},
): UnasApiCustomerAddress => ({
  name: "Fővárosi Állat- és Növénykert",
  zip: "1146",
  city: "Budapest",
  street: "Állatkerti krt. 6-12.",
  country: "Magyarország",
  countryCode: "HU",
  taxNumber: "15490658242",
  euTaxNumber: " hu 15490658 ",
  customerType: "company",
  ...over,
});
const customer = (
  invoiceAddress: UnasApiCustomerAddress | null = address(),
): UnasApiCustomer => ({
  externalId: "101",
  email: null,
  contactName: null,
  contactPhone: null,
  contactMobile: null,
  invoiceAddress,
  shippingAddress: null,
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
});
const empty = { taxNumber: null, euTaxNumber: null, companyName: null };

describe("what a UNAS customer fills", () => {
  it("a company: the Hungarian number dotted, the EU number compact, the name", () => {
    assert.deepEqual(unasCustomerFill(customer()), {
      taxNumber: "15490658-2-42",
      euTaxNumber: "HU15490658",
      companyName: "Fővárosi Állat- és Növénykert",
    });
  });

  it("a private person, a person without a tax number, or no invoice address: nothing", () => {
    for (const customerType of [
      "private",
      "other_customer_without_tax_number",
      null,
    ] as const)
      assert.deepEqual(
        unasCustomerFill(customer(address({ customerType }))),
        empty,
        String(customerType),
      );
    assert.deepEqual(unasCustomerFill(customer(null)), empty);
  });

  it("a foreign-shaped value does not go into the Hungarian field", () => {
    assert.equal(
      unasCustomerFill(customer(address({ taxNumber: "DE123456789" })))
        .taxNumber,
      null,
    );
  });

  it("writes only the empty fields, and a blank counts as empty", () => {
    const fill = unasCustomerFill(customer());
    assert.deepEqual(fillIfEmpty(empty, fill), fill);
    assert.deepEqual(
      fillIfEmpty(
        { taxNumber: "11111111-1-11", euTaxNumber: "  ", companyName: "Kézi" },
        fill,
      ),
      { euTaxNumber: "HU15490658" },
    );
    assert.deepEqual(fillIfEmpty(empty, empty), {});
  });
});

describe("a reference moved by a partner merge", () => {
  it("is marked by a non-blank mergedFrom, with or without the hash", () => {
    assert.equal(mergedFrom({ mergedFrom: "c-1" }), "c-1");
    assert.equal(mergedFrom({ hash: "x", mergedFrom: "c-1" }), "c-1");
    for (const metadata of [
      null,
      { hash: "x" },
      { mergedFrom: " " },
      { mergedFrom: 1 },
      ["mergedFrom"],
    ])
      assert.equal(mergedFrom(metadata), null, JSON.stringify(metadata));
  });
});

describe("the backfill buckets and its log line", () => {
  it("every customer in one bucket, by the tax numbers", () => {
    const company = customer();
    const fill = unasCustomerFill(company);
    assert.equal(
      unasTaxBackfillBucket(company, fill, { taxNumber: "x" }),
      "filled",
    );
    assert.equal(
      unasTaxBackfillBucket(company, fill, { companyName: "x" }),
      "alreadyHad",
    );
    const none = customer(address({ taxNumber: null, euTaxNumber: null }));
    assert.equal(
      unasTaxBackfillBucket(none, unasCustomerFill(none), {}),
      "missingInUnas",
    );
    const foreign = customer(
      address({ taxNumber: "DE123456789", euTaxNumber: null }),
    );
    assert.equal(
      unasTaxBackfillBucket(foreign, unasCustomerFill(foreign), {}),
      "notHungarianShape",
    );
    const person = customer(address({ customerType: "private" }));
    assert.equal(
      unasTaxBackfillBucket(person, unasCustomerFill(person), {}),
      "person",
    );
  });

  it("one line with counts only, the same head on every outcome", () => {
    const counts = {
      ...emptyBackfillCounts(),
      customers: 430,
      filled: 12,
      alreadyHad: 3,
      missingInUnas: 400,
      person: 15,
      companyNameFilled: 9,
    };
    assert.equal(
      unasTaxBackfillLine({ ok: true, counts }),
      "UNAS-VEVO-ADOSZAM-VISSZATOLTES unas_vevo=430 kitoltve=12 mar_volt=3 unasban_sincs=400 nem_magyar_alak=0 maganszemely=15 nincs_os_sor=0 osszevont=0 cegnev_kitoltve=9",
    );
    assert.equal(
      unasTaxBackfillLine({ ok: true, alreadyRan: true }),
      "UNAS-VEVO-ADOSZAM-VISSZATOLTES mar_lefutott",
    );
    assert.equal(
      unasTaxBackfillLine({ ok: false, reason: "API_REJECTED" }),
      "UNAS-VEVO-ADOSZAM-VISSZATOLTES HIBA ok=API_REJECTED",
    );
  });
});

describe("the UNAS customer answer", () => {
  it("carries the invoice address's EUTaxNumber", () => {
    const [parsed] = parseUnasCustomerResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Customers><Customer><Id>101</Id><Addresses><Invoice><Name>Reef GmbH</Name><TaxNumber>DE123456789</TaxNumber><EUTaxNumber>DE123456789</EUTaxNumber><CustomerType>company</CustomerType></Invoice></Addresses></Customer></Customers>`,
    );
    assert.equal(parsed!.invoiceAddress!.euTaxNumber, "DE123456789");
    assert.equal(parsed!.invoiceAddress!.taxNumber, "DE123456789");
  });
});

describe("the backfill in the scheduler", () => {
  it("runs once per process, and a failure is a line, not a throw", async () => {
    let runs = 0;
    const scheduler = new UnasCustomerSyncScheduler(
      {} as never,
      {
        runTaxBackfill: async () => {
          runs += 1;
          throw new TypeError("a customer's name");
        },
      } as never,
    );
    assert.equal(
      await scheduler.backfillOnce("t"),
      "UNAS-VEVO-ADOSZAM-VISSZATOLTES HIBA ok=TypeError",
    );
    assert.equal(await scheduler.backfillOnce("t"), null);
    assert.equal(runs, 1);
  });

  it("an earlier run is a line too", async () => {
    const scheduler = new UnasCustomerSyncScheduler(
      {} as never,
      { runTaxBackfill: async () => null } as never,
    );
    assert.equal(
      await scheduler.backfillOnce("t"),
      "UNAS-VEVO-ADOSZAM-VISSZATOLTES mar_lefutott",
    );
  });
});
