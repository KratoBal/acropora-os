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

  // MI PIROSÍT: ha az eredeti a díjbekérő marad, amikor a csoportban a
  // végleges számla is ott áll (Amblard F2602896, 2026-10-06). A díjbekérő
  // ÁLL ELÖL, hogy a régi „első eredeti” szabály ezt válassza.
  it("takes the final invoice as the original, not a pro forma with the same number", () => {
    const nav = doc({ id: "nav-1" });
    const proforma = doc({
      id: "mb-proforma",
      source: "MAILBOX",
      kind: "PROFORMA",
      gross: null,
      payee: "UNKNOWN",
      hasOriginal: true,
    });
    const invoice = doc({
      id: "mb-invoice",
      source: "MAILBOX",
      gross: null,
      payee: "UNKNOWN",
      hasOriginal: true,
    });
    const keys = new Map([
      ["nav-1", "sz-1|12345678"],
      ["mb-proforma", "sz-1|12345678"],
      ["mb-invoice", "sz-1|12345678"],
    ]);
    const merged = mergeSameInvoice([nav, proforma, invoice], keys);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.originalId, "mb-invoice");
    assert.equal(merged[0]!.kind, "INVOICE");
    // kontroll: számla nélkül a díjbekérő marad az eredeti, nem tűnik el
    const alone = mergeSameInvoice([nav, proforma], keys);
    assert.equal(alone[0]!.originalId, "mb-proforma");
  });

  // MI PIROSÍT (acrobot 26084): ha a NAV-sorral összevont Számlázz.hu-számla
  // elveszítené a kártyás fizetési módot, és a 3f. szabály nem látná.
  it("keeps the card payment of any source of the merged invoice", () => {
    const merged = mergeSameInvoice(
      [
        doc({ id: "nav-1", source: "NAV", hasOriginal: false }),
        doc({ id: "szlz-1", source: "SZAMLAZZ", cardPaid: true }),
        doc({ id: "nav-2", number: "SZ-2", source: "NAV" }),
      ],
      new Map([
        ["nav-1", "sz-1|12345678"],
        ["szlz-1", "sz-1|12345678"],
        ["nav-2", "sz-2|12345678"],
      ]),
    );
    assert.deepEqual(
      merged.map((d) => [d.id, d.cardPaid ?? false]),
      [
        ["nav-1", true],
        ["nav-2", false],
      ],
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

/*
  AZ ÁFA-CSOPORT TAGJA (barracuda 26429, éles mérés: Euroleasing 2, OTP EBIZ 1).
  MI PIROSÍT: a csoport-azonosítós NAV-sor és a tag adószámos Számlázz.hu-sor
  külön jelölt marad; vagy épp fordítva, két különböző szállító azonos
  számlaszáma összevonódik, mert csak a szám egyezik; vagy több lehetséges
  társ közül a szabály választ.
*/
describe("a VAT group member's two tax numbers", () => {
  const euroleasingNav = () =>
    doc({
      id: "nav-1",
      number: "2026/01212920",
      gross: new Prisma.Decimal(48260),
      date: "2026-09-05",
    });
  const euroleasingSzamlazz = (over: Partial<CandidateDocument> = {}) =>
    doc({
      id: "szlz-1",
      source: "SZAMLAZZ",
      number: "2026/01212920",
      gross: new Prisma.Decimal(48260),
      date: "2026-09-05",
      ...over,
    });

  it("the NAV row's group id and the member's own number make one invoice", () => {
    const merged = mergeSameInvoice(
      [euroleasingNav(), euroleasingSzamlazz()],
      new Map([
        ["nav-1", "2026/01212920|17782672"],
        ["szlz-1", "2026/01212920|12238972"],
      ]),
    );
    assert.deepEqual(
      merged.map((d) => [d.id, d.aliasIds ?? []]),
      [["nav-1", ["szlz-1"]]],
    );
  });

  it("a different gross or day, or a NAV row without a group id, stays apart", () => {
    for (const [szamlazz, navKey] of [
      [
        euroleasingSzamlazz({ gross: new Prisma.Decimal(48261) }),
        "2026/01212920|17782672",
      ],
      [euroleasingSzamlazz({ date: "2026-09-06" }), "2026/01212920|17782672"],
      [euroleasingSzamlazz(), "2026/01212920|11111111"],
    ] as const)
      assert.equal(
        mergeSameInvoice(
          [euroleasingNav(), szamlazz],
          new Map([
            ["nav-1", navKey],
            ["szlz-1", "2026/01212920|12238972"],
          ]),
        ).length,
        2,
      );
  });

  it("two possible partners with different keys: the rule does not choose", () => {
    const merged = mergeSameInvoice(
      [
        euroleasingNav(),
        euroleasingSzamlazz(),
        euroleasingSzamlazz({ id: "mb-1", source: "MAILBOX" }),
      ],
      new Map([
        ["nav-1", "2026/01212920|17782672"],
        ["szlz-1", "2026/01212920|12238972"],
        ["mb-1", "2026/01212920|99999999"],
      ]),
    );
    assert.equal(merged.find((d) => d.id === "nav-1")?.aliasIds, undefined);
  });
});
