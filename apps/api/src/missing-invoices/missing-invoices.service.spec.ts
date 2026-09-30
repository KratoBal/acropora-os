import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type { CandidateDocument } from "./missing-invoice-matching.js";
import type { MissingInvoicesRepository } from "./missing-invoices.repository.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";
import type { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";

const READER = {
  read: async () => {
    throw new Error("ismeretlen formátum");
  },
} as unknown as SupplierInvoiceImportService;

const D = (v: number | string) => new Prisma.Decimal(v);
const MAIN = {
  id: "acc-main",
  accountNumber: "1170900220624460",
  currency: "HUF",
  name: "Fő számla",
};
const CARD = {
  id: "acc-card",
  accountNumber: "1171400626009841",
  currency: "HUF",
  name: "Kártyás számla",
};

let n = 0;
const debit = (date: string, amount: number, name: string, overrides = {}) => ({
  id: `d${++n}`,
  bankAccountId: MAIN.id,
  amount: D(amount),
  currency: "HUF",
  bookingDate: new Date(`${date}T00:00:00Z`),
  counterpartyAccount: null,
  counterpartyName: name,
  narrative: "",
  transactionType: "ÁTUTALÁS",
  comment: null,
  categoryOverride: null,
  paperOriginalAt: null,
  ...overrides,
});

function service(input: {
  debits: ReturnType<typeof debit>[];
  documents?: CandidateDocument[];
  coverage: string[];
  mailbox?: { id: string; content: Uint8Array; fileName: string }[];
}) {
  const stored: [string, string][] = [];
  const repository = {
    accounts: async () => [MAIN, CARD],
    debits: async () => input.debits,
    statementCoverage: async () => new Set(input.coverage),
    manualMatches: async () => new Map(),
    candidates: async () => input.documents ?? [],
    uncheckedMailboxContent: async () => input.mailbox ?? [],
    setPayee: async (id: string, payee: string) =>
      void stored.push([id, payee]),
  } as unknown as MissingInvoicesRepository;
  return { missing: new MissingInvoicesService(repository, READER), stored };
}

const nav = (
  date: string,
  gross: number,
  supplierName: string,
): CandidateDocument => ({
  id: `c${++n}`,
  source: "NAV",
  number: `NAV-${n}`,
  date,
  gross: D(gross),
  currency: "HUF",
  supplierName,
  supplierAccounts: [],
  kind: "INVOICE",
  payee: "COMPANY",
  hasOriginal: true,
});

describe("MissingInvoicesService.months", () => {
  it("counts the tiles and the missing amount, and names the company from the one identity", async () => {
    const { missing } = service({
      debits: [
        debit("2026-08-03", 1000, "Szállító Kft."),
        debit("2026-08-04", 2500, "Senki Bt."),
        debit("2026-08-05", 800, "", {
          transactionType: "KÖLTSÉG ÉS JUTALÉK",
          counterpartyName: null,
        }),
      ],
      documents: [nav("2026-08-01", 1000, "Szállító Kft.")],
      coverage: [`${MAIN.id}:2026-08`, `${CARD.id}:2026-08`],
    });
    const result = await missing.months();
    assert.deepEqual(result.company, {
      name: "Acropora Kft.",
      taxNumber: "23916229",
    });
    assert.deepEqual(result.months, [
      {
        month: "2026-08",
        debitCount: 2,
        found: 1,
        originalMissing: 0,
        notMatched: 0,
        noInvoice: 1,
        noInvoiceNeeded: 1,
        missingAmountHuf: "2500",
        status: "INCOMPLETE",
        missingStatementAccounts: [],
      },
    ]);
  });

  it("counts a known invoice without its original apart, as missing work but not as a missing amount", async () => {
    const { missing } = service({
      debits: [debit("2026-08-03", 1000, "Szállító Kft.")],
      documents: [
        { ...nav("2026-08-01", 1000, "Szállító Kft."), hasOriginal: false },
      ],
      coverage: [`${MAIN.id}:2026-08`, `${CARD.id}:2026-08`],
    });
    const [month] = (await missing.months()).months;
    assert.deepEqual(
      [
        month?.found,
        month?.originalMissing,
        month?.status,
        month?.missingAmountHuf,
      ],
      [0, 1, "INCOMPLETE", "0"],
    );
    const detail = await missing.month("2026-08", {});
    assert.deepEqual(
      detail.items.map((i) => i.state),
      ["ORIGINAL_MISSING"],
    );
  });

  it("tells a missing statement, a partial one, and a month ready for the accountant", async () => {
    const { missing } = service({
      debits: [
        debit("2026-06-10", 1000, "Szállító Kft."),
        debit("2026-08-10", 1000, "Szállító Kft."),
      ],
      documents: [
        nav("2026-06-01", 1000, "Szállító Kft."),
        nav("2026-08-01", 1000, "Szállító Kft."),
      ],
      coverage: [
        `${MAIN.id}:2026-06`,
        `${CARD.id}:2026-06`,
        `${MAIN.id}:2026-08`,
      ],
    });
    const months = (await missing.months()).months;
    assert.deepEqual(
      months.map((m) => [m.month, m.status, m.missingStatementAccounts]),
      [
        ["2026-08", "STATEMENT_PARTIAL", ["Kártyás számla"]],
        ["2026-07", "STATEMENT_MISSING", ["Fő számla", "Kártyás számla"]],
        ["2026-06", "READY", []],
      ],
    );
  });
});

describe("MissingInvoicesService.month", () => {
  const setup = () =>
    service({
      debits: [
        debit("2026-08-03", 1000, "Szállító Kft."),
        debit("2026-08-04", 2500, "Senki Bt."),
        debit("2026-08-05", 3500, "Másik Bt."),
        debit("2026-08-06", 900, "Nagy Anna", {
          narrative: "08 havi munkabér",
        }),
      ],
      documents: [nav("2026-08-01", 1000, "Szállító Kft.")],
      coverage: [`${MAIN.id}:2026-08`, `${CARD.id}:2026-08`],
    });

  it("shows the missing ones by default, and each tab its own", async () => {
    const { missing } = setup();
    const tab = async (t?: "FOUND" | "NO_INVOICE_NEEDED" | "ALL") =>
      (await missing.month("2026-08", { tab: t })).items.map((i) => i.partner);
    assert.deepEqual(await tab(), ["Senki Bt.", "Másik Bt."]);
    assert.deepEqual(await tab("FOUND"), ["Szállító Kft."]);
    assert.deepEqual(await tab("NO_INVOICE_NEEDED"), ["Nagy Anna"]);
    assert.equal((await tab("ALL")).length, 4);
  });

  it("searches partner, narrative and amount, and pages on the server", async () => {
    const { missing } = setup();
    assert.deepEqual(
      (await missing.month("2026-08", { q: "3500" })).items.map(
        (i) => i.partner,
      ),
      ["Másik Bt."],
    );
    const page = await missing.month("2026-08", {
      tab: "ALL",
      page: 2,
      pageSize: 3,
    });
    assert.deepEqual(
      [
        page.items.length,
        page.pagination.totalItems,
        page.pagination.totalPages,
      ],
      [1, 4, 2],
    );
  });
});

describe("the payee check of mailbox invoices", () => {
  it("reads an unchecked document once and stores the answer", async () => {
    const mailbox: CandidateDocument = {
      ...nav("2026-08-01", 1000, "Szállító Kft."),
      source: "MAILBOX",
      payee: "UNKNOWN",
    };
    const { missing, stored } = service({
      debits: [debit("2026-08-03", 1000, "Szállító Kft.")],
      documents: [mailbox],
      coverage: [`${MAIN.id}:2026-08`, `${CARD.id}:2026-08`],
      mailbox: [
        {
          id: mailbox.id,
          fileName: "szamla.xml",
          content: Buffer.from("<Vevo><Adoszam>23916229-2-13</Adoszam></Vevo>"),
        },
      ],
    });
    const result = await missing.month("2026-08", { tab: "FOUND" });
    assert.deepEqual(stored, [[mailbox.id, "COMPANY"]]);
    assert.equal(result.items[0]?.state, "FOUND");
  });
});
