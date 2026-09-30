import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { listWhere, toListItem } from "./billing-document-list.js";
import type { BillingDocumentListRow } from "./billing-document-list.repository.js";

const D = (value: string) => new Prisma.Decimal(value);

const line = (unitNet: string, quantity = "1", vatRatePercent = "27") => ({
  kind: "ITEM" as const,
  quantity: D(quantity),
  unitNet: D(unitNet),
  netAmount: D(unitNet).mul(quantity),
  vatRatePercent: D(vatRatePercent),
});

function row(
  overrides: Partial<BillingDocumentListRow> = {},
): BillingDocumentListRow {
  return {
    id: "doc-1",
    documentType: "INVOICE",
    invoiceFormat: "ELECTRONIC",
    invoiceNumber: null,
    partnerName: "Régi Név Kft.",
    issueDate: null,
    dueDate: new Date("2026-10-08T00:00:00.000Z"),
    grossAmount: D("2985.0017"),
    currency: "HUF",
    status: "DRAFT",
    emailStatus: "PENDING",
    customer: { companyName: "Új Név Kft.", displayName: "Új Név" },
    lines: [line("1566.93", "1.5")],
    ...overrides,
  } as BillingDocumentListRow;
}

describe("toListItem", () => {
  it("shows a draft's gross as the invoice will print it, not its stored total", () => {
    // Three lines of 0.40 net at 27%: each line's gross (0.51) rounds to 1 Ft
    // on Számlázz.hu, so the invoice says 3. The stored 4-decimal total is
    // 1.524, which would round to 2: the rival rule this pins out.
    const item = toListItem(
      row({
        grossAmount: D("1.5240"),
        lines: [line("0.40"), line("0.40"), line("0.40")],
      }),
    );
    assert.equal(item.grossAmount, "3");
  });

  it("shows an issued document's stored Számlázz.hu total in whole forints", () => {
    const item = toListItem(
      row({
        status: "ISSUED",
        invoiceNumber: "E-ACR-2026-1",
        grossAmount: D("2985.0000"),
        lines: [line("9999")],
      }),
    );
    assert.equal(item.grossAmount, "2985");
  });

  it("keeps two decimals outside HUF", () => {
    const item = toListItem(
      row({ currency: "EUR", grossAmount: D("12.3456"), lines: [line("10")] }),
    );
    assert.equal(item.grossAmount, "12.70");
  });

  it("names the buyer from the issue snapshot once issued, and today's partner before", () => {
    assert.equal(toListItem(row()).customerName, "Új Név Kft.");
    assert.equal(
      toListItem(row({ status: "ISSUED" })).customerName,
      "Régi Név Kft.",
    );
  });

  it("dates the issue by the Budapest calendar day, not the UTC one", () => {
    // 22:30 UTC on 30 September is 00:30 on 1 October in Budapest (CEST).
    const item = toListItem(
      row({
        status: "ISSUED",
        issueDate: new Date("2026-09-30T22:30:00.000Z"),
      }),
    );
    assert.equal(item.issueDate, "2026-10-01");
    assert.equal(item.dueDate, "2026-10-08");
  });

  it("opens only a draft in the editor", () => {
    assert.deepEqual(
      (["DRAFT", "ISSUING", "ISSUED", "ISSUE_FAILED"] as const).map(
        (status) => toListItem(row({ status })).opens,
      ),
      ["EDITOR", "DETAIL", "DETAIL", "DETAIL"],
    );
  });
});

describe("listWhere", () => {
  it("always keeps the detail's own-rows scope, with or without filters", () => {
    for (const where of [
      listWhere({}),
      listWhere({ q: "x", status: "ISSUED", documentType: "PROFORMA" }),
    ]) {
      assert.equal(where.direction, "OUTBOUND");
      assert.equal(where.source, "SZAMLAZZ");
      assert.deepEqual(where.sourceType, { not: null });
      assert.equal(where.completionCertificateId, null);
    }
  });

  it("matches the stored buyer name only on issued rows", () => {
    // A draft's partnerName is the name at its last save, which the list no
    // longer shows; searching it would bring up a draft under a stale name.
    const clauses = listWhere({ q: "Régi" }).OR ?? [];
    const onName = clauses.filter((clause) => "partnerName" in clause);
    assert.deepEqual(
      onName.map((clause) => clause.status),
      ["ISSUED"],
    );
  });

  it("searches nothing for a blank q", () => {
    assert.equal(listWhere({ q: "   " }).OR, undefined);
  });
});
