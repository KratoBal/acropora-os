import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  inWindow,
  matchMonth,
  samePartner,
  type CandidateDocument,
  type MatchableDebit,
} from "./missing-invoice-matching.js";
import { sequenceRatio } from "./sequence-ratio.js";

const D = (v: string | number) => new Prisma.Decimal(v);

let n = 0;
const debit = (overrides: Partial<MatchableDebit>): MatchableDebit => ({
  id: `d${++n}`,
  bookingDate: "2026-08-10",
  amount: D(1000),
  currency: "HUF",
  original: null,
  counterpartyName: "Szállító Kft.",
  counterpartyAccount: null,
  narrative: "",
  category: "DOMESTIC_SUPPLIER",
  ...overrides,
});

const doc = (overrides: Partial<CandidateDocument>): CandidateDocument => ({
  id: `c${++n}`,
  source: "NAV",
  number: `SZ-2026-${n}`,
  date: "2026-08-05",
  gross: D(1000),
  currency: "HUF",
  supplierName: "Szállító Kft.",
  supplierAccounts: [],
  kind: "INVOICE",
  payee: "COMPANY",
  hasOriginal: true,
  ...overrides,
});

const run = (
  debits: MatchableDebit[],
  documents: CandidateDocument[],
  manual = new Map<string, string[]>(),
) => matchMonth({ debits, documents, manual });

describe("sequenceRatio", () => {
  it("gives Python difflib's ratio (values measured against difflib)", () => {
    assert.deepEqual(
      [
        ["allianz hungaria", "sopro hungaria"],
        ["hetzner online", "unas online"],
        ["abxcd", "abcd"],
        ["coral sands", "coralsands"],
      ].map(([a, b]) => Math.round(sequenceRatio(a!, b!) * 1e6) / 1e6),
      [0.6, 0.64, 0.888889, 0.952381],
    );
  });
});

describe("samePartner", () => {
  it("refuses the measured false likenesses that share a generic word", () => {
    assert.equal(
      samePartner("Allianz Hungária Zrt.", "SOPRO HUNGÁRIA Kft."),
      false,
    );
    assert.equal(samePartner("Hetzner Online GmbH", "UNAS Online Kft."), false);
    assert.equal(
      samePartner("Fluidra Magyarország Kft.", "Yettel Magyarország Zrt."),
      false,
    );
    assert.equal(
      samePartner("Tesla Hungary Kft.", "Tesla Hungary Korlatol"),
      true,
    );
  });
});

describe("inWindow", () => {
  it("takes an invoice up to 4 months before the payment and until the 15th of the next month", () => {
    assert.deepEqual(
      ["2026-04-01", "2026-03-31", "2026-09-15", "2026-09-16"].map((d) =>
        inWindow("2026-08-10", d),
      ),
      [true, false, true, false],
    );
  });
});

describe("matchMonth", () => {
  it("pairs by the invoice number in the narrative first", () => {
    const d = debit({
      narrative: "Számla: KS26/05848",
      counterpartyName: "Bárki",
    });
    const c = doc({
      number: "KS26/05848",
      supplierName: "Fluidra Kft.",
      gross: D(9),
    });
    assert.equal(
      run([d], [c]).get(d.id)?.reason,
      "a számla száma a közleményben",
    );
  });

  it("pairs by the supplier's bank account with an exact amount", () => {
    const d = debit({
      counterpartyName: "más név",
      counterpartyAccount: "1177301611111018",
    });
    const c = doc({
      supplierAccounts: ["1177301611111018"],
      supplierName: "Teljesen Más",
    });
    assert.equal(run([d], [c]).get(d.id)?.state, "FOUND");
  });

  it("gives an exact invoice to the payment that matches it exactly, not to an earlier one 1 Ft off", () => {
    const july = debit({ bookingDate: "2026-07-15", amount: D(1999) });
    const august = debit({ bookingDate: "2026-08-07", amount: D(1998) });
    const c = doc({ date: "2026-08-05", gross: D(1998) });
    const out = run([july, august], [c]);
    assert.equal(out.get(august.id)?.documents[0]?.id, c.id);
    assert.equal(out.get(july.id)?.state, "NOT_MATCHED");
  });

  it("counts a 2-5 Ft rounding as found, but does not choose between two such invoices", () => {
    const d = debit({ amount: D(1003) });
    assert.equal(run([d], [doc({})]).get(d.id)?.state, "FOUND");
    const e = debit({ amount: D(1003) });
    const out = run([e], [doc({ gross: D(1000) }), doc({ gross: D(1006) })]);
    assert.equal(out.get(e.id)?.state, "NOT_MATCHED");
    assert.match(out.get(e.id)!.reason, /kerekítési/);
  });

  it("lets one invoice pay one debit only (the two 23 810 Ft Alza payments)", () => {
    const first = debit({ amount: D(23810), counterpartyName: "Alza.hu Kft." });
    const second = debit({
      amount: D(23810),
      counterpartyName: "Alza.hu Kft.",
    });
    const out = run(
      [first, second],
      [doc({ gross: D(23810), supplierName: "Alza.hu Kft." })],
    );
    assert.deepEqual(
      [out.get(first.id)?.state, out.get(second.id)?.state],
      ["FOUND", "NOT_MATCHED"],
    );
  });

  it("pairs several invoices in one transfer, and refuses to choose between two sets", () => {
    const d = debit({ amount: D(3000) });
    const out = run([d], [doc({ gross: D(1000) }), doc({ gross: D(2000) })]);
    assert.equal(out.get(d.id)?.documents.length, 2);
    const e = debit({ amount: D(3000) });
    const twice = run(
      [e],
      [
        doc({ gross: D(1000) }),
        doc({ gross: D(2000) }),
        doc({ gross: D(1500) }),
        doc({ gross: D(1500) }),
      ],
    );
    assert.equal(twice.get(e.id)?.state, "NOT_MATCHED");
  });

  it("marks a proforma, a private-person invoice and an unverifiable payee", () => {
    const states = (["PROFORMA", "INVOICE", "INVOICE"] as const).map(
      (kind, i) => {
        const d = debit({});
        return run(
          [d],
          [
            doc({
              kind,
              payee: (["COMPANY", "NOT_COMPANY", "UNKNOWN"] as const)[i],
            }),
          ],
        ).get(d.id)?.state;
      },
    );
    assert.deepEqual(states, ["PROFORMA_ONLY", "NOT_COMPANY", "NOT_MATCHED"]);
  });

  it("asks for the original when only the NAV data row is there", () => {
    const d = debit({});
    assert.equal(
      run([d], [doc({ hasOriginal: false })]).get(d.id)?.state,
      "ORIGINAL_MISSING",
    );
  });

  it("tells no invoice from an unmatched one by whether the partner has documents", () => {
    const d = debit({ amount: D(777) });
    const e = debit({ amount: D(777), counterpartyName: "Ismeretlen Bt." });
    const out = run([d, e], [doc({ gross: D(5000) })]);
    assert.deepEqual(
      [out.get(d.id)?.state, out.get(e.id)?.state],
      ["NOT_MATCHED", "NO_INVOICE"],
    );
    assert.equal(out.get(d.id)?.candidates.length, 1);
  });

  it("keeps a manual pairing even against a rule, and never matches categories that need no invoice", () => {
    const d = debit({ narrative: "SZ-X-99999" });
    const byRule = doc({ number: "SZ-X-99999" });
    const chosen = doc({ gross: D(1) });
    const out = run([d], [byRule, chosen], new Map([[d.id, [chosen.id]]]));
    assert.deepEqual(
      [out.get(d.id)?.matchedBy, out.get(d.id)?.documents[0]?.id],
      ["MANUAL", chosen.id],
    );
    const tax = debit({ category: "TAX" });
    assert.equal(run([tax], [doc({})]).get(tax.id)?.state, "NO_INVOICE_NEEDED");
  });

  it("compares a card payment's original currency amount with a EUR invoice", () => {
    const d = debit({
      amount: D(21990),
      original: { amount: D("55.38"), currency: "EUR" },
      counterpartyName: "Hetzner Online GmbH",
    });
    const c = doc({
      gross: D("55.38"),
      currency: "EUR",
      supplierName: "Hetzner Online GmbH",
    });
    assert.equal(run([d], [c]).get(d.id)?.state, "FOUND");
  });
});
