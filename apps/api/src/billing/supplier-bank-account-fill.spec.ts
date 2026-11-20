import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideFill,
  formatFillPlan,
  planFills,
  type FillSupplierInput,
} from "./supplier-bank-account-fill.js";

/*
  A KITÖLTÉS DÖNTÉSE (acrobot 58553). MI PIROSÍT: ha egy szállító, akinek már van számlaszáma (bármelyik forrásból), újat kapna; ha két ellentmondó jelölt közül az egyiket írná; ha ugyanaz a
  szám több számláról vagy két forrásból két jelöltnek számítana; ha a PDF és a terhelés ellentmondása elmenne; ha a forrás a terhelés lenne, amikor a PDF is adta; ha a riportban a TELJES
  számlaszám megjelenne; ha az üres szöveg meglévő számlaszámnak számítana.
*/
const A = "1177301611111018";
const B = "1091800100000017";
const supplier = (
  over: Partial<FillSupplierInput> = {},
): FillSupplierInput => ({
  key: "hu:12345678",
  name: "Példa Kft.",
  taxNumber: "12345678-2-13",
  euTaxNumber: null,
  existing: [],
  targetRows: 2,
  pdf: [],
  debit: [],
  ...over,
});
const ev = (account: string, evidenceId: string) => ({ account, evidenceId });

describe("a szállítói számlaszám kitöltésének döntése", () => {
  it("egy PDF-es jelölt: ír, a forrás a PDF, a bizonyíték a dokumentum", () => {
    assert.deepEqual(decideFill(supplier({ pdf: [ev(A, "doc1")] })), {
      state: "WRITE",
      account: A,
      source: "INVOICE_PDF",
      evidenceIds: ["doc1"],
    });
  });

  it("ugyanaz a szám több számláról és két forrásból is egy jelölt; a forrás a PDF, ha a PDF is adta", () => {
    assert.deepEqual(
      decideFill(
        supplier({
          pdf: [ev(A, "doc1"), ev(A, "doc2")],
          debit: [ev(A, "bt1")],
        }),
      ),
      {
        state: "WRITE",
        account: A,
        source: "INVOICE_PDF",
        evidenceIds: ["doc1", "doc2", "bt1"],
      },
    );
  });

  it("csak a korábbi terhelés adja: ír, a forrás a terhelés", () => {
    assert.deepEqual(decideFill(supplier({ debit: [ev(A, "bt1")] })), {
      state: "WRITE",
      account: A,
      source: "PAIRED_DEBIT",
      evidenceIds: ["bt1"],
    });
  });

  it("két különböző számlaszám (két számláról vagy a PDF és a terhelés között): ellentmond, nem ír", () => {
    assert.deepEqual(
      decideFill(supplier({ pdf: [ev(A, "doc1"), ev(B, "doc2")] })),
      { state: "CONFLICT", count: 2 },
    );
    assert.deepEqual(
      decideFill(supplier({ pdf: [ev(A, "doc1")], debit: [ev(B, "bt1")] })),
      { state: "CONFLICT", count: 2 },
    );
  });

  it("ha a szállítónak már van számlaszáma, nem ír (sem eggyel, sem ellentmondóval), és az üres szöveg nem számít annak", () => {
    assert.deepEqual(
      decideFill(supplier({ existing: [B], pdf: [ev(A, "doc1")] })),
      { state: "HAS_ACCOUNT", distinct: 1 },
    );
    assert.deepEqual(
      decideFill(supplier({ existing: [A, B], pdf: [ev(A, "doc1")] })),
      { state: "HAS_ACCOUNT", distinct: 2 },
    );
    assert.equal(
      decideFill(supplier({ existing: ["", ""], pdf: [ev(A, "doc1")] })).state,
      "WRITE",
    );
  });

  it("jelölt nélkül nincs adat", () => {
    assert.deepEqual(decideFill(supplier()), { state: "NONE" });
  });

  it("a terv összesítése és a riport: a teljes számlaszám nem szerepel, csak a vége", () => {
    const plan = planFills([
      supplier({ name: "Ír Kft.", pdf: [ev(A, "doc1")], targetRows: 3 }),
      supplier({ key: "hu:2", name: "Van Kft.", existing: [B] }),
      supplier({
        key: "eu:ATU1",
        name: "Ellentmond GmbH",
        pdf: [ev(A, "d"), ev(B, "e")],
      }),
      supplier({ key: "name:semmi", name: "Semmi" }),
    ]);
    assert.deepEqual(
      [plan.write, plan.hasAccount, plan.conflict, plan.none, plan.rowsFilled],
      [1, 1, 1, 1, 3],
    );
    const text = formatFillPlan(plan, false);
    assert.match(text, /Ír Kft\. \| hu \| sor=3 \| ÍR \.\.\.1018 INVOICE_PDF/);
    assert.match(text, /ELLENTMOND \(2 jelölt\)/);
    assert.match(text, /SZÁRAZ .*semmi nem íródott/);
    assert.equal(text.includes("11773016"), false);
    assert.equal(text.includes("11111018"), false);
  });
});
