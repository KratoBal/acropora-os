import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import type { CandidateDocument } from "./missing-invoice-matching.js";
import type { MissingInvoiceJevService } from "./missing-invoice-jev.service.js";
import type { MissingInvoicesRepository } from "./missing-invoices.repository.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";
import type { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";

const READER = {} as unknown as SupplierInvoiceImportService;
const ACCOUNT = {
  id: "acc",
  accountNumber: "1170900220624460",
  currency: "HUF",
  name: "Fő",
};

function setup(enabled = true) {
  const debit = {
    id: "bt-1",
    bankAccountId: ACCOUNT.id,
    // a mert szoveg a NYERS osszeget latta ("99.7"), nem a megjelenitett "99.70"-et
    amount: new Prisma.Decimal("99.7"),
    currency: "EUR",
    bookingDate: new Date("2026-05-10T00:00:00Z"),
    counterpartyAccount: null,
    counterpartyName: "Valami Shop GmbH",
    narrative: "ORDER 7781",
    transactionType: "ÁTUTALÁS",
    comment: null,
    categoryOverride: null,
    paperOriginalAt: null,
  };
  const doc = (
    id: string,
    gross: string,
    supplierName: string,
    date: string,
  ): CandidateDocument => ({
    id,
    source: "NAV",
    number: `INV-${id}`,
    date,
    gross: new Prisma.Decimal(gross),
    currency: "EUR",
    supplierName,
    supplierAccounts: [],
    kind: "INVOICE",
    payee: "COMPANY",
    hasOriginal: true,
  });
  const documents = [
    doc("d-exact", "99.7", "Teljesen Más Ltd", "2026-05-03"),
    doc("d-close", "98.9", "Harmadik GmbH", "2026-05-01"),
  ];
  const matches = new Map<string, string[]>();
  const repository = {
    accounts: async () => [ACCOUNT],
    debits: async () => [debit],
    statementCoverage: async () => new Set([`${ACCOUNT.id}:2026-05`]),
    manualMatches: async () => new Map(matches),
    candidates: async () => documents,
    uncheckedMailboxContent: async () => [],
    setPayee: async () => undefined,
    pair: async (input: { bankTransactionId: string; documentId: string }) => {
      matches.set(input.bankTransactionId, [input.documentId]);
    },
  } as unknown as MissingInvoicesRepository;
  const seen: unknown[] = [];
  const resolved: unknown[] = [];
  const jev = {
    enabled: () => enabled,
    suggest: async (input: unknown) => {
      seen.push(input);
      return { enabled: true, documentId: "d-exact", confidence: 0.97 };
    },
    resolveOnPair: async (input: unknown) => void resolved.push(input),
  } as unknown as MissingInvoiceJevService;
  return {
    missing: new MissingInvoicesService(repository, READER, {}, jev),
    seen,
    resolved,
  };
}

describe("MissingInvoicesService.jevSuggestion", () => {
  it("a mert mezoket adja at: nyers osszeg, nyers partner es kozlemeny, a kivalasztott jeloltek", async () => {
    const { missing, seen } = setup();
    assert.deepEqual(await missing.jevSuggestion("bt-1"), {
      enabled: true,
      documentId: "d-exact",
      confidence: 0.97,
    });
    const input = seen[0] as {
      bankTransactionId: string;
      payment: Record<string, string>;
      candidates: CandidateDocument[];
      kinds: string[];
    };
    assert.equal(input.bankTransactionId, "bt-1");
    assert.deepEqual(input.payment, {
      date: "2026-05-10",
      amount: "99.7",
      currency: "EUR",
      original: "",
      partner: "Valami Shop GmbH",
      narrative: "ORDER 7781",
      type: "ÁTUTALÁS",
    });
    assert.deepEqual(input.kinds, ["NEV"]);
    assert.deepEqual(
      input.candidates.map((d) => d.id),
      ["d-close", "d-exact"],
    );
  });

  it("kikapcsolva nem szamol es nem kerdez", async () => {
    const { missing, seen } = setup(false);
    assert.deepEqual(await missing.jevSuggestion("bt-1"), {
      enabled: false,
      documentId: null,
      confidence: null,
    });
    assert.equal(seen.length, 0);
  });

  it("a kezi parositas feloldja a javaslatot, a dokumentum azonositojaval", async () => {
    const { missing, resolved } = setup();
    await missing.pair("bt-1", "d-exact", { id: "u1" } as AuthenticatedUser);
    assert.deepEqual(resolved, [
      { bankTransactionId: "bt-1", documentId: "d-exact" },
    ]);
  });
});
