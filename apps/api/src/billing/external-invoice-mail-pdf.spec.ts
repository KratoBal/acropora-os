import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { main } from "./external-invoice-mail-pdf.cli.js";
import {
  cmfxMailQuery,
  fillExternalPdfsFromMail,
  numberFromCmfxFileName,
  type MailPdf,
} from "./external-invoice-mail-pdf.js";

/*
  A KIMENŐ SZÁMLA PDF-JE A CMFX LEVELÉBŐL (kártya 07ec8219). MI PIROSÍT: ha a fájlnévből rossz szám
  jönne; ha egy PDF a szövegében álló szám nélkül tárolódna (félrecímkézett melléklet); ha a száraz
  futás írna; ha egy levél, amelynek nincs számla-sora, csendben elveszne.
*/

const pdf = (fileName: string, text: string, messageId = "m1"): MailPdf => ({
  messageId,
  fileName,
  buffer: Buffer.from(`%PDF-1.4\n${text}\n`),
});
const textOf = async (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("latin1").split("\n");
const candidate = (id: string, documentNumber: string) => ({
  id,
  documentNumber,
  issueDate: new Date("2026-10-05T00:00:00.000Z"),
});

function recorder() {
  const puts: string[] = [];
  const sets: Array<[string, string]> = [];
  return {
    puts,
    sets,
    documents: {
      async put(key: { owner: string; ownerId: string; documentId: string }) {
        puts.push(`${key.owner}/${key.ownerId}/${key.documentId}`);
      },
    },
    store: {
      async setPdf(id: string, key: string) {
        sets.push([id, key]);
      },
    },
  };
}

describe("the invoice number from a cmfx attachment name", () => {
  it("reads the number the cmfx name carries, and nothing from another shape", () => {
    assert.deepEqual(
      [
        numberFromCmfxFileName("E-ACRW-2026-00536-a1b2c3d4.pdf"),
        numberFromCmfxFileName("e-ACRW-2026-00512-ZZ9.PDF"),
        numberFromCmfxFileName("ACRW-2026-00536.pdf"),
        numberFromCmfxFileName("E-ACRW-2026-00536.pdf"),
        numberFromCmfxFileName("szamla.pdf"),
      ],
      ["ACRW-2026/00536", "ACRW-2026/00512", null, null, null],
    );
  });

  it("searches the month's cmfx letters with attachments, ten days past the month", () => {
    assert.equal(
      cmfxMailQuery("2026-10"),
      "from:ertesito@cmfx.hu has:attachment after:2026/10/01 before:2026/11/11",
    );
  });
});

describe("pairing the letters with the month's rows without a PDF", () => {
  it("a dry run says what it would store and writes nothing", async () => {
    const r = recorder();
    const report = await fillExternalPdfsFromMail({
      candidates: [
        candidate("row-1", "ACRW-2026/00536"),
        candidate("row-2", "ACRW-2026/00537"),
        candidate("row-3", "ACRW-2026/00538"),
        candidate("row-4", "ACRW-2026/00539"),
      ],
      pdfs: [
        pdf("E-ACRW-2026-00536-h1.pdf", "Számla ACRW-2026/00536"),
        // the name says 00538, the content is another invoice: not stored
        pdf("E-ACRW-2026-00538-h2.pdf", "Számla ACRW-2026/00999"),
        {
          messageId: "m3",
          fileName: "E-ACRW-2026-00539-h3.pdf",
          buffer: Buffer.from("<html>"),
        },
        pdf("E-ACRW-2026-00600-h4.pdf", "Számla ACRW-2026/00600"),
        pdf("rendeles.pdf", "x"),
      ],
      apply: false,
      textOf,
      documents: r.documents,
      store: r.store,
    });
    assert.deepEqual(
      report.outcomes.map((o) => `${o.kind} ${o.documentNumber}`),
      [
        "WOULD_STORE ACRW-2026/00536",
        "NO_MAIL ACRW-2026/00537",
        "NUMBER_NOT_IN_PDF ACRW-2026/00538",
        "NOT_PDF ACRW-2026/00539",
      ],
    );
    assert.deepEqual(report.notCandidates, ["ACRW-2026/00600"]);
    assert.equal(report.unrecognizedFiles, 1);
    assert.deepEqual([r.puts, r.sets], [[], []]);
  });

  it("applied: stores under the row, the first good PDF of a resent letter wins, a store failure stays on its row", async () => {
    const r = recorder();
    const report = await fillExternalPdfsFromMail({
      candidates: [
        candidate("row-1", "ACRW-2026/00536"),
        candidate("row-2", "ACRW-2026/00540"),
      ],
      pdfs: [
        pdf("E-ACRW-2026-00536-old.pdf", "Számla ACRW-2026/00999", "m1"),
        pdf("E-ACRW-2026-00536-new.pdf", "Számla ACRW-2026/00536", "m2"),
        pdf("E-ACRW-2026-00540-h.pdf", "Számla ACRW-2026/00540", "m3"),
      ],
      apply: true,
      textOf,
      documents: {
        async put(key: { owner: string; ownerId: string; documentId: string }) {
          if (key.ownerId === "row-2") throw new Error("disk full");
          r.puts.push(`${key.owner}/${key.ownerId}/${key.documentId}`);
        },
      },
      store: r.store,
    });
    assert.deepEqual(
      report.outcomes.map((o) => `${o.kind} ${o.documentNumber}`),
      ["STORED ACRW-2026/00536", "STORE_FAILED ACRW-2026/00540"],
    );
    assert.deepEqual(r.puts, ["external-invoice/row-1/cmfx.pdf"]);
    assert.equal(r.sets.length, 1);
    assert.equal(r.sets[0]![0], "row-1");
    assert.match(r.sets[0]![1], /row-1/);
  });
});

describe("external-invoice-mail-pdf:fill", () => {
  const run = async (
    argv: string[],
    overrides: Parameters<typeof main>[2] = {},
  ) => {
    let out = "";
    let err = "";
    const r = recorder();
    const code = await main(
      argv,
      { out: (t) => (out += t), err: (t) => (err += t) },
      {
        candidates: async () => [
          candidate("row-1", "ACRW-2026/00536"),
          candidate("row-2", "ACRW-2026/00537"),
        ],
        mail: async () => [
          pdf("E-ACRW-2026-00536-h1.pdf", "ACRW-2026/00536"),
          pdf("E-ACRW-2026-00600-h2.pdf", "ACRW-2026/00600"),
          pdf("E-ACRW-2026-00601-h3.pdf", "ACRW-2026/00601"),
          pdf("E-ACRW-2026-00450-h4.pdf", "ACRW-2026/00450"),
        ],
        rowsByNumber: async () => [
          {
            documentNumber: "ACRW-2026/00601",
            issueDate: new Date("2026-10-30T00:00:00.000Z"),
            hasPdf: true,
          },
          {
            documentNumber: "ACRW-2026/00450",
            issueDate: new Date("2026-09-28T00:00:00.000Z"),
            hasPdf: false,
          },
        ],
        documents: () => r.documents,
        store: r.store,
        textOf,
        ...overrides,
      },
      {},
    );
    return { code, out, err, r };
  };

  it("dry: lists each row and each letter without a row, writes nothing, exits 1 when there is work", async () => {
    const { code, out, r } = await run(["--month", "2026-10"]);
    assert.equal(code, 1);
    assert.match(out, /^WOULD_STORE\s+ACRW-2026\/00536 \(\d+ bájt\)$/m);
    assert.match(out, /^NO_MAIL\s+ACRW-2026\/00537$/m);
    // the letter whose invoice the feed never brought: said, not dropped
    assert.match(out, /^NINCS_SZAMLA_SOR\s+ACRW-2026\/00600$/m);
    assert.match(out, /^MAR_VAN_PDF\s+ACRW-2026\/00601$/m);
    assert.match(out, /^MASIK_HONAP 2026-09\s+ACRW-2026\/00450$/m);
    assert.match(out, /számla-sor nélküli levél 1/);
    assert.deepEqual([r.puts, r.sets], [[], []]);
  });

  it("applied: stores and exits 0; without a month, or applied without a document store, exits 2", async () => {
    const applied = await run(["--month", "2026-10", "--apply"]);
    assert.equal(applied.code, 0);
    assert.deepEqual(applied.r.puts, ["external-invoice/row-1/cmfx.pdf"]);
    assert.equal((await run([])).code, 2);
    assert.equal((await run(["--month", "2026-13"])).code, 2);
    const noStore = await run(["--month", "2026-10", "--apply"], {
      documents: () => null,
    });
    assert.equal(noStore.code, 2);
    assert.match(noStore.err, /dokumentumtár nincs beállítva/);
  });

  it("without the info@ mail key it stops before reading anything", async () => {
    let out = "";
    let err = "";
    const code = await main(
      ["--month", "2026-10"],
      { out: (t) => (out += t), err: (t) => (err += t) },
      { candidates: async () => [], documents: () => null },
      {},
    );
    assert.equal(code, 2);
    assert.match(err, /levélkulcsa nincs beállítva/);
    assert.equal(out, "");
  });
});
