import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { main, readCmfxMail } from "./external-invoice-mail-pdf.cli.js";
import {
  cmfxMailAuthenticated,
  cmfxMailQuery,
  fillExternalPdfsFromMail,
  numberFromCmfxFileName,
  textCarriesNumber,
  pdfPayableMatches,
  textCarriesOurTaxNumber,
  type MailPdf,
} from "./external-invoice-mail-pdf.js";

/*
  A KIMENŐ SZÁMLA PDF-JE A CMFX LEVELÉBŐL (kártya 07ec8219). MI PIROSÍT: ha a fájlnévből rossz szám
  jönne; ha egy PDF a szövegében álló szám nélkül tárolódna (félrecímkézett melléklet); ha a száraz
  futás írna; ha egy levél, amelynek nincs számla-sora, csendben elveszne.
*/

// the payable total as pdfTextLines puts it in a line (acrobot's measurement: the label, a cell, the
// amount with plain-space thousands, HUF in its own cell at the other end), matching the default gross
const PAYABLE = "HUF | FIZETENDŐ BRUTTÓ VÉGÖSSZEG: | 29 210";
// an invoice we issued carries our tax number as the issuer's; `ours: false` is another cmfx customer's
const pdf = (
  fileName: string,
  text: string,
  messageId = "m1",
  authenticated = true,
  ours = true,
): MailPdf => ({
  messageId,
  fileName,
  buffer: Buffer.from(
    `%PDF-1.4\n${ours ? "Eladó adószáma: 23916229-2-42\n" : "Eladó adószáma: 11111111-2-41\n"}${text}\n${PAYABLE}\n`,
  ),
  authenticated,
});
const textOf = async (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("utf8").split("\n");
const candidate = (
  id: string,
  documentNumber: string,
  grossAmount = "29210.00",
) => ({
  id,
  documentNumber,
  issueDate: new Date("2026-10-05T00:00:00.000Z"),
  grossAmount,
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
  it("reads the number the cmfx name carries, a hex hash of digits only too, and nothing from another shape", () => {
    assert.deepEqual(
      [
        numberFromCmfxFileName("E-ACRW-2026-00536-17ff96d.pdf"),
        numberFromCmfxFileName("e-ACRW-2026-00512-D501602.PDF"),
        // a 7-digit hex hash of digits only (about 3.7%): still read, not dropped (acrobot, #1777)
        numberFromCmfxFileName("E-ACRW-2026-00537-1234567.pdf"),
        numberFromCmfxFileName("E-ACRW-2026-00538-zz9.pdf"),
        numberFromCmfxFileName("ACRW-2026-00536.pdf"),
        numberFromCmfxFileName("szamla.pdf"),
      ],
      [
        "ACRW-2026/00536",
        "ACRW-2026/00512",
        "ACRW-2026/00537",
        null,
        null,
        null,
      ],
    );
  });

  it("a name without a hash reads a wrong number, and that is visible, never stored", async () => {
    assert.equal(numberFromCmfxFileName("E-ACRW-2026-00536.pdf"), "ACRW/2026");
    const report = await fillExternalPdfsFromMail({
      candidates: [candidate("row-1", "ACRW-2026/00536")],
      pdfs: [pdf("E-ACRW-2026-00536.pdf", "Számla ACRW-2026/00536")],
      apply: true,
      textOf,
      documents: recorder().documents,
      store: recorder().store,
    });
    assert.deepEqual(
      [report.outcomes.map((o) => o.kind), report.notCandidates],
      [["NO_MAIL"], ["ACRW/2026"]],
    );
  });

  it("searches the month's cmfx letters with attachments, ten days past the month", () => {
    assert.equal(
      cmfxMailQuery("2026-10"),
      "from:ertesito@cmfx.hu has:attachment after:2026/10/01 before:2026/11/11",
    );
  });
});

/*
  A LEVÉL EREDETE (barracuda, #1777). MI PIROSÍT: ha a levélben ÁLLÍTOTT feladó vagy egy a küldő által
  beírt, lejjebb álló „mx.google.com” fejléc elég lenne; ha végződés-alapú domain-egyezés átengedné az
  evilcmfx.hu-t; ha a DMARC vagy a DKIM egyedül elég lenne.
*/
describe("the letter really came from cmfx", () => {
  // acrobot's measurement, 2026-10-21: the top header of all five real cmfx letters
  const real =
    "mx.google.com; dkim=pass header.i=@cmfx.hu header.s=cmfx header.b=AbCd; spf=pass (google.com: domain of ertesito@cmfx.hu designates 192.0.2.1 as permitted sender) smtp.mailfrom=ertesito@cmfx.hu; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=cmfx.hu";

  it("the real shape passes, by header.i or header.d", () => {
    assert.equal(cmfxMailAuthenticated([real]), true);
    assert.equal(
      cmfxMailAuthenticated([
        real.replace("header.i=@cmfx.hu", "header.d=cmfx.hu"),
      ]),
      true,
    );
  });

  it("only the TOP header counts, and it must be Gmail's", () => {
    const forged =
      "mx.google.com; dkim=pass header.i=@cmfx.hu; dmarc=pass header.from=cmfx.hu";
    assert.deepEqual(
      [
        cmfxMailAuthenticated([]),
        cmfxMailAuthenticated([
          "relay.example; dkim=pass header.i=@cmfx.hu; dmarc=pass header.from=cmfx.hu",
        ]),
        // the real Gmail verdict says fail; a forged "mx.google.com" line below it must not rescue it
        cmfxMailAuthenticated([
          "mx.google.com; dkim=none; spf=softfail smtp.mailfrom=x@evil.example; dmarc=fail header.from=cmfx.hu",
          forged,
        ]),
        cmfxMailAuthenticated(["hamis.example; x", forged]),
      ],
      [false, false, false, false],
    );
  });

  it("the domain matches exactly: no evilcmfx.hu, no cmfx.hu.evil, no subdomain", () => {
    const top = (dkim: string, from = "cmfx.hu") =>
      cmfxMailAuthenticated([
        `mx.google.com; dkim=pass ${dkim}; dmarc=pass header.from=${from}`,
      ]);
    assert.deepEqual(
      [
        top("header.i=@evilcmfx.hu"),
        top("header.d=evilcmfx.hu"),
        top("header.d=cmfx.hu.evil.example"),
        top("header.i=@mail.cmfx.hu"),
        top("header.i=@cmfx.hu", "evilcmfx.hu"),
        top("header.i=@cmfx.hu"),
      ],
      [false, false, false, false, false, true],
    );
  });

  it("DKIM and DMARC both: either alone is not enough", () => {
    assert.deepEqual(
      [
        cmfxMailAuthenticated([
          "mx.google.com; dkim=pass header.i=@cmfx.hu; dmarc=fail header.from=cmfx.hu",
        ]),
        cmfxMailAuthenticated([
          "mx.google.com; dkim=fail header.i=@cmfx.hu; dmarc=pass header.from=cmfx.hu",
        ]),
        cmfxMailAuthenticated([
          "mx.google.com; spf=pass smtp.mailfrom=ertesito@cmfx.hu",
        ]),
      ],
      [false, false, false],
    );
  });

  it("a forged letter with a good PDF is NOT stored; a real one beside it is", async () => {
    const r = recorder();
    const report = await fillExternalPdfsFromMail({
      candidates: [
        candidate("row-1", "ACRW-2026/00536"),
        candidate("row-2", "ACRW-2026/00537"),
      ],
      pdfs: [
        pdf(
          "E-ACRW-2026-00536-f00.pdf",
          "Számla ACRW-2026/00536",
          "fake",
          false,
        ),
        pdf(
          "E-ACRW-2026-00537-a11.pdf",
          "Számla ACRW-2026/00537",
          "real",
          true,
        ),
      ],
      apply: true,
      textOf,
      documents: r.documents,
      store: r.store,
    });
    assert.deepEqual(
      [
        report.outcomes.map((o) => `${o.kind} ${o.documentNumber}`),
        report.unauthenticatedFiles,
        r.puts,
      ],
      [
        ["NOT_AUTHENTICATED ACRW-2026/00536", "STORED ACRW-2026/00537"],
        1,
        ["external-invoice/row-2/cmfx.pdf"],
      ],
    );
  });

  it("another cmfx customer's invoice with our number in it is NOT_OUR_INVOICE, never stored", async () => {
    const r = recorder();
    const report = await fillExternalPdfsFromMail({
      candidates: [candidate("row-1", "ACRW-2026/00536")],
      pdfs: [
        pdf(
          "E-ACRW-2026-00536-c0ffee.pdf",
          "Számla ACRW-2026/00536",
          "other",
          true,
          false,
        ),
      ],
      apply: true,
      textOf,
      documents: r.documents,
      store: r.store,
    });
    assert.deepEqual(
      [report.outcomes.map((o) => `${o.kind} ${o.documentNumber}`), r.puts],
      [["NOT_OUR_INVOICE ACRW-2026/00536"], []],
    );
  });

  it("our tax number is matched bounded: with its suffix or the HU prefix, not inside a longer number", () => {
    assert.deepEqual(
      [
        textCarriesOurTaxNumber("Adószám: 23916229-2-42"),
        textCarriesOurTaxNumber("EU adószám: HU23916229"),
        textCarriesOurTaxNumber("123916229"),
        textCarriesOurTaxNumber("239162291"),
        textCarriesOurTaxNumber("11111111-2-41"),
      ],
      [true, true, false, false, false],
    );
  });

  // MI PIROSÍT: ha a végösszeget nem a felirat UTÁN keresné (az áfa-sorban is ott állhat), ha
  // kerekítene, vagy ha felirat nélkül is egyezést mondana (a barracuda #1777 utáni szabálya)
  it("the payable total after its label must equal the feed row's gross, in whole forints", () => {
    const line = (amount: string) =>
      `HUF | FIZETENDŐ BRUTTÓ VÉGÖSSZEG: | ${amount}`;
    assert.deepEqual(
      [
        pdfPayableMatches(line("29 210"), "29210.00"),
        pdfPayableMatches(line("129 210"), "129210"),
        pdfPayableMatches(line("950"), "950.0000"),
        // the same number elsewhere (the VAT line), the label with another amount: no match
        pdfPayableMatches(
          `27 % ÁFA: 29 210 HUF (6 210)\n${line("31 000")}`,
          "29210.00",
        ),
        // no label at all, only the number in the text
        pdfPayableMatches("NETTÓ VÉGÖSSZEG: | 29 210", "29210.00"),
        // a longer number after the label is not a match
        pdfPayableMatches(line("29 2100"), "29210"),
        // a non-integer feed amount (a foreign-currency invoice) is never rounded into a match
        pdfPayableMatches(line("29 210"), "29210.40"),
      ],
      [true, true, true, false, false, false, false],
    );
  });

  it("a forged PDF with our number and our tax number but another total is AMOUNT_MISMATCH, never stored", async () => {
    const r = recorder();
    const report = await fillExternalPdfsFromMail({
      candidates: [candidate("row-1", "ACRW-2026/00536", "45000.00")],
      pdfs: [pdf("E-ACRW-2026-00536-f00d.pdf", "Számla ACRW-2026/00536")],
      apply: true,
      textOf,
      documents: r.documents,
      store: r.store,
    });
    assert.deepEqual(
      [report.outcomes.map((o) => `${o.kind} ${o.documentNumber}`), r.puts],
      [["AMOUNT_MISMATCH ACRW-2026/00536"], []],
    );
  });

  it("the number in the PDF text is bounded: no longer number, no letter or digit before it", () => {
    assert.deepEqual(
      [
        textCarriesNumber("Számlaszám: ACRW-2026/00536\n", "ACRW-2026/00536"),
        textCarriesNumber("Számlaszám: ACRW-2026/005360", "ACRW-2026/00536"),
        textCarriesNumber("XACRW-2026/00536", "ACRW-2026/00536"),
        textCarriesNumber("(ACRW-2026/00536)", "ACRW-2026/00536"),
      ],
      [true, false, false, true],
    );
  });
});

describe("reading the cmfx letters from Gmail", () => {
  // MI PIROSÍT: ha az olvasó nem a levél saját ítéletét adná tovább (pl. mindig hitelesnek venné), vagy
  // a keresés nem a hónap cmfx-leveleit kérné
  it("each PDF carries its own letter's verdict; a letter from another sender is left out", async () => {
    const queries: string[] = [];
    const real =
      "mx.google.com; dkim=pass header.i=@cmfx.hu; dmarc=pass header.from=cmfx.hu";
    const messages: Record<string, { sender: string; ar: string[] }> = {
      real: { sender: "ertesito@cmfx.hu", ar: [real] },
      forged: {
        sender: "ertesito@cmfx.hu",
        ar: ["mx.google.com; dkim=none; dmarc=fail header.from=cmfx.hu", real],
      },
      other: { sender: "valaki@example.com", ar: [real] },
    };
    const pdfs = await readCmfxMail(
      {
        async gmailMessageIds(_user, query) {
          queries.push(query);
          return Object.keys(messages);
        },
        async gmailPdfMessage(_user, id) {
          return {
            id,
            receivedAt: null,
            subject: null,
            sender: messages[id]!.sender,
            pdfs: [
              {
                fileName: `E-ACRW-2026-00536-${id === "real" ? "a" : "b"}.pdf`,
                buffer: Buffer.from("%PDF-"),
              },
            ],
            authenticationResults: messages[id]!.ar,
            skippedTooLarge: 0,
          };
        },
      },
      "info@acropora.hu",
      "2026-10",
    );
    assert.deepEqual(queries, [cmfxMailQuery("2026-10")]);
    assert.deepEqual(
      pdfs.map((p) => [p.messageId, p.authenticated]),
      [
        ["real", true],
        ["forged", false],
      ],
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
        pdf("E-ACRW-2026-00536-a1.pdf", "Számla ACRW-2026/00536"),
        // the name says 00538, the content is another invoice: not stored
        pdf("E-ACRW-2026-00538-b2.pdf", "Számla ACRW-2026/00999"),
        {
          messageId: "m3",
          fileName: "E-ACRW-2026-00539-c3.pdf",
          buffer: Buffer.from("<html>"),
          authenticated: true,
        },
        pdf("E-ACRW-2026-00600-d4.pdf", "Számla ACRW-2026/00600"),
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
        pdf("E-ACRW-2026-00536-0dd.pdf", "Számla ACRW-2026/00999", "m1"),
        pdf("E-ACRW-2026-00536-bee.pdf", "Számla ACRW-2026/00536", "m2"),
        pdf("E-ACRW-2026-00540-e.pdf", "Számla ACRW-2026/00540", "m3"),
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
          pdf("E-ACRW-2026-00536-a1.pdf", "ACRW-2026/00536"),
          pdf("E-ACRW-2026-00600-a2.pdf", "ACRW-2026/00600"),
          pdf("E-ACRW-2026-00601-a3.pdf", "ACRW-2026/00601"),
          pdf("E-ACRW-2026-00450-a4.pdf", "ACRW-2026/00450"),
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
