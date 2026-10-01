import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type { CandidateDocument } from "./missing-invoice-matching.js";
import {
  mergeSameInvoice,
  normalizeAccount,
} from "./missing-invoices.repository.js";

const doc = (overrides: Partial<CandidateDocument>): CandidateDocument => ({
  id: "x",
  source: "NAV",
  number: "SZ-1",
  date: "2026-08-01",
  gross: new Prisma.Decimal(12700),
  currency: "HUF",
  supplierName: "Szállító Kft.",
  supplierAccounts: [],
  kind: "INVOICE",
  payee: "COMPANY",
  hasOriginal: false,
  ...overrides,
});

describe("mergeSameInvoice", () => {
  it("makes one invoice of the NAV row and its mailbox PDF: NAV gross and payee, the PDF as the original", () => {
    const nav = doc({ id: "nav-1" });
    const pdf = doc({
      id: "mb-1",
      source: "MAILBOX",
      gross: null,
      payee: "UNKNOWN",
      hasOriginal: true,
    });
    const merged = mergeSameInvoice(
      [nav, pdf],
      new Map([
        ["nav-1", "sz-1|12345678"],
        ["mb-1", "sz-1|12345678"],
      ]),
    );
    assert.equal(merged.length, 1);
    assert.deepEqual(
      [
        merged[0]!.id,
        merged[0]!.source,
        merged[0]!.gross?.toString(),
        merged[0]!.payee,
        merged[0]!.hasOriginal,
        merged[0]!.originalId,
      ],
      ["nav-1", "MAILBOX", "12700", "COMPANY", true, "mb-1"],
    );
  });

  it("leaves apart what has no number, and two different invoices", () => {
    const merged = mergeSameInvoice(
      [doc({ id: "a" }), doc({ id: "b" }), doc({ id: "c" })],
      new Map([
        ["a", "sz-1|12345678"],
        ["b", "sz-2|12345678"],
        ["c", "|12345678"],
      ]),
    );
    assert.equal(merged.length, 3);
  });

  // MI PIROSÍT (acrobot 25636): ha az összevont számla nem vinné a társai
  // fájl-lenyomatát és a számlaszám-kulcsát; ha egy szám nélküli dokumentum
  // hamis kulcsot kapna.
  it("carries what makes two documents the same invoice: the file prints and the number key", () => {
    const merged = mergeSameInvoice(
      [
        doc({ id: "nav-1" }),
        doc({ id: "up-1", source: "UPLOAD", identities: ["sha:aaa"] }),
        doc({ id: "up-2", source: "UPLOAD", identities: ["sha:bbb"] }),
      ],
      new Map([
        ["nav-1", "sz-1|12345678"],
        ["up-1", "sz-1|12345678"],
        ["up-2", "|12345678"],
      ]),
    );
    const byId = (id: string) => merged.find((d) => d.id === id)?.identities;
    assert.deepEqual(
      [byId("nav-1")?.slice().sort(), byId("up-2")],
      [["inv:sz-1|12345678", "sha:aaa"], ["sha:bbb"]],
    );
  });
});

describe("normalizeAccount", () => {
  it("makes the IBAN, the 24-digit and the 16-digit forms of a Hungarian account one", () => {
    assert.deepEqual(
      [
        "HU42 1177 3016 1111 1018 0000 0000",
        "11773016-11111018-00000000",
        "1177301611111018",
      ].map(normalizeAccount),
      ["1177301611111018", "1177301611111018", "1177301611111018"],
    );
    assert.equal(
      normalizeAccount("DE89370400440532013000"),
      "DE89370400440532013000",
    );
  });
});
