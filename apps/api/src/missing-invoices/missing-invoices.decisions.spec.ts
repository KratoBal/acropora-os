import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import type { CandidateDocument } from "./missing-invoice-matching.js";
import type { MissingInvoicesRepository } from "./missing-invoices.repository.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";
import type { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";

const READER = {
  read: async () => {
    throw new Error("ismeretlen formátum");
  },
} as unknown as SupplierInvoiceImportService;

const USER = { id: "user-1" } as AuthenticatedUser;
const ACCOUNT = {
  id: "acc",
  accountNumber: "1170900220624460",
  currency: "HUF",
  name: "Fő számla",
};

/** Állapotos hamis tároló: a döntéseket megjegyzi, és a következő olvasás látja. */
function setup(env: NodeJS.ProcessEnv = {}, extra: CandidateDocument[] = []) {
  const debit = {
    id: "debit-1",
    bankAccountId: ACCOUNT.id,
    amount: new Prisma.Decimal(12700),
    currency: "HUF",
    bookingDate: new Date("2026-08-12T00:00:00Z"),
    counterpartyAccount: null,
    counterpartyName: "Szállító Kft.",
    narrative: "",
    transactionType: "ÁTUTALÁS",
    comment: null as string | null,
    categoryOverride: null as string | null,
    paperOriginalAt: null as Date | null,
  };
  const nav: CandidateDocument = {
    id: "nav-1",
    source: "NAV",
    number: "SZ-1",
    date: "2026-08-05",
    gross: new Prisma.Decimal(99999),
    currency: "HUF",
    supplierName: "Szállító Kft.",
    supplierAccounts: [],
    kind: "INVOICE",
    payee: "COMPANY",
    hasOriginal: false,
    aliasIds: ["mb-1"],
  };
  const matches = new Map<string, string[]>();
  const audit: string[] = [];
  const marked: string[][] = [];
  let taken = new Set<string>();
  const repository = {
    accounts: async () => [ACCOUNT],
    debits: async () => [debit],
    credits: async () => [],
    statementCoverage: async () => new Set([`${ACCOUNT.id}:2026-08`]),
    manualMatches: async () => new Map(matches),
    candidates: async () => [nav, ...extra.map((d) => ({ ...d }))],
    uncheckedMailboxContent: async () => [],
    setPayee: async () => undefined,
    pair: async (input: { bankTransactionId: string; documentId: string }) => {
      if (taken.has(input.documentId))
        throw Object.assign(new Error("unique"), {
          code: "P2002",
          meta: { target: ["documentSource", "documentId"] },
        });
      taken.add(input.documentId);
      matches.set(input.bankTransactionId, [input.documentId]);
      audit.push("paired");
    },
    unpair: async (id: string) => {
      matches.delete(id);
      taken = new Set();
      audit.push("unpaired");
    },
    markPayee: async (input: {
      documentIds: string[];
      payee: "COMPANY" | "NOT_COMPANY";
    }) => {
      // a valódi tároló feltétele: csak UNKNOWN vagy már kézzel jelölt
      const writable = extra.filter(
        (d) =>
          input.documentIds.includes(d.id) &&
          (d.payee === "UNKNOWN" || d.payeeMarked),
      );
      for (const d of writable)
        Object.assign(d, { payee: input.payee, payeeMarked: true });
      if (writable.length) {
        marked.push(input.documentIds);
        audit.push("missing-invoices.payee-marked");
      }
      return writable.length;
    },
    annotate: async (
      _id: string,
      _user: string,
      action: string,
      data: Record<string, unknown>,
    ) => {
      Object.assign(debit, data);
      audit.push(action);
    },
  } as unknown as MissingInvoicesRepository;
  return {
    missing: new MissingInvoicesService(repository, READER, env),
    audit,
    marked,
    taken: () => taken,
  };
}

/** Egy feltöltött, beszkennelt (szöveg nélküli) számla: a vevője nem olvasható. */
const scanned = (
  payee: CandidateDocument["payee"] = "UNKNOWN",
): CandidateDocument => ({
  id: "up-1",
  source: "UPLOAD",
  number: "KB-2855/2026",
  date: "2026-08-10",
  gross: null,
  currency: "HUF",
  supplierName: "Sopro Hungária Kft.",
  supplierAccounts: [],
  kind: "INVOICE",
  payee,
  hasOriginal: true,
});

describe("the decisions on a debit", () => {
  it("pairs by hand with the id of either source, and keeps the invoice for one debit", async () => {
    const { missing, audit } = setup();
    const before = await missing.item("debit-1");
    assert.deepEqual(
      [before.state, before.action],
      ["NOT_MATCHED", "PAIR_OR_UPLOAD"],
    );
    const after = await missing.pair("debit-1", "mb-1", USER);
    assert.deepEqual(
      [after.state, after.matchedBy, after.document?.id, after.action],
      ["ORIGINAL_MISSING", "MANUAL", "nav-1", "PROVIDE_ORIGINAL"],
    );
    await assert.rejects(
      missing.pair("debit-1", "nav-1", USER),
      ConflictException,
    );
    assert.deepEqual(audit, ["paired"]);
  });

  it("refuses an unknown document and an unknown debit", async () => {
    const { missing } = setup();
    await assert.rejects(
      missing.pair("debit-1", "nincs", USER),
      BadRequestException,
    );
    await assert.rejects(missing.item("nincs"), NotFoundException);
  });

  it("takes back a manual pairing", async () => {
    const { missing } = setup();
    await missing.pair("debit-1", "nav-1", USER);
    const after = await missing.unpair("debit-1", USER);
    assert.deepEqual([after.matchedBy, after.state], [null, "NOT_MATCHED"]);
  });

  it("marks the paper original, and the state follows", async () => {
    const { missing, audit } = setup();
    await missing.pair("debit-1", "nav-1", USER);
    const marked = await missing.paperOriginal("debit-1", true, USER);
    assert.deepEqual([marked.state, marked.paperOriginal], ["FOUND", true]);
    const cleared = await missing.paperOriginal("debit-1", false, USER);
    assert.deepEqual(
      [cleared.state, cleared.paperOriginal],
      ["ORIGINAL_MISSING", false],
    );
    assert.deepEqual(audit.slice(1), [
      "missing-invoices.paper-original-marked",
      "missing-invoices.paper-original-cleared",
    ]);
  });

  it("recategorizes by hand above the rule, and says so", async () => {
    const { missing } = setup();
    const moved = await missing.recategorize("debit-1", "TAX", USER);
    assert.deepEqual(
      [moved.category, moved.categoryOverridden, moved.state],
      ["TAX", true, "NO_INVOICE_NEEDED"],
    );
    assert.match(moved.categoryRule, /kézzel átsorolva/);
    const back = await missing.recategorize("debit-1", null, USER);
    assert.equal(back.categoryOverridden, false);
  });

  it("keeps a trimmed comment, and an empty one as none", async () => {
    const { missing } = setup();
    assert.equal(
      (await missing.comment("debit-1", "  kérve 09-30  ", USER)).comment,
      "kérve 09-30",
    );
    assert.equal((await missing.comment("debit-1", "   ", USER)).comment, null);
  });

  it("gives the Drive folder link only when configured, and only as https", async () => {
    assert.equal(
      (await setup({}).missing.item("debit-1")).driveFolderUrl,
      null,
    );
    assert.equal(
      (
        await setup({
          MISSING_INVOICES_DRIVE_FOLDER_URL:
            "https://drive.google.com/drive/folders/abc",
        }).missing.item("debit-1")
      ).driveFolderUrl,
      "https://drive.google.com/drive/folders/abc",
    );
    assert.equal(
      (
        await setup({
          MISSING_INVOICES_DRIVE_FOLDER_URL: "javascript:alert(1)",
        }).missing.item("debit-1")
      ).driveFolderUrl,
      null,
    );
  });

  /*
    A VEVŐ KÉZI JELÖLÉSE (acrobot 25633: a beszkennelt Sopro-számla örökre Nem
    párosodott maradt). MI PIROSÍT: ha a jelölés után sem lenne Megvan; ha a
    szövegből olvasott vevő kézzel felülírható lenne; ha a kézi jelölést nem
    lehetne visszafordítani; ha a nem ehhez a terheléshez tartozó számla
    jelölhető lenne; ha nem kerülne auditba; ha a drawer nem kapná meg.
  */
  it("a scanned invoice's payee is marked by hand, and the item is found", async () => {
    const { missing, audit, marked } = setup({}, [scanned()]);
    const paired = await missing.pair("debit-1", "up-1", USER);
    assert.deepEqual(
      [paired.state, paired.payeeDocuments],
      [
        "NOT_MATCHED",
        [
          {
            documentId: "up-1",
            number: "KB-2855/2026",
            payee: "UNKNOWN",
            marked: false,
          },
        ],
      ],
    );
    const after = await missing.markPayee("debit-1", "up-1", "COMPANY", USER);
    assert.deepEqual(
      [
        after.state,
        after.payeeDocuments[0]?.payee,
        after.payeeDocuments[0]?.marked,
      ],
      ["FOUND", "COMPANY", true],
    );
    assert.deepEqual(marked, [["up-1"]]);
    assert.equal(audit.at(-1), "missing-invoices.payee-marked");
  });

  it("a hand mark can be turned the other way", async () => {
    const { missing } = setup({}, [scanned()]);
    await missing.pair("debit-1", "up-1", USER);
    await missing.markPayee("debit-1", "up-1", "COMPANY", USER);
    const back = await missing.markPayee(
      "debit-1",
      "up-1",
      "NOT_COMPANY",
      USER,
    );
    assert.equal(back.state, "NOT_COMPANY");
  });

  it("a payee read from the text or from NAV is not overwritten by hand", async () => {
    const { missing, marked } = setup({}, [scanned("COMPANY")]);
    await missing.pair("debit-1", "up-1", USER);
    await assert.rejects(
      missing.markPayee("debit-1", "up-1", "NOT_COMPANY", USER),
      ConflictException,
    );
    const nav = setup();
    const navPaired = await nav.missing.pair("debit-1", "nav-1", USER);
    // a NAV-ból ismert vevőjű számla nem kerül a jelölhetők közé
    assert.deepEqual(navPaired.payeeDocuments, []);
    await assert.rejects(
      nav.missing.markPayee("debit-1", "nav-1", "NOT_COMPANY", USER),
      ConflictException,
    );
    assert.deepEqual([marked, nav.marked], [[], []]);
  });

  it("only an invoice paired to this debit can be marked", async () => {
    const { missing, marked } = setup({}, [scanned()]);
    await assert.rejects(
      missing.markPayee("debit-1", "up-1", "COMPANY", USER),
      BadRequestException,
    );
    assert.deepEqual(marked, []);
  });
});
