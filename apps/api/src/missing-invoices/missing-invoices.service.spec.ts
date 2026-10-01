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
  const ranges: [string, string][] = [];
  const repository = {
    accounts: async () => [MAIN, CARD],
    debits: async () => input.debits,
    statementCoverage: async () => new Set(input.coverage),
    manualMatches: async () => new Map(),
    candidates: async (from: string, to: string) => {
      ranges.push([from, to]);
      return input.documents ?? [];
    },
    uncheckedMailboxContent: async () => input.mailbox ?? [],
    setPayee: async (id: string, payee: string) =>
      void stored.push([id, payee]),
  } as unknown as MissingInvoicesRepository;
  return {
    missing: new MissingInvoicesService(repository, READER),
    stored,
    ranges,
  };
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

describe("MissingInvoicesService candidate range", () => {
  it("loads documents from 12 months before the first statement month", async () => {
    // Hertlein 260835: április 29-i számla, szeptember 25-i fizetés; a 4
    // hónapos betöltés (05-01-től) kizárta, holott a közlemény megnevezi
    const { missing, ranges } = service({
      debits: [debit("2026-09-25", 25337, "HERTLEIN Aquaristik")],
      coverage: [`${MAIN.id}:2026-09`, `${CARD.id}:2026-09`],
    });
    await missing.months();
    assert.deepEqual(ranges, [["2025-09-01", "2026-10-15"]]);
  });
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

/*
  KÉTSZER FIZETETT SZÁMLA A HÓNAPBAN ÉS A DRAWERBEN (acrobot 25636). MI PIROSÍT:
  ha a két terhelés a Megvan-csempébe számítana; ha a hiányzó összegből
  kimaradna; ha a drawer nem nevezné meg a másik terhelést dátummal, összeggel.
*/
/*
  BIZTOSÍTÁS A DRAWERBEN (barracuda esetlistája, 2. csoport). MI PIROSÍT: ha egy
  biztosítási díjnál a „Mit kell tenni” a számla elkérését mondaná, holott
  díjértesítő kell; ha egy szállítónál is a díjértesítőt kérné.
*/
describe("an insurance premium without a document", () => {
  it("asks for the premium notice, while a supplier still gets the invoice request", async () => {
    const premium = debit("2026-09-25", 85688, "Genertel Biztosító Zrt.", {
      transactionType: "AZONNALI FIZETÉS",
      narrative: "10023943821",
    });
    const supplier = debit("2026-09-25", 12000, "Szállító Kft.");
    const { missing } = service({
      debits: [premium, supplier],
      coverage: [`${MAIN.id}:2026-09`, `${CARD.id}:2026-09`],
    });
    const insured = await missing.item(premium.id);
    const other = await missing.item(supplier.id);
    assert.deepEqual(
      [insured.state, insured.category, insured.action, other.action],
      ["NO_INVOICE", "INSURANCE", "PROVIDE_PREMIUM_NOTICE", "REQUEST_INVOICE"],
    );
  });
});

describe("a double-paid invoice", () => {
  it("is counted as missing an invoice, and the drawer names the other debit", async () => {
    const sopro = (id: string): CandidateDocument => ({
      ...nav("2026-09-20", 172006, "Sopro Hungária Kft."),
      id,
      source: "UPLOAD",
      identities: ["sha:same-pdf"],
    });
    const first = debit("2026-09-28", 172006, "Sopro Hungária Kft.");
    const second = debit("2026-09-29", 172006, "Sopro Hungária Kft.");
    const { missing } = service({
      debits: [first, second],
      documents: [sopro("up-1"), sopro("up-2")],
      coverage: [`${MAIN.id}:2026-09`, `${CARD.id}:2026-09`],
    });
    const month = (await missing.months()).months.find(
      (m) => m.month === "2026-09",
    )!;
    assert.deepEqual(
      [month.found, month.noInvoice, month.missingAmountHuf],
      [0, 2, "344012"],
    );
    const detail = await missing.item(first.id);
    assert.deepEqual(
      [detail.state, detail.action, detail.doublePaidWith],
      [
        "DOUBLE_PAID",
        "CHECK_DOUBLE_PAYMENT",
        [
          {
            id: second.id,
            bookingDate: "2026-09-29",
            amount: "172006",
            currency: "HUF",
          },
        ],
      ],
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

  // MI PIROSÍT: ha egy NEM postafiókos (feltöltött, gyűjtött) dokumentum
  // visszaállított (NULL) vevője sosem számolódna újra (acrobot 25640: a
  // migráció a régi NOT_COMPANY sorokat NULL-ra teszi, köztük feltöltötteket).
  it("an upload whose payee was reset is read again too, by our name this time", async () => {
    const upload: CandidateDocument = {
      ...nav("2026-08-01", 1000, "Magic Patterns Inc."),
      source: "UPLOAD",
      payee: "UNKNOWN",
    };
    const { missing, stored } = service({
      debits: [debit("2026-08-03", 1000, "Magic Patterns Inc.")],
      documents: [upload],
      coverage: [`${MAIN.id}:2026-08`, `${CARD.id}:2026-08`],
      mailbox: [
        {
          id: upload.id,
          fileName: "invoice.txt",
          content: Buffer.from("Bill to Acropora Kft. Budapest 1106 Hungary"),
        },
      ],
    });
    await missing.month("2026-08", { tab: "ALL" });
    assert.deepEqual(stored, [[upload.id, "COMPANY"]]);
  });
});
