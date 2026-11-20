import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractSupplierAccounts,
  formatExtractReport,
  pdfIdsToRead,
  type ExtractDeps,
  type ExtractTarget,
} from "./supplier-bank-account-extract.js";

/*
  A SZÁRAZ MÉRÉS (acrobot 58433). MI PIROSÍT: ha a riportban a TELJES számlaszám megjelenne (csak a vége szabad); ha két különböző számlaszámot adó PDF egy számlára „egy”
  lenne; ha egy számla két PDF-je közül az egyik olvashatatlan és a másik jó, a jó nem számítana; ha a beszkennelt (szöveg nélküli) PDF „nincs” lenne a
  „szöveg nélküli” helyett; ha a saját számlaszámunk jelölt lenne; ha PDF nélküli célsor „nincs”-ként a PDF-fel rendelkezők közé számítana.
*/
const LINES: Record<string, string[]> = {
  one: ["Bankszámlaszám: 11773016-11111018-00000000"],
  same: ["Bank account 11773016 11111018"],
  other: ["IBAN: DE89 3704 0044 0532 0130 00"],
  own: ["Vevő bankszámlaszám: 11773016-11111018-00000000"],
  blank: ["Köszönjük"],
  scan: ["=== oldal vege ==="],
};
const OWN = "1177301611111018";

const deps = (
  targets: ExtractTarget[],
  broken: string[] = [],
  own: readonly string[] = [],
): ExtractDeps => ({
  targets: async () => targets,
  content: async (id) =>
    id === "missing" ? null : new TextEncoder().encode(id),
  lines: async (content) => {
    const id = new TextDecoder().decode(content);
    if (broken.includes(id)) throw new Error("PDF_INVALID");
    return LINES[id] ?? [];
  },
  ownAccounts: async () => own,
});
const target = (id: string, ...pdfIds: string[]): ExtractTarget => ({
  id,
  supplierName: `Szállító ${id}`,
  documentNumber: `SZ-${id}`,
  pdfIds,
});

describe("a bankszámlaszám kinyerésének száraz mérése", () => {
  it("egy PDF egy számlaszámmal: kitölthető; a riportban csak a vége áll", async () => {
    const report = await extractSupplierAccounts(deps([target("a", "one")]));
    assert.equal(report.one, 1);
    assert.deepEqual(report.rows[0]!.verdict, {
      state: "ONE",
      account: "1177301611111018",
    });
    const text = formatExtractReport(report);
    assert.match(text, /EGY \.\.\.1018 HU_ACCOUNT BANK/);
    assert.equal(
      text.includes("11773016"),
      false,
      "a teljes szám nem szivároghat ki",
    );
    assert.equal(text.includes("11111018"), false);
  });

  it("két PDF ugyanazt a számlaszámot adja: egy; két különböző: több jelölt, nincs választás", async () => {
    const same = await extractSupplierAccounts(
      deps([target("a", "one", "same")]),
    );
    assert.equal(same.rows[0]!.verdict.state, "ONE");
    const several = await extractSupplierAccounts(
      deps([target("a", "one", "other")]),
    );
    assert.deepEqual(several.rows[0]!.verdict, { state: "SEVERAL", count: 2 });
    assert.equal(several.several, 1);
    assert.match(formatExtractReport(several), /TÖBB \(2 jelölt\)/);
  });

  it("az olvashatatlan és a szöveg nélküli PDF külön számlálódik, és nem viszi el a jó PDF-et", async () => {
    const report = await extractSupplierAccounts(
      deps(
        [
          target("a", "bad", "one"),
          target("b", "scan"),
          target("c", "missing"),
        ],
        ["bad"],
      ),
    );
    assert.equal(report.rows[0]!.verdict.state, "ONE");
    assert.equal(report.rows[0]!.unreadable, 1);
    assert.equal(report.rows[1]!.verdict.state, "NONE");
    assert.equal(report.rows[1]!.noText, 1);
    assert.equal(report.rows[2]!.unreadable, 1);
    assert.equal(report.unreadable, 2);
    assert.equal(report.noText, 1);
  });

  it("a saját számlaszámunk nem jelölt; PDF nélküli célsor nem számít a PDF-fel rendelkezők közé", async () => {
    const report = await extractSupplierAccounts(
      deps([target("a", "own"), target("b"), target("c", "blank")], [], [OWN]),
    );
    assert.deepEqual(
      report.rows.map((row) => row.verdict.state),
      ["NONE", "NONE", "NONE"],
    );
    assert.equal(report.withPdf, 2);
    assert.equal(report.targets, 3);
  });

  it("a fajta és a címke szerinti összesítés csak a kitölthetőkre számol", async () => {
    const report = await extractSupplierAccounts(
      deps([
        target("a", "one"),
        target("b", "other"),
        target("c", "one", "other"),
      ]),
    );
    assert.deepEqual(report.byKind, { HU_ACCOUNT: 1, IBAN: 1 });
    assert.deepEqual(report.byLabel, { BANK: 2 });
  });
});

/*
  AZ OLVASANDÓ PDF-EK (élő mérés, 2026-11-20): a feed saját dokumentuma, ha nem PDF (`hasPdf` hamis), minden sorhoz egy „nem olvasható PDF”-et adott. MI PIROSÍT: ha a nem PDF feed-dokumentum
  az olvasandók között maradna; ha a valódi PDF-es (hasPdf igaz) feed-dokumentum kiesne; ha a kézzel csatolt vagy a begyűjtött PDF kiesne vagy duplán szerepelne.
*/
describe("az olvasandó PDF-ek egy sorhoz", () => {
  const row = (over: {
    hasPdf?: boolean;
    sourceDocumentId?: string | null;
  }) => ({
    id: "r1",
    documentNumber: "KS-1",
    supplierTaxNumber: "12345678-2-13",
    sourceDocumentId: "feed-doc",
    hasPdf: false,
    ...over,
  });
  const sources = {
    attached: new Map([["r1", ["att-1"]]]),
    // a begyűjtött index kulcsa a számlaszám (nagybetűs) és az adószám-törzs (a lista PDF-jelzésével azonos)
    collected: new Map([["KS-1|12345678", ["col-1", "feed-doc"]]]),
  };

  it("a nem PDF feed-dokumentum kimarad, a csatolt és a begyűjtött marad", () => {
    assert.deepEqual(pdfIdsToRead(row({ hasPdf: false }), sources), [
      "att-1",
      "col-1",
    ]);
  });

  it("a valódi PDF-es feed-dokumentum az olvasandók elején áll, egyszer", () => {
    assert.deepEqual(pdfIdsToRead(row({ hasPdf: true }), sources), [
      "feed-doc",
      "att-1",
      "col-1",
    ]);
  });

  it("feed-dokumentum nélküli sor és üres források: üres lista", () => {
    assert.deepEqual(
      pdfIdsToRead(row({ sourceDocumentId: null }), {
        attached: new Map(),
        collected: new Map(),
      }),
      [],
    );
  });
});
