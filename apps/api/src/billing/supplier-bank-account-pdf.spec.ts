import assert from "node:assert/strict";
import { describe, it } from "node:test";

import PDFKitDocument from "pdfkit";

import { registerEmbeddedPdfFont } from "../documents/pdf/branded-document.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import {
  supplierAccountCandidates,
  supplierAccountVerdict,
} from "./supplier-bank-account-text.js";

/*
  A LÁNC VALÓDI PDF-EN (acrobot 58428: a kalibrálás szintetikus PDF-eken): a pdfkittel előállított számla, a valódi `pdfTextLines` és a kinyerő együtt. MI PIROSÍT: ha a
  táblázatos elrendezés (címke és szám egy sorban, külön cellában; vagy a címke a szám fölött) a PDF-olvasó sorrendjében nem jelöltet adna; ha a címke nélküli számla
  mégis jelöltet adna; ha a második oldalra tett szám az első oldal címkéjét kapná; ha a saját számlaszámunk jelölt lenne.
*/
interface Placed {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly page?: number;
}

function invoicePdf(items: readonly Placed[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFKitDocument({ size: "A4", margin: 40 });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    registerEmbeddedPdfFont(doc);
    const pages = Math.max(0, ...items.map((item) => item.page ?? 0));
    for (let page = 0; page <= pages; page += 1) {
      if (page > 0) doc.addPage();
      for (const item of items.filter((i) => (i.page ?? 0) === page))
        doc.fontSize(10).text(item.text, item.x, item.y, { lineBreak: false });
    }
    doc.end();
  });
}

const read = async (items: readonly Placed[], own: string[] = []) => {
  const lines = await pdfTextLines(new Uint8Array(await invoicePdf(items)));
  return {
    lines,
    candidates: supplierAccountCandidates(lines, own),
  };
};

const HEAD: Placed[] = [
  { text: "Példa Kereskedelmi Kft.", x: 40, y: 40 },
  { text: "Számla sorszáma: PK-2026-0042", x: 40, y: 70 },
];

describe("a bankszámlaszám a valódi PDF-olvasó sorrendjében", () => {
  it("címke és szám egy sorban, külön cellában: egy jelölt, normalizáltan", async () => {
    const { lines, candidates } = await read([
      ...HEAD,
      { text: "Bankszámlaszám:", x: 40, y: 200 },
      { text: "11773016-11111018-00000000", x: 160, y: 200 },
    ]);
    assert.ok(
      lines.some((line) => line.includes(" | 11773016-11111018-00000000")),
      lines.join("\n"),
    );
    assert.deepEqual(
      candidates.map((c) => [c.account, c.label]),
      [["1177301611111018", "BANK"]],
    );
  });

  it("a címke a szám fölötti sorban áll", async () => {
    const { candidates } = await read([
      ...HEAD,
      { text: "Bankszámlaszám", x: 40, y: 200 },
      { text: "11773016-11111018", x: 40, y: 216 },
    ]);
    assert.deepEqual(
      candidates.map((c) => c.account),
      ["1177301611111018"],
    );
  });

  it("IBAN-nal, címkével; a hazai és az IBAN alak ugyanaz a jelölt", async () => {
    const { candidates } = await read([
      ...HEAD,
      { text: "Bankszámlaszám:", x: 40, y: 200 },
      { text: "11773016-11111018-00000000", x: 160, y: 200 },
      { text: "IBAN:", x: 40, y: 216 },
      { text: "HU42 1177 3016 1111 1018 0000 0000", x: 160, y: 216 },
    ]);
    assert.deepEqual(
      supplierAccountVerdict(candidates),
      { state: "ONE", account: "1177301611111018" },
      JSON.stringify(candidates),
    );
  });

  it("címke nélkül, csak egy számmal: nincs jelölt; ellenőrző összeg nélkül sem", async () => {
    const plain = await read([
      ...HEAD,
      { text: "Rendelésszám: 11773016-11111018-00000000", x: 40, y: 200 },
    ]);
    assert.deepEqual(plain.candidates, [], plain.lines.join("\n"));
    const wrong = await read([
      ...HEAD,
      { text: "Bankszámlaszám:", x: 40, y: 200 },
      { text: "11773016-11111019-00000000", x: 160, y: 200 },
    ]);
    assert.deepEqual(wrong.candidates, []);
  });

  it("a második oldal első sora nem kapja az első oldal utolsó sorának címkéjét", async () => {
    const { candidates } = await read([
      ...HEAD,
      { text: "Bankszámlaszám", x: 40, y: 760 },
      { text: "11773016-11111018-00000000", x: 40, y: 40, page: 1 },
    ]);
    assert.deepEqual(candidates, []);
  });

  it("a saját bankszámlánk kiesik, a szállító két számlaszáma marad", async () => {
    const { candidates } = await read(
      [
        ...HEAD,
        { text: "Vevő bankszámlaszáma:", x: 40, y: 200 },
        { text: "11773016-11111018-00000000", x: 200, y: 200 },
        { text: "Szállító bankszámlaszáma:", x: 40, y: 230 },
        { text: "10918001-00000017", x: 200, y: 230 },
        { text: "Szállító IBAN:", x: 40, y: 260 },
        { text: "DE89 3704 0044 0532 0130 00", x: 200, y: 260 },
      ],
      ["1177301611111018"],
    );
    assert.deepEqual(
      candidates.map((c) => c.account),
      // a vevő (saját) számlaszáma nincs köztük; a szállító két számlaszáma (hazai és IBAN) marad
      ["1091800100000017", "DE89370400440532013000"],
    );
  });
});
