import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  freeDocuments,
  jevPairInput,
  type JevDebit,
} from "./missing-invoice-jev-candidates.js";
import type {
  CandidateDocument,
  MatchOutcome,
} from "./missing-invoice-matching.js";

const D = (v: number | string) => new Prisma.Decimal(v);
let n = 0;
const doc = (
  date: string,
  gross: number | null,
  supplierName: string,
  extra: Partial<CandidateDocument> = {},
): CandidateDocument => ({
  id: `doc${String(++n).padStart(3, "0")}`,
  source: "NAV",
  number: `SZ-${n}`,
  date,
  gross: gross === null ? null : D(gross),
  currency: "HUF",
  supplierName,
  supplierAccounts: [],
  kind: "INVOICE",
  payee: "COMPANY",
  hasOriginal: true,
  ...extra,
});
const debit = (
  amount: number,
  name: string,
  extra: Partial<JevDebit> = {},
): JevDebit => ({
  id: "bt1",
  bookingDate: "2026-05-10",
  amount: D(amount),
  currency: "HUF",
  original: null,
  counterpartyName: name,
  category: "DOMESTIC_SUPPLIER",
  ...extra,
});
const outcome = (
  state: MatchOutcome["state"] = "NOT_MATCHED",
): MatchOutcome => ({
  state,
  documents: [],
  matchedBy: null,
  reason: "",
  candidates: [],
});

describe("jevPairInput: ugyanaz a szabaly, mint a celzott meres osszeallitoja", () => {
  it("NEV: pontos osszeg mas kiallitotol; melle a hasonlo osszegu szamlak, datum szerint", () => {
    const telekom = doc("2026-05-02", 38488, "Magyar Telekom Nyrt.");
    const similar = doc("2026-04-20", 38000, "Valaki Más Kft.");
    const far = doc("2026-04-21", 90000, "Harmadik Kft.");
    const input = jevPairInput(
      debit(38488, "TelekomSzaml*925585488"),
      outcome(),
      [telekom, similar, far],
    );
    assert.deepEqual(input?.kinds, ["NEV"]);
    assert.deepEqual(
      input?.candidates.map((d) => d.id),
      [similar.id, telekom.id],
    );
  });

  it("OSSZEG: ugyanaz a partner, az osszeg elter, de max(1000 Ft, 5%)-on belul", () => {
    const close = doc("2026-05-01", 145854, "Euroleasing Zrt.");
    const exact = doc("2026-05-03", 146236, "Euroleasing Zrt.");
    const input = jevPairInput(debit(146236, "Euroleasing Zrt."), outcome(), [
      close,
      exact,
    ]);
    // a pontos egyezes nem talalat (azt a gepi szabaly dontene), de a partner szamlajakent a listan van
    assert.deepEqual(input?.kinds, ["OSSZEG"]);
    assert.deepEqual(
      input?.candidates.map((d) => d.id),
      [close.id, exact.id],
    );
  });

  it("deviza: a kartyas terheles eredeti osszege a talalat alapja", () => {
    const huf = doc("2026-05-02", 38488, "Magyar Telekom Nyrt.");
    const input = jevPairInput(
      debit(99.71, "TelekomSzaml*1", {
        currency: "EUR",
        original: { amount: D(38488), currency: "HUF" },
      }),
      outcome(),
      [huf],
    );
    assert.deepEqual(
      input?.candidates.map((d) => d.id),
      [huf.id],
    );
  });

  it("nincs javaslat: talalat nelkul, a Parklnal, megtalalt allapotnal es szamla nelkuli kategorianal", () => {
    const d = doc("2026-05-02", 1999, "Parkl Digital Technologies Kft.");
    assert.equal(jevPairInput(debit(5000, "Senki Bt."), outcome(), [d]), null);
    assert.equal(
      // a Parkl kimarad akkor is, ha mas kiallitotol pontos osszegu szamla allna
      jevPairInput(debit(1999, "SIMPLEP*PARKL.NET"), outcome(), [
        doc("2026-05-02", 1999, "Valaki Más Kft."),
      ]),
      null,
    );
    assert.equal(
      jevPairInput(debit(1999, "Valaki"), outcome("FOUND"), [d]),
      null,
    );
    assert.equal(
      jevPairInput(debit(1999, "Valaki", { category: "TAX" }), outcome(), [d]),
      null,
    );
    assert.notEqual(
      jevPairInput(debit(1999, "Valaki"), outcome("NO_INVOICE"), [d]),
      null,
    );
  });

  it("csak a datumablak szabad szamlai: az elvitt es a brutto nelkuli nem jelolt", () => {
    const taken = doc("2026-05-02", 1999, "Egyik Kft.");
    const noGross = doc("2026-05-02", null, "Masik Kft.");
    const late = doc("2026-07-01", 1999, "Kesoi Kft.");
    const fine = doc("2026-05-03", 1999, "Harmadik Kft.");
    const used = new Map<string, MatchOutcome>([
      ["bt0", { ...outcome("FOUND"), documents: [taken] }],
    ]);
    const free = freeDocuments([taken, noGross, late, fine], used);
    assert.deepEqual(
      free.map((d) => d.id),
      [late.id, fine.id],
    );
    assert.deepEqual(
      jevPairInput(debit(1999, "Valaki"), outcome(), free)?.candidates.map(
        (d) => d.id,
      ),
      [fine.id],
    );
  });

  it("legfeljebb 12 jelolt, de a talalatok mind rajta vannak", () => {
    const hit = doc("2026-05-09", 10000, "Talalat Kft.");
    // mas partnerek 5%-on beluli osszeggel: nem talalatok, csak a lista tolteleke
    const close = Array.from({ length: 20 }, (_, i) =>
      doc(
        `2026-04-${String(i + 1).padStart(2, "0")}`,
        10100 + i,
        `Masik${i} Bt.`,
      ),
    );
    const input = jevPairInput(debit(10000, "Ugyanaz Kft."), outcome(), [
      ...close,
      hit,
    ]);
    assert.equal(input?.candidates.length, 12);
    assert.ok(input?.candidates.some((d) => d.id === hit.id));
  });
});
