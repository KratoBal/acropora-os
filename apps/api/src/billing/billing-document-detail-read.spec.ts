import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type { BillingDocumentRow } from "./billing-documents.repository.js";
import { toBillingDocumentDetail } from "./billing-documents.service.js";

const D = (value: string) => new Prisma.Decimal(value);

function line(id: string, unitNet: string, vatRatePercent = "27") {
  const net = D(unitNet);
  const vat = net.mul(vatRatePercent).div(100);
  return {
    id,
    kind: "ITEM",
    parentLineId: null,
    productId: null,
    description: `Tétel ${id}`,
    quantity: D("1"),
    unit: "db",
    unitNet: net,
    vatRatePercent: D(vatRatePercent),
    discountPercent: null,
    netAmount: net,
    vatAmount: vat,
    grossAmount: net.plus(vat),
    comment: null,
  };
}

function row(overrides: Record<string, unknown> = {}): BillingDocumentRow {
  return {
    id: "doc-1",
    status: "DRAFT",
    emailStatus: "PENDING",
    invoiceNumber: null,
    documentType: "INVOICE",
    invoiceFormat: "ELECTRONIC",
    customer: {
      id: "cust-1",
      customerNumber: "P-001",
      displayName: "Új Név",
      companyName: "Új Név Kft.",
      taxNumber: "11111111-2-42",
      email: "uj@example.invalid",
      addresses: [],
    },
    fulfillmentDate: null,
    issueDate: null,
    dueDate: null,
    paymentMethod: null,
    currency: "HUF",
    language: "hu",
    reference: null,
    note: null,
    sourceType: "MANUAL",
    sourceId: null,
    netAmount: D("1.2000"),
    vatAmount: D("0.3240"),
    grossAmount: D("1.5240"),
    issueAttemptCount: 0,
    syncError: null,
    pdfStorageKey: null,
    externalUrl: null,
    buyerSnapshot: null,
    lines: [line("a", "0.40"), line("b", "0.40"), line("c", "0.40")],
    mailDeliveries: [],
    createdAt: new Date("2026-09-30T10:00:00Z"),
    updatedAt: new Date("2026-09-30T10:00:00Z"),
    ...overrides,
  } as unknown as BillingDocumentRow;
}

const ISSUED = {
  status: "ISSUED",
  invoiceNumber: "E-ACR-2026-7",
  issueDate: new Date("2026-09-30T22:30:00.000Z"),
  netAmount: D("2350"),
  vatAmount: D("635"),
  grossAmount: D("2985"),
  pdfStorageKey: "invoice/doc-1/billing-document.pdf",
  externalUrl: "https://www.szamlazz.hu/szamla/?page=vevoifiok&azon=abc",
  issueAttemptCount: 1,
  // a régi, sikertelen kísérlet nyoma: kiállított soron nem mutatjuk
  syncError: "régi hiba",
  buyerSnapshot: {
    name: "Régi Név Kft.",
    country: "HU",
    zip: "1146",
    city: "Budapest",
    address: "Állatkerti krt. 6-12.",
    taxNumber: "22222222-2-42",
    euTaxNumber: null,
    email: "regi@example.invalid",
  },
};

describe("a részletek bővítése", () => {
  it("shows a draft's totals as Számlázz.hu will print them, per rate too", () => {
    // Three 0.40 lines: each gross (0.51) rounds to 1 Ft, so 3, not the
    // stored 1.524 rounded to 2.
    const detail = toBillingDocumentDetail(row());
    assert.equal(detail.totals.grossAmount, "3");
    assert.deepEqual(
      detail.totals.byVatRate.map((rate) => [
        rate.vatRatePercent,
        rate.grossAmount,
      ]),
      [["27.00", "3"]],
    );
    assert.equal(detail.customerSource, "DRAFT_PARTNER");
    assert.equal(detail.customer?.name, "Új Név Kft.");
  });

  it("names the lines that round to 0 Ft", () => {
    // 0.20 net at 27% is 0.25 gross on the line, 0 Ft on the invoice.
    const detail = toBillingDocumentDetail(
      row({ lines: [line("a", "1000"), line("zero", "0.20")] }),
    );
    assert.deepEqual(detail.totals.zeroForintLineIds, ["zero"]);
  });

  it("shows an issued document's buyer from the snapshot, not the partner today", () => {
    const detail = toBillingDocumentDetail(row(ISSUED));
    assert.equal(detail.customerSource, "ISSUED_SNAPSHOT");
    assert.deepEqual(
      [
        detail.customer?.name,
        detail.customer?.taxNumber,
        detail.customer?.email,
      ],
      ["Régi Név Kft.", "22222222-2-42", "regi@example.invalid"],
    );
    assert.equal(
      detail.customer?.address,
      "1146 Budapest, Állatkerti krt. 6-12.",
    );
    assert.equal(detail.customer?.internalCode, "P-001");
  });

  it("takes an issued document's totals from Számlázz.hu's answer", () => {
    const detail = toBillingDocumentDetail(row(ISSUED));
    assert.deepEqual(
      [
        detail.totals.netAmount,
        detail.totals.vatAmount,
        detail.totals.grossAmount,
      ],
      ["2350", "635", "2985"],
    );
  });

  it("carries the issue trace, the Budapest issue day and the PDF", () => {
    const detail = toBillingDocumentDetail(row(ISSUED));
    assert.equal(detail.issueDate, "2026-10-01");
    assert.deepEqual(detail.szamlazz, {
      documentNumber: "E-ACR-2026-7",
      issueState: "ISSUED",
      externalId: "doc-1",
      issueAttemptCount: 1,
      lastError: null,
      documentUrl: "https://www.szamlazz.hu/szamla/?page=vevoifiok&azon=abc",
    });
    assert.deepEqual(detail.pdf, { available: true });
    assert.equal(detail.delivery?.canResend, true);
  });

  it("shows why an issue failed", () => {
    const detail = toBillingDocumentDetail(
      row({ status: "ISSUE_FAILED", syncError: "Hibás adószám" }),
    );
    assert.equal(detail.szamlazz?.lastError, "Hibás adószám");
    assert.deepEqual(detail.pdf, { available: false });
  });

  it("offers the send button only when there is something to send, and nothing is running", () => {
    const canResend = (overrides: Record<string, unknown>) =>
      toBillingDocumentDetail(row({ ...ISSUED, ...overrides })).delivery
        ?.canResend;
    assert.equal(canResend({}), true);
    assert.equal(canResend({ pdfStorageKey: null }), false);
    assert.equal(canResend({ emailStatus: "SENDING" }), false);
    assert.equal(
      canResend({ documentType: "DELIVERY_NOTE", invoiceFormat: null }),
      false,
    );
    assert.equal(canResend({ status: "DRAFT" }), false);
  });

  it("reads the last attempt, whatever shape the addresses were stored in", () => {
    const detail = toBillingDocumentDetail(
      row({
        ...ISSUED,
        mailDeliveries: [
          {
            recipients: {
              to: ["a@example.invalid"],
              cc: [{ email: "b@example.invalid", name: "B" }],
            },
            outcome: "valami más",
            error: "SMTP 451",
            createdAt: new Date("2026-09-30T12:00:00.000Z"),
          },
        ],
      }),
    );
    assert.deepEqual(detail.delivery?.lastAttempt, {
      recipients: {
        to: ["a@example.invalid"],
        cc: ["b@example.invalid"],
        bcc: [],
      },
      outcome: "INDETERMINATE",
      at: "2026-09-30T12:00:00.000Z",
      error: "SMTP 451",
    });
  });
});
