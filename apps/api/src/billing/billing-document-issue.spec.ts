import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { buildIssueInput, vatRateText } from "./billing-document-issue.js";
import type { BillingDocumentRow } from "./billing-documents.repository.js";

const d = (value: string) => new Prisma.Decimal(value);

type Line = BillingDocumentRow["lines"][number];

function line(overrides: Partial<Record<keyof Line, unknown>>): Line {
  return {
    id: "line-1",
    invoiceId: "doc-1",
    position: 0,
    kind: "ITEM",
    parentLineId: null,
    productId: null,
    description: "Tropic Marin Pro-Reef 25 kg",
    quantity: d("1.500000"),
    unit: "db",
    unitNet: d("1566.9300"),
    vatRatePercent: d("27.00"),
    discountPercent: null,
    // the draft's own 4-decimal value: 1.5 × 1566.93 = 2350.395
    netAmount: d("2350.3950"),
    vatAmount: d("634.6067"),
    grossAmount: d("2985.0017"),
    comment: "A második zsák sérült",
    ...overrides,
  } as unknown as Line;
}

function row(
  overrides: Partial<Record<keyof BillingDocumentRow, unknown>> = {},
) {
  return {
    id: "doc-1",
    status: "DRAFT",
    documentType: "INVOICE",
    invoiceFormat: "ELECTRONIC",
    fulfillmentDate: new Date("2026-09-30T00:00:00Z"),
    dueDate: new Date("2026-10-08T00:00:00Z"),
    paymentMethod: "Átutalás",
    currency: "HUF",
    language: "hu",
    reference: "PROJ-0268",
    note: "Projekt szerint",
    customer: {
      id: "cust-1",
      customerNumber: "C-1",
      displayName: "Állatkert",
      companyName: "Kitalált Állatkert Kft.",
      taxNumber: "12345678-2-42",
      email: "szamla@example.com",
      addresses: [
        {
          type: "SHIPPING",
          isDefault: true,
          country: "HU",
          postalCode: "9999",
          city: "Szállításváros",
          line1: "Raktár út 1.",
          line2: null,
        },
        {
          type: "BILLING",
          isDefault: false,
          country: "HU",
          postalCode: "1146",
          city: "Budapest",
          line1: "Állatkerti körút 6-12.",
          line2: null,
        },
      ],
    },
    lines: [line({})],
    mailDeliveries: [],
    ...overrides,
  } as unknown as BillingDocumentRow;
}

describe("buildIssueInput", () => {
  // acrobot 25171: the test that catches sending the stored 4 decimals
  it("sends the amounts computed by the measured rule, not the draft's stored 4 decimals", () => {
    const input = buildIssueInput(row());
    assert.ok(input.ok);
    assert.deepEqual(input.lines, [
      {
        lineId: "line-1",
        netAmount: "2350.40",
        vatAmount: "634.61",
        grossAmount: "2985.01",
      },
    ]);
    const [sent] = input.document.lines;
    assert.deepEqual(
      [sent!.netAmount, sent!.vatAmount, sent!.grossAmount],
      [2350.4, 634.61, 2985.01],
    );
    // and the totals as Számlázz.hu prints them (per line, from the gross)
    assert.deepEqual(input.totals, {
      netAmount: "2350",
      vatAmount: "635",
      grossAmount: "2985",
    });
  });

  it("sends a discount line as one negative unit right under its item, with the item's VAT rate", () => {
    const input = buildIssueInput(
      row({
        lines: [
          line({ discountPercent: d("10.00") }),
          line({
            id: "line-2",
            position: 1,
            kind: "DISCOUNT",
            parentLineId: "line-1",
            description: "Kedvezmény (10%)",
            quantity: d("1.000000"),
            unitNet: d("-235.0395"),
            netAmount: d("-235.0395"),
            vatAmount: d("-63.4607"),
            grossAmount: d("-298.5002"),
            comment: null,
          }),
        ],
      }),
    );
    assert.ok(input.ok);
    const [, discount] = input.document.lines;
    assert.deepEqual(
      [
        discount!.kind,
        discount!.parentPosition,
        discount!.quantity,
        discount!.unitNet,
        discount!.netAmount,
        discount!.vatRate,
      ],
      ["DISCOUNT", 0, 1, -235.04, -235.04, "27"],
    );
  });

  it("snapshots the buyer from the billing address, not the default shipping one", () => {
    const input = buildIssueInput(row());
    assert.ok(input.ok);
    assert.deepEqual(input.buyer, {
      name: "Kitalált Állatkert Kft.",
      country: "HU",
      zip: "1146",
      city: "Budapest",
      address: "Állatkerti körút 6-12.",
      taxNumber: "12345678-2-42",
      euTaxNumber: null,
      email: "szamla@example.com",
    });
    assert.equal(input.document.buyer.zip, "1146");
  });

  it("keeps every line comment and the document's own fields", () => {
    const input = buildIssueInput(row());
    assert.ok(input.ok);
    assert.equal(input.document.lines[0]!.comment, "A második zsák sérült");
    assert.deepEqual(
      [
        input.document.id,
        input.document.fulfillmentDate,
        input.document.reference,
        input.document.note,
      ],
      ["doc-1", "2026-09-30", "PROJ-0268", "Projekt szerint"],
    );
  });

  it("names a line that becomes 0 Ft", () => {
    const input = buildIssueInput(
      row({
        lines: [
          line({
            quantity: d("1"),
            unitNet: d("0.2000"),
            netAmount: d("0.2000"),
          }),
        ],
      }),
    );
    assert.ok(input.ok);
    assert.deepEqual(input.zeroForintLineIds, ["line-1"]);
  });

  it("refuses what Számlázz.hu cannot take, before any call", () => {
    const code = (value: BillingDocumentRow) => {
      const input = buildIssueInput(value);
      return input.ok ? "OK" : input.code;
    };
    assert.equal(code(row({ customer: null })), "BILLING_ISSUE_NO_CUSTOMER");
    assert.equal(
      code(
        row({
          customer: { ...row().customer!, addresses: [] },
        }),
      ),
      "BILLING_ISSUE_NO_ADDRESS",
    );
    assert.equal(code(row({ lines: [] })), "BILLING_ISSUE_NO_LINES");
    assert.equal(
      code(row({ fulfillmentDate: null })),
      "BILLING_ISSUE_NO_FULFILLMENT_DATE",
    );
  });
});

describe("vatRateText", () => {
  it("writes the rate as Számlázz.hu's afakulcs", () => {
    assert.equal(vatRateText("27.00"), "27");
    assert.equal(vatRateText("5.50"), "5.5");
    assert.equal(vatRateText("0.00"), "0");
    assert.equal(vatRateText("18"), "18");
  });
});
