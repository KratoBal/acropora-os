import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { mergeSameInvoice } from "../missing-invoices/missing-invoices.repository.js";
import type { CandidateDocument } from "../missing-invoices/missing-invoice-matching.js";
import {
  candidateDuplicates,
  incomingDuplicates,
  incomingTypoSuspects,
  outgoingDuplicates,
  planExternalMerges,
  type ExternalMergeRow,
} from "./billing-duplicates.js";
import {
  szamlazzFieldsOf,
  takeOverEbizRow,
} from "./external-billing-one-row.js";

const external = (over: Partial<ExternalMergeRow>): ExternalMergeRow => ({
  id: "x",
  source: "SZAMLAZZ",
  externalId: "1",
  documentNumber: "EINV000000812",
  issueDate: new Date("2026-10-01T00:00:00Z"),
  currency: "HUF",
  grossAmount: new Prisma.Decimal("12700"),
  pdfStorageKey: null,
  ebizExternalId: null,
  ...over,
});

describe("one invoice, one row: the duplicate rules", () => {
  it("outgoing: one number from two sources is a duplicate, in either order", () => {
    const s = external({
      id: "s",
      source: "SZAMLAZZ",
      externalId: "938856736",
    });
    const e = external({ id: "e", source: "EBIZ", externalId: "6121422" });
    const other = external({ id: "o", documentNumber: "EINV000000999" });
    for (const rows of [
      [s, e, other],
      [e, s, other],
    ])
      assert.deepEqual(
        outgoingDuplicates(rows).map((g) => [
          g.key,
          g.rows.map((r) => r.id).sort(),
        ]),
        [["EINV000000812", ["e", "s"]]],
      );
    // case and spacing do not make another invoice
    assert.equal(
      outgoingDuplicates([s, { ...e, documentNumber: " einv000000812" }])
        .length,
      1,
    );
    assert.deepEqual(outgoingDuplicates([s, other]), []);
  });

  it("incoming: the same number is one invoice only for the same supplier tax base", () => {
    const row = (
      id: string,
      supplierTaxNumber: string | null,
      supplierName = "Teszt Kft.",
    ) => ({ id, documentNumber: "A-1", supplierTaxNumber, supplierName });
    assert.deepEqual(
      incomingDuplicates([
        row("a", "12345678-2-41"),
        row("b", "12345678-1-42"),
        row("c", "87654321-2-41"),
      ]).map((g) => g.rows.map((r) => r.id)),
      [["a", "b"]],
    );
    // without a tax number the supplier's name is the identity
    assert.equal(
      incomingDuplicates([row("a", null), row("b", null, "Másik Bt.")]).length,
      0,
    );
  });

  it("incoming calculation: a NAV row and its Számlázz.hu copy are one candidate, in either order", () => {
    const candidate = (
      id: string,
      source: CandidateDocument["source"],
      hasOriginal: boolean,
    ): CandidateDocument => ({
      id,
      source,
      number: "A-1",
      date: "2026-09-10",
      gross: new Prisma.Decimal("1270"),
      currency: "HUF",
      supplierName: "Teszt Kft.",
      supplierAccounts: [],
      kind: "INVOICE",
      payee: "COMPANY",
      hasOriginal,
    });
    const nav = candidate("nav", "NAV", false);
    const feed = candidate("feed", "SZAMLAZZ", true);
    const keys = new Map([
      ["nav", "a-1|12345678"],
      ["feed", "a-1|12345678"],
    ]);
    for (const order of [
      [nav, feed],
      [feed, nav],
    ]) {
      const merged = mergeSameInvoice(order, keys);
      assert.equal(merged.length, 1);
      assert.equal(merged[0]!.id, "nav");
      assert.equal(merged[0]!.originalId, "feed");
      assert.deepEqual(candidateDuplicates(merged), []);
    }
    // the control: had the merge not happened, the check names the pair
    const unmerged = [nav, feed].map((d) => ({
      ...d,
      identities: ["inv:a-1|12345678"],
    }));
    assert.deepEqual(
      candidateDuplicates(unmerged).map((g) => g.rows.map((r) => r.id)),
      [["nav", "feed"]],
    );
  });

  it("the merge plan takes only one Számlázz.hu and one eBIZ row that agree", () => {
    const s = external({
      id: "s",
      source: "SZAMLAZZ",
      externalId: "938856736",
    });
    const e = external({
      id: "e",
      source: "EBIZ",
      externalId: "6121422",
      pdfStorageKey: "external-invoice/e/ebiz.pdf",
    });
    assert.deepEqual(
      planExternalMerges([e, s]).map((p) => [
        p.kind,
        p.kind === "MERGE" ? [p.szamlazz.id, p.ebiz.id] : null,
      ]),
      [["MERGE", ["s", "e"]]],
    );
    assert.deepEqual(
      planExternalMerges([
        s,
        { ...e, grossAmount: new Prisma.Decimal("12701") },
      ]).map((p) => [p.kind, p.kind === "DIFFERS" ? p.reason : null]),
      [["DIFFERS", "eltér: bruttó"]],
    );
    assert.deepEqual(
      planExternalMerges([s, { ...s, id: "s2", externalId: "2" }]).map(
        (p) => p.kind,
      ),
      ["OTHER"],
    );
  });

  it("the takeover keeps the eBIZ row's PDF and records its id, and drops eBIZ's payment status", () => {
    const fields = szamlazzFieldsOf({
      id: "s",
      source: "SZAMLAZZ",
      externalId: "938856736",
      createdAt: new Date(),
      updatedAt: new Date(),
      pdfStorageKey: null,
      pdfMissingReason: null,
      ebizExternalId: null,
      externalPaymentStatus: null,
      documentNumber: "EINV000000812",
      paidAmount: "12700.00",
    });
    assert.deepEqual(takeOverEbizRow({ externalId: "6121422" }, fields), {
      externalId: "938856736",
      documentNumber: "EINV000000812",
      paidAmount: "12700.00",
      source: "SZAMLAZZ",
      ebizExternalId: "6121422",
      externalPaymentStatus: null,
    });
  });
});

describe("incomingTypoSuspects (2408d6ad)", () => {
  const row = (
    source: string,
    documentNumber: string,
    over: Partial<{
      supplierTaxNumber: string | null;
      issueDate: Date;
      gross: string;
    }> = {},
  ) => ({
    source,
    documentNumber,
    supplierTaxNumber:
      over.supplierTaxNumber === undefined
        ? "12345678-2-42"
        : over.supplierTaxNumber,
    supplierName: "Kitalált Kft.",
    issueDate: over.issueDate ?? new Date("2026-10-01T00:00:00Z"),
    currency: "HUF",
    grossAmount: new Prisma.Decimal(over.gross ?? "12700"),
  });

  it("TYPO-SUSPECT: a purchase row and a feed row one or two characters apart, same supplier, day and gross", () => {
    const pairs = (rows: ReturnType<typeof row>[]) =>
      incomingTypoSuspects(rows).map((group) =>
        group.rows.map((r) => r.documentNumber).join("~"),
      );
    assert.deepEqual(
      [
        pairs([row("PURCHASE", "KIT-0123"), row("SZAMLAZZ", "KIT-0132")]),
        pairs([row("PURCHASE", "KIT 0123"), row("MAILBOX", "KIT-012")]),
        // the same number is the key's job, not a suspicion
        pairs([row("PURCHASE", "KIT-0123"), row("SZAMLAZZ", "kit-0123")]),
        // three characters apart
        pairs([row("PURCHASE", "KIT-0123"), row("SZAMLAZZ", "KIT-0456")]),
        // another gross, another day, another supplier
        pairs([
          row("PURCHASE", "KIT-0123"),
          row("SZAMLAZZ", "KIT-0124", { gross: "12701" }),
        ]),
        pairs([
          row("PURCHASE", "KIT-0123"),
          row("SZAMLAZZ", "KIT-0124", {
            issueDate: new Date("2026-10-02T00:00:00Z"),
          }),
        ]),
        pairs([
          row("PURCHASE", "KIT-0123"),
          row("SZAMLAZZ", "KIT-0124", { supplierTaxNumber: "87654321-2-42" }),
        ]),
        // two rows of other sources: not a recording by hand
        pairs([row("SZAMLAZZ", "KIT-0123"), row("MAILBOX", "KIT-0124")]),
      ],
      [["KIT-0123~KIT-0132"], ["KIT 0123~KIT-012"], [], [], [], [], [], []],
      "TYPO-SUSPECT",
    );
  });
});
