import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideFill,
  formatFillPlan,
  planFills,
  type FillSupplierInput,
} from "./supplier-bank-account-fill.js";
import { writeFills } from "./supplier-bank-account-fill.loader.js";

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

  it("csak a korábbi terhelés adja, legalább KÉT különböző terhelés: ír, a forrás a terhelés", () => {
    assert.deepEqual(
      decideFill(supplier({ debit: [ev(A, "bt1"), ev(A, "bt2")] })),
      {
        state: "WRITE",
        account: A,
        source: "PAIRED_DEBIT",
        evidenceIds: ["bt1", "bt2"],
      },
    );
  });

  it("egyetlen terhelés PDF nélkül gyenge: tartva, nem ír (egy visszajött utalás kitöltésként visszakerülne); ugyanaz a terhelés kétszer sem két terhelés", () => {
    const held = {
      state: "HOLD",
      reason: "SINGLE_DEBIT",
      account: A,
      source: "PAIRED_DEBIT",
      evidenceIds: ["bt1"],
    };
    assert.deepEqual(decideFill(supplier({ debit: [ev(A, "bt1")] })), held);
    assert.deepEqual(
      decideFill(supplier({ debit: [ev(A, "bt1"), ev(A, "bt1")] })),
      held,
    );
  });

  it("a PDF és egyetlen terhelés együtt elég: a PDF a második jel", () => {
    assert.deepEqual(
      decideFill(supplier({ pdf: [ev(A, "doc1")], debit: [ev(A, "bt1")] })),
      {
        state: "WRITE",
        account: A,
        source: "INVOICE_PDF",
        evidenceIds: ["doc1", "bt1"],
      },
    );
  });

  it("a csak névvel azonosított szállító (name: kulcs) soha nem ír, akárhány jelölt egyezik: két azonos nevű cég egy szállítónak számítana (barracuda #2796)", () => {
    const named = (over: Partial<FillSupplierInput>) =>
      supplier({ key: "name:euro corals", taxNumber: null, ...over });
    for (const over of [
      { pdf: [ev(A, "doc1")] },
      { pdf: [ev(A, "doc1"), ev(A, "doc2")] },
      { debit: [ev(A, "bt1"), ev(A, "bt2")] },
    ])
      assert.deepEqual(
        { ...decideFill(named(over)), evidenceIds: undefined },
        {
          state: "HOLD",
          reason: "NAME_KEY",
          account: A,
          source: over.pdf ? "INVOICE_PDF" : "PAIRED_DEBIT",
          evidenceIds: undefined,
        },
      );
    // ellentmondó jelöltnél a name: kulcs is CONFLICT, meglévő számlaszámnál HAS_ACCOUNT: ezek előbbre valók
    assert.equal(
      decideFill(named({ pdf: [ev(A, "d"), ev(B, "e")] })).state,
      "CONFLICT",
    );
    assert.equal(
      decideFill(named({ existing: [B], pdf: [ev(A, "d")] })).state,
      "HAS_ACCOUNT",
    );
    // az eu: kulcs azonosító (adószám), az ír
    assert.equal(
      decideFill(supplier({ key: "eu:ATU63964918", pdf: [ev(A, "d")] })).state,
      "WRITE",
    );
  });

  it("az írás a tartott és a nem író ítéleteket kihagyja: csak a WRITE megy a táblába", async () => {
    const written: unknown[] = [];
    const plan = planFills([
      supplier({ key: "hu:1", name: "Ír Kft.", pdf: [ev(A, "doc1")] }),
      supplier({ key: "name:x", name: "Név Kft.", pdf: [ev(A, "doc2")] }),
      supplier({
        key: "hu:2",
        name: "Egy terhelés Kft.",
        debit: [ev(B, "bt1")],
      }),
      supplier({
        key: "hu:3",
        name: "Van Kft.",
        existing: [B],
        pdf: [ev(A, "d")],
      }),
      supplier({
        key: "hu:4",
        name: "Ellentmond Kft.",
        pdf: [ev(A, "d"), ev(B, "e")],
      }),
    ]);
    assert.deepEqual([plan.write, plan.hold], [1, 2]);
    const result = await writeFills(
      {
        supplierBankAccountFill: {
          createMany: async ({ data }: { data: unknown[] }) => {
            written.push(...data);
            return { count: data.length };
          },
          findMany: async () => [{ id: "fill-1" }],
        },
      } as unknown as Parameters<typeof writeFills>[0],
      plan,
    );
    assert.deepEqual(
      written.map((row) => (row as { supplierKey: string }).supplierKey),
      ["hu:1"],
    );
    assert.deepEqual(result, { created: 1, ids: ["fill-1"] });
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
      supplier({
        key: "name:egy nev",
        name: "Név szerinti Kft.",
        pdf: [ev(A, "doc9")],
      }),
    ]);
    assert.deepEqual(
      [
        plan.write,
        plan.hold,
        plan.hasAccount,
        plan.conflict,
        plan.none,
        plan.rowsFilled,
      ],
      [1, 1, 1, 1, 1, 3],
    );
    const text = formatFillPlan(plan, false);
    assert.match(text, /Ír Kft\. \| hu \| sor=3 \| ÍR \.\.\.1018 INVOICE_PDF/);
    assert.match(text, /ELLENTMOND \(2 jelölt\)/);
    assert.match(
      text,
      /Név szerinti Kft\. \| name \| sor=2 \| ÍRNA \.\.\.1018 INVOICE_PDF \(NAME_KEY, kézzel/,
    );
    assert.match(text, /SZÁRAZ .*semmi nem íródott/);
    assert.equal(text.includes("11773016"), false);
    assert.equal(text.includes("11111018"), false);
  });
});
