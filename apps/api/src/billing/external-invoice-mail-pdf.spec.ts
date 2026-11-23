import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  CLI_RATE_LIMIT_DELAYS_MS,
  CLI_REQUEST_GAP_MS,
  REQUEST_GAP_MS,
  main,
  readCmfxMail,
  readDriveFolder,
  readOwnMail,
  readUnasLinkPdfs,
  cookieHeaderFrom,
  pdfAddressesIn,
} from "./external-invoice-mail-pdf.cli.js";
import {
  GOOGLE_PDF_MAX_BYTES,
  GoogleReadonlyError,
} from "../integrations/google/google-readonly.client.js";
import {
  authVerdictLine,
  cmfxMailAuthenticated,
  cmfxMailQuery,
  fillExternalPdfsFromMail,
  mailAuthenticatedFor,
  numberFromCmfxFileName,
  textCarriesNumber,
  pdfPayableAmount,
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

  // 785dfea6, acrobot 59264: a storno's payable total is negative ("FIZETENDŐ BRUTTÓ VÉGÖSSZEG: -1 562 100"); the minus is part of the amount,
  // so a negative row matches only a negative PDF, and a sign difference stays a mismatch. WHAT TURNS IT RED: the minus not read (the storno
  // is "no payable line"), or read and dropped (a storno's PDF would match the invoice it cancels).
  it("a storno's negative payable total matches its negative row, and only that", () => {
    const line = (amount: string) =>
      `HUF | FIZETENDŐ BRUTTÓ VÉGÖSSZEG: | ${amount}`;
    assert.deepEqual(
      [
        pdfPayableMatches(line("-1 562 100"), "-1562100.00"),
        pdfPayableMatches(line("\u2212169 990"), "-169990"),
        pdfPayableMatches(line("- 1 714 500"), "-1714500.00"),
        // the sign differs: a storno's PDF never fills the cancelled invoice's row, nor the other way round
        pdfPayableMatches(line("-169 990"), "169990.00"),
        pdfPayableMatches(line("169 990"), "-169990.00"),
      ],
      [true, true, true, false, false],
    );
    assert.equal(pdfPayableAmount(line("-1 562 100")), "-1562100");
    assert.equal(pdfPayableAmount(line("63 373")), "63373");
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
    // both amounts come out, so a person can tell rounding from a wrong invoice (acrobot 58326)
    assert.deepEqual(report.outcomes[0], {
      kind: "AMOUNT_MISMATCH",
      documentNumber: "ACRW-2026/00536",
      expected: "45000.00",
      found: "29210",
    });
    assert.deepEqual(
      [pdfPayableAmount(PAYABLE), pdfPayableAmount("Számla ACRW-2026/00536")],
      ["29210", null],
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

describe("the manual run's pace (785dfea6, acrobot 58354: the 2026-03 --apply hit GOOGLE_RATE_LIMITED twice)", () => {
  it("one second between requests, four times the daily job's gap", () => {
    assert.deepEqual([CLI_REQUEST_GAP_MS, REQUEST_GAP_MS], [1_000, 250]);
  });

  it("waits up to five times after a rate limit, the last one five minutes", () => {
    assert.deepEqual(
      CLI_RATE_LIMIT_DELAYS_MS,
      [10_000, 30_000, 60_000, 120_000, 300_000],
    );
  });
});

/*
  THE UNAS ORDER'S CMFX LINK (785dfea6, acrobot 58359). WHAT TURNS IT RED: a link that is not https://www.cmfx.hu fetched;
  a redirect to another host followed; the link itself printed (it may carry a token); no pause between two fetches; a
  non-PDF answer silently dropped instead of reaching the checks (it must come out as NOT_PDF).
*/
describe("the PDF from the UNAS order's cmfx link", () => {
  const PDF_BYTES = Buffer.from(
    `%PDF-1.4\nEladó adószáma: 23916229-2-42\nACRW-2026/00536\n${PAYABLE}\n`,
  );
  const fetcher = (answers: Record<string, () => Response>) => {
    const calls: string[] = [];
    return {
      calls,
      fetch: async (url: string) => {
        calls.push(url);
        const answer = answers[url];
        if (!answer) throw new Error(`unexpected ${url}`);
        return answer();
      },
    };
  };

  it("fetches only https://www.cmfx.hu, follows a redirect only on that host, pauses between fetches, never prints the link", async () => {
    const f = fetcher({
      "https://www.cmfx.hu/sz/abc?t=SECRET": () =>
        new Response(null, {
          status: 302,
          headers: { location: "/sz/abc.pdf?t=SECRET" },
        }),
      "https://www.cmfx.hu/sz/abc.pdf?t=SECRET": () =>
        new Response(PDF_BYTES, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      "https://www.cmfx.hu/sz/off": () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/x.pdf" },
        }),
      "https://www.cmfx.hu/sz/html": () =>
        new Response("<html>bejelentkezés</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const sleeps: number[] = [];
    let out = "";
    const pdfs = await readUnasLinkPdfs(
      [
        {
          number: "ACRW-2026/00536",
          url: "https://www.cmfx.hu/sz/abc?t=SECRET",
        },
        { number: "ACRW-2026/00537", url: "http://www.cmfx.hu/sz/plain" },
        { number: "ACRW-2026/00538", url: "https://cmfx.hu.evil.example/x" },
        { number: "ACRW-2026/00539", url: "https://www.cmfx.hu/sz/off" },
        { number: "ACRW-2026/00540", url: "https://www.cmfx.hu/sz/html" },
      ],
      f.fetch as never,
      (line) => (out += line),
      async (ms) => {
        sleeps.push(ms);
      },
    );
    assert.deepEqual(f.calls, [
      "https://www.cmfx.hu/sz/abc?t=SECRET",
      "https://www.cmfx.hu/sz/abc.pdf?t=SECRET",
      "https://www.cmfx.hu/sz/off",
      "https://www.cmfx.hu/sz/html",
    ]);
    assert.deepEqual(sleeps, [2_000, 2_000]);
    assert.deepEqual(
      pdfs.map((p) => [p.fileName, p.authenticated, p.buffer.length]),
      [
        ["E-ACRW-2026-00536-0.pdf", true, PDF_BYTES.length],
        ["E-ACRW-2026-00540-0.pdf", true, 27],
      ],
    );
    assert.equal(numberFromCmfxFileName(pdfs[0]!.fileName), "ACRW-2026/00536");
    assert.doesNotMatch(out, /SECRET|sz\/|evil/);
    assert.match(
      out,
      /^LINK ACRW-2026\/00536 HTTP 200 application\/pdf \d+ bájt PDF$/m,
    );
    assert.match(
      out,
      /^LINK ACRW-2026\/00537 nem cmfx https-cím, nem kértem le$/m,
    );
    assert.match(out, /^LINK ACRW-2026\/00539 átirányítás nem cmfx-címre/m);
    assert.match(
      out,
      /^LINK ACRW-2026\/00540 HTTP 200 text\/html 27 bájt nem PDF$/m,
    );
  });

  /*
    THE VAADIN APP BEHIND THE LINK (785dfea6; acrobot 58716-58769): the link answers HTML, the app makes the PDF on its
    first UIDL request. WHAT TURNS IT RED: the UIDL step not a POST with the init body and the page's session cookie; the
    PDF address missed because the JSON escapes its slashes; an address off the cmfx host requested; a cookie with an
    Expires date (a comma inside) split wrong; the link or its token printed; a failed app step dropping the row instead of
    letting it reach the checks as NOT_PDF.
  */
  const vaadin = (uidlAnswer: string, pdfAnswer?: () => Response) => {
    const calls: {
      url: string;
      method: string;
      body?: string;
      cookie?: string;
    }[] = [];
    const fetch = async (
      url: string,
      init: { method: string; headers: Record<string, string>; body?: string },
    ) => {
      calls.push({
        url: url.replace(/curdate=\d+/, "curdate=N"),
        method: init.method,
        body: init.body,
        cookie: init.headers.Cookie,
      });
      if (url === "https://www.cmfx.hu/FxPrint/?t=SECRET")
        return new Response("<html>FxPrint</html>", {
          status: 200,
          headers: {
            "content-type": "text/html;charset=UTF-8",
            "set-cookie":
              "JSESSIONID=abc123; Path=/FxPrint, lang=hu; Expires=Thu, 01 Jan 2027 00:00:00 GMT; Path=/",
          },
        });
      if (url.startsWith("https://www.cmfx.hu/FxPrint/UIDL?"))
        return new Response(uidlAnswer, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url === "https://www.cmfx.hu/jx/tmp/ACROPORA/a1b2c3.pdf" && pdfAnswer)
        return pdfAnswer();
      throw new Error(`unexpected ${url}`);
    };
    return { calls, fetch };
  };
  const link = [
    { number: "ACRW-2026/00536", url: "https://www.cmfx.hu/FxPrint/?t=SECRET" },
  ];

  it("the Vaadin app: a UIDL init POST with the page's cookie, the escaped .pdf address read, and the PDF taken from it", async () => {
    const v = vaadin(
      'for(;;);[{"Vaadin-Security-Key":"da62bef","changes":[["change",{},["open",{"src":"\\/jx\\/tmp\\/ACROPORA\\/a1b2c3.pdf","name":"_self"}]]]}]',
      () =>
        new Response(PDF_BYTES, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
    );
    let out = "";
    const pdfs = await readUnasLinkPdfs(
      link,
      v.fetch as never,
      (line) => (out += line),
      async () => undefined,
    );
    assert.deepEqual(
      v.calls.map((c) => [c.method, c.url.split("?")[0], c.body, c.cookie]),
      [
        ["GET", "https://www.cmfx.hu/FxPrint/", undefined, undefined],
        [
          "POST",
          "https://www.cmfx.hu/FxPrint/UIDL",
          "init\u001d",
          "JSESSIONID=abc123; lang=hu",
        ],
        [
          "GET",
          "https://www.cmfx.hu/jx/tmp/ACROPORA/a1b2c3.pdf",
          undefined,
          "JSESSIONID=abc123; lang=hu",
        ],
      ],
    );
    assert.match(
      v.calls[1]!.url,
      /\?repaintAll=1&sh=720&sw=1280&.*&wsver=6\.8\.13$/,
    );
    assert.deepEqual(
      pdfs.map((p) => [p.fileName, p.buffer.equals(PDF_BYTES)]),
      [["E-ACRW-2026-00536-0.pdf", true]],
    );
    assert.match(out, /^LINK ACRW-2026\/00536 Vaadin: PDF \d+ bájt$/m);
    assert.doesNotMatch(out, /SECRET|FxPrint|jx\/tmp|abc123/);
  });

  it("a .pdf address off the cmfx host is not requested, and the row still reaches the checks (as NOT_PDF)", async () => {
    const v = vaadin(
      'for(;;);[{"open":[{"src":"https:\\/\\/evil.example\\/x.pdf"}]}]',
    );
    let out = "";
    const pdfs = await readUnasLinkPdfs(
      link,
      v.fetch as never,
      (line) => (out += line),
      async () => undefined,
    );
    assert.equal(v.calls.length, 2);
    assert.match(
      out,
      /^LINK ACRW-2026\/00536 Vaadin: a PDF-cím nem cmfx https-cím, nem kértem le$/m,
    );
    assert.deepEqual(
      pdfs.map((p) => p.buffer.toString()),
      ["<html>FxPrint</html>"],
    );
  });

  it("an answer without a .pdf address says so", async () => {
    const v = vaadin('for(;;);[{"changes":[]}]');
    let out = "";
    await readUnasLinkPdfs(
      link,
      v.fetch as never,
      (line) => (out += line),
      async () => undefined,
    );
    assert.match(
      out,
      /^LINK ACRW-2026\/00536 Vaadin: nincs \.pdf-cím a UIDL-válaszban$/m,
    );
  });

  it("cookieHeaderFrom keeps the pairs, also past an Expires date's comma; pdfAddressesIn reads escaped slashes", () => {
    assert.equal(
      cookieHeaderFrom(
        "JSESSIONID=abc; Path=/FxPrint; HttpOnly, lang=hu; Expires=Thu, 01 Jan 2027 00:00:00 GMT",
      ),
      "JSESSIONID=abc; lang=hu",
    );
    assert.equal(cookieHeaderFrom(null), "");
    assert.deepEqual(
      pdfAddressesIn(
        'for(;;);[{"a":["x","\\/jx\\/tmp\\/b.pdf"],"b":{"c":"d.pdf?x=1"}}]',
      ),
      ["/jx/tmp/b.pdf", "d.pdf?x=1"],
    );
    assert.deepEqual(pdfAddressesIn("nem json"), []);
  });

  it("a failed fetch names only the error's name and code, never its message (it may carry the link)", async () => {
    let out = "";
    const pdfs = await readUnasLinkPdfs(
      [
        {
          number: "ACRW-2026/00536",
          url: "https://www.cmfx.hu/sz/abc?t=SECRET",
        },
      ],
      (async () => {
        throw Object.assign(
          new Error("connect failed to https://www.cmfx.hu/sz/abc?t=SECRET"),
          { name: "Error", code: "ECONNRESET" },
        );
      }) as never,
      (line) => (out += line),
      async () => undefined,
    );
    assert.deepEqual(pdfs, []);
    assert.equal(out, "LINK ACRW-2026/00536 hiba: Error ECONNRESET\n");
  });

  it("main --unas-link: the rows' links, the same checks, WOULD_STORE on a dry run; not together with --dir", async () => {
    let out = "";
    const linksAsked: string[][] = [];
    const code = await main(
      ["--month", "2026-01", "--unas-link"],
      { out: (t) => (out += t), err: () => undefined },
      {
        candidates: async () => [candidate("row-1", "ACRW-2026/00536")],
        unasLinks: async (numbers) => {
          linksAsked.push([...numbers]);
          return [{ number: "ACRW-2026/00536", url: "https://www.cmfx.hu/a" }];
        },
        fetchPdf: (async () =>
          new Response(PDF_BYTES, { status: 200 })) as never,
        sleep: async () => undefined,
        rowsByNumber: async () => [],
        ownInvoicesByNumber: async () => [],
        textOf,
      },
      {},
    );
    assert.equal(code, 1);
    assert.deepEqual(linksAsked, [["ACRW-2026/00536"]]);
    assert.match(out, /^Link az UNAS-rendelésekből \(2026-01\): 1 PDF/m);
    assert.match(out, /^WOULD_STORE\s+ACRW-2026\/00536 \(\d+ bájt\)$/m);
    let err = "";
    assert.equal(
      await main(
        ["--month", "2026-01", "--unas-link", "--dir", "/x"],
        { out: () => undefined, err: (t) => (err += t) },
        {},
        {},
      ),
      2,
    );
    assert.match(err, /egyszerre csak az egyik/);
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
        ownInvoicesByNumber: async () => [],
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

  // 785dfea6, acrobot 58556: a letter whose number is the OS's own outbound invoice (the webshop's ACRW from the UNAS sync) is
  // not a missing row; it is named, and only the rest is counted as missing. The lookup is asked only for the row-less numbers.
  it("dry: a letter whose number is the OS's own invoice says so, and is not counted as a missing row", async () => {
    const asked: string[][] = [];
    const { out } = await run(["--month", "2026-10"], {
      ownInvoicesByNumber: async (numbers) => {
        asked.push([...numbers]);
        // written differently than the letter: the key ignores spaces and case
        return [{ invoiceNumber: "acrw-2026/ 00600", source: "UNAS" }];
      },
    });
    assert.deepEqual(asked, [["ACRW-2026/00600"]]);
    assert.match(out, /^SAJAT_SZAMLA UNAS\s+ACRW-2026\/00600$/m);
    assert.doesNotMatch(out, /^NINCS_SZAMLA_SOR/m);
    assert.match(
      out,
      /saját \(OS\) számla levele 1, számla-sor nélküli levél 0/,
    );
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

  /*
    THE INVOICES WITHOUT A LETTER (Balázs 2026-10-21: the 2026/ series is issued in cmfx but not always mailed).
    `--dir` reads the PDFs the fleet's cmfx downloader saved, named in the letter attachment's shape. WHAT TURNS
    RED: the folder is not read, its file names do not map to the numbers, a non-PDF file is taken, the checks
    (number, our tax number, payable total) are skipped for it, or it stores under another key than the letter's.
  */
  it("--dir: the folder's PDFs instead of the letters, the same checks and the same store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cmfx-dir-"));
    try {
      await writeFile(
        join(dir, "E-2026-00082-0.pdf"),
        pdf("E-2026-00082-0.pdf", "2026/00082").buffer,
      );
      await writeFile(
        join(dir, "E-ACRW-2026-00518-0.pdf"),
        pdf("E-ACRW-2026-00518-0.pdf", "ACRW-2026/00518", "m", true, false)
          .buffer,
      );
      await writeFile(join(dir, "jegyzet.txt"), "nem pdf");
      const go = async (argv: string[]) => {
        let out = "";
        let err = "";
        const r = recorder();
        const code = await main(
          argv,
          { out: (t) => (out += t), err: (t) => (err += t) },
          {
            candidates: async () => [
              candidate("row-82", "2026/00082"),
              candidate("row-518", "ACRW-2026/00518"),
              candidate("row-83", "2026/00083"),
            ],
            rowsByNumber: async () => [],
            ownInvoicesByNumber: async () => [],
            documents: () => r.documents,
            store: r.store,
            textOf,
          },
          {},
        );
        return { code, out, err, r };
      };
      const dry = await go(["--month", "2026-10", "--dir", dir]);
      assert.equal(dry.code, 1);
      assert.match(dry.out, /^Fájl a .* mappából \(2026-10\): 2 PDF/m);
      assert.match(dry.out, /^WOULD_STORE\s+2026\/00082 \(\d+ bájt\)$/m);
      // another cmfx customer's PDF in the folder: refused as in the letter path
      assert.match(dry.out, /^NOT_OUR_INVOICE\s+ACRW-2026\/00518$/m);
      assert.match(dry.out, /^NO_MAIL\s+2026\/00083$/m);
      // each file with its size and fingerprint, to compare with the downloader's lines
      assert.match(
        dry.out,
        /^FAJL E-2026-00082-0\.pdf \d+ bájt sha256:[0-9a-f]{16}$/m,
      );
      assert.deepEqual(dry.r.puts, []);
      const applied = await go(["--month", "2026-10", "--dir", dir, "--apply"]);
      assert.deepEqual(applied.r.puts, ["external-invoice/row-82/cmfx.pdf"]);
      assert.equal((await go(["--month", "2026-10", "--dir"])).code, 2);
      // the flag after --dir is not a folder: refused before anything, not read as one
      const swapped = await go(["--month", "2026-10", "--dir", "--apply"]);
      assert.deepEqual([swapped.code, swapped.r.puts], [2, []]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

/*
  ONE NAMED MAIL OF OUR OWN DOMAIN (785dfea6, acrobot 59000): Luca's monthly "nyomtatandó csomag" mails carry the cmfx PDFs as
  attachments, named without "E-". WHAT TURNS IT RED: a mail from another domain, a look-alike domain or a subdomain, or one whose
  top Gmail verdict is not DKIM and DMARC pass for acropora.hu, read as authentic; the "E-" prefix not added (the number would not
  be read) or added twice; --mail-id searching the month instead of reading the one mail; a bad id or a second source accepted.
*/
describe("one named mail of our own domain (--mail-id)", () => {
  const own =
    "mx.google.com; dkim=pass header.i=@acropora.hu header.s=google header.b=AbCd; spf=pass smtp.mailfrom=luca@acropora.hu; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=acropora.hu";
  const cmfx =
    "mx.google.com; dkim=pass header.i=@cmfx.hu; dmarc=pass header.from=cmfx.hu";

  it("our domain's verdict passes exactly: no look-alike, no suffix, no other domain's pass, only the top header", () => {
    assert.equal(mailAuthenticatedFor([own], "acropora.hu"), true);
    assert.equal(
      mailAuthenticatedFor(
        [own.replaceAll("acropora.hu", "evilacropora.hu")],
        "acropora.hu",
      ),
      false,
    );
    assert.equal(
      mailAuthenticatedFor(
        [own.replaceAll("acropora.hu", "acropora.hu.evil")],
        "acropora.hu",
      ),
      false,
    );
    assert.equal(mailAuthenticatedFor([cmfx], "acropora.hu"), false);
    assert.equal(
      mailAuthenticatedFor(
        ["mx.google.com; dkim=none; dmarc=fail header.from=acropora.hu", own],
        "acropora.hu",
      ),
      false,
    );
    // the cmfx check is the same test for cmfx.hu, unchanged
    assert.equal(cmfxMailAuthenticated([cmfx]), true);
    assert.equal(cmfxMailAuthenticated([own]), false);
  });

  const google = (
    mails: Record<
      string,
      { sender: string | null; ar: string[]; names: string[]; text?: string }
    >,
    asked: string[] = [],
  ) => ({
    async gmailMessageIds(): Promise<string[]> {
      throw new Error("--mail-id must not search");
    },
    async gmailPdfMessage(_user: string, id: string) {
      asked.push(id);
      const mail = mails[id]!;
      return {
        id,
        receivedAt: null,
        subject: null,
        sender: mail.sender,
        pdfs: mail.names.map((fileName) => ({
          fileName,
          buffer: pdf(fileName, mail.text ?? "Számla sorszáma: 2026/00002")
            .buffer,
        })),
        authenticationResults: mail.ar,
        skippedTooLarge: 0,
      };
    },
  });

  it("readOwnMail: authentic only from @acropora.hu with our pass; the E- prefix added once", async () => {
    const g = google({
      luca: {
        sender: "luca@acropora.hu",
        ar: [own],
        names: ["2026-00002-1048133.pdf", "E-2026-00078-622273.pdf"],
      },
      outside: {
        sender: "luca@gmail.com",
        ar: [own],
        names: ["2026-00002-1048133.pdf"],
      },
      sub: {
        sender: "luca@sub.acropora.hu",
        ar: [own],
        names: ["2026-00002-1048133.pdf"],
      },
      cmfxPass: {
        sender: "luca@acropora.hu",
        ar: [cmfx],
        names: ["2026-00002-1048133.pdf"],
      },
      noSender: { sender: null, ar: [own], names: ["2026-00002-1048133.pdf"] },
    });
    const luca = await readOwnMail(g, "info@acropora.hu", "luca");
    assert.deepEqual(
      luca.map((p) => [p.messageId, p.fileName, p.authenticated]),
      [
        ["luca", "E-2026-00002-1048133.pdf", true],
        ["luca", "E-2026-00078-622273.pdf", true],
      ],
    );
    assert.equal(numberFromCmfxFileName(luca[0]!.fileName), "2026/00002");
    for (const id of ["outside", "sub", "cmfxPass", "noSender"])
      assert.deepEqual(
        (await readOwnMail(g, "info@acropora.hu", id)).map(
          (p) => p.authenticated,
        ),
        [false],
        id,
      );
  });

  const go = async (
    argv: string[],
    mails: Parameters<typeof google>[0],
    asked: string[] = [],
  ) => {
    let out = "";
    let err = "";
    const r = recorder();
    const code = await main(
      argv,
      { out: (t) => (out += t), err: (t) => (err += t) },
      {
        google: google(mails, asked),
        candidates: async () => [candidate("row-2", "2026/00002")],
        rowsByNumber: async () => [],
        ownInvoicesByNumber: async () => [],
        documents: () => r.documents,
        store: r.store,
        textOf,
      },
      {},
    );
    return { code, out, err, r };
  };

  it("main --mail-id: reads the one mail, the same checks; an unauthentic one stores nothing; a bad id or a second source is refused", async () => {
    const asked: string[] = [];
    const luca = {
      "19c20725a72c042a": {
        sender: "luca@acropora.hu",
        ar: [own],
        names: ["2026-00002-1048133.pdf"],
      },
    };
    const dry = await go(
      ["--month", "2026-01", "--mail-id", "19c20725a72c042a"],
      luca,
      asked,
    );
    assert.equal(dry.code, 1);
    assert.deepEqual(asked, ["19c20725a72c042a"]);
    assert.match(
      dry.out,
      /^A 19c20725a72c042a levél \(2026-01\): 1 PDF, hiteles acropora\.hu feladó; PDF nélküli feed-sor: 1$/m,
    );
    // the verdict line: what Gmail's top header says, domains only (acrobot 59099)
    assert.match(
      dry.out,
      /^Ítélet: feladó-domain acropora\.hu; Authentication-Results 1 db; legfelső: mx\.google\.com; dkim=pass \(acropora\.hu\); spf=pass \(acropora\.hu\); dmarc=pass \(acropora\.hu\)$/m,
    );
    assert.doesNotMatch(dry.out, /luca/);
    assert.match(
      dry.out,
      /^FAJL E-2026-00002-1048133\.pdf \d+ bájt sha256:[0-9a-f]{16}$/m,
    );
    assert.match(dry.out, /^WOULD_STORE\s+2026\/00002 \(\d+ bájt\)$/m);
    assert.deepEqual(dry.r.puts, []);

    const applied = await go(
      ["--month", "2026-01", "--mail-id", "19c20725a72c042a", "--apply"],
      luca,
    );
    assert.deepEqual(
      [applied.code, applied.r.sets],
      [0, [["row-2", applied.r.sets[0]?.[1] ?? ""]]],
    );
    assert.equal(applied.r.puts.length, 1);

    const forged = await go(
      ["--month", "2026-01", "--mail-id", "f0f0f0f0", "--apply"],
      {
        f0f0f0f0: {
          sender: "luca@acropora.hu",
          ar: [cmfx],
          names: ["2026-00002-1048133.pdf"],
        },
      },
    );
    assert.equal(forged.code, 3);
    assert.match(forged.out, /NEM hiteles acropora\.hu feladó/);
    assert.match(forged.out, /^NOT_AUTHENTICATED\s+2026\/00002/m);
    assert.match(forged.out, /nem acropora\.hu-aláírású, nem tárolódik/);
    assert.deepEqual([forged.r.puts, forged.r.sets], [[], []]);

    for (const argv of [
      ["--month", "2026-01", "--mail-id", "nem-azonosito"],
      ["--month", "2026-01", "--mail-id", "--apply"],
      ["--month", "2026-01", "--mail-id"],
      ["--month", "2026-01", "--mail-id", "19c20725a72c042a", "--dir", "/x"],
      ["--month", "2026-01", "--mail-id", "19c20725a72c042a", "--unas-link"],
    ]) {
      const refused = await go(argv, luca);
      assert.deepEqual([refused.code, refused.r.puts], [2, []], argv.join(" "));
    }
  });
});

/*
  ONE NAMED DRIVE FOLDER (--drive-folder; 785dfea6, acrobot 59127, 59129): the outbound PDFs on the fleet's machine reach the production
  store through a Drive folder the read-only key sees. WHAT TURNS IT RED: another folder read, or the folder not read; the "E-" prefix
  not added (the number would not be read) or added twice; a control character in a name reaching the output; a too-large file stopping
  the run or vanishing unsaid; another Drive error swallowed; the checks skipped; a bad id, a missing key or a second source accepted.
*/
describe("one named Drive folder (--drive-folder)", () => {
  const folder = "1AbCdEfGhIjKlMnOp_q-r";
  type FakeFile = {
    name: string;
    body?: Buffer;
    error?: Error;
    size?: number;
  };
  const drive = (files: Record<string, FakeFile>, asked: string[] = []) => ({
    async driveFolderPdfs(id: string) {
      asked.push(id);
      return Object.entries(files).map(([fileId, file]) => ({
        id: fileId,
        name: file.name,
        modifiedAt: null,
        sizeBytes: file.size ?? null,
      }));
    },
    async driveFile(id: string) {
      const file = files[id]!;
      if (file.error) throw file.error;
      return file.body!;
    },
  });

  it("readDriveFolder: by name, the E- prefix added once, control characters out, a too-large file named and skipped", async () => {
    const lines: string[] = [];
    const pdfs = await readDriveFolder(
      drive({
        b: {
          name: "E-2026-00082-0.pdf",
          body: pdf("x", "2026/00082").buffer,
        },
        a: {
          name: "2026-00002-1048133.pdf",
          body: pdf("x", "2026/00002").buffer,
        },
        c: {
          name: "nagy\nWOULD_STORE.pdf",
          error: new GoogleReadonlyError("GOOGLE_FILE_TOO_LARGE"),
        },
      }),
      folder,
      (line) => lines.push(line),
    );
    assert.deepEqual(
      pdfs.map((p) => [p.messageId, p.fileName, p.authenticated]),
      [
        ["drive:a", "E-2026-00002-1048133.pdf", true],
        ["drive:b", "E-2026-00082-0.pdf", true],
      ],
    );
    assert.deepEqual(lines, [
      "DRIVE nagy?WOULD_STORE.pdf túl nagy, kihagyva\n",
    ]);
    // the listing's size decides before a download; a C1 control character and a line separator are taken out too (barracuda #2810)
    const listed: string[] = [];
    assert.deepEqual(
      await readDriveFolder(
        drive({
          big: {
            name: "nagy\u009b\u2028lista.pdf",
            size: GOOGLE_PDF_MAX_BYTES + 1,
            error: new Error("a listázás szerint túl nagy fájlt nem tölt le"),
          },
        }),
        folder,
        (line) => listed.push(line),
      ),
      [],
    );
    assert.deepEqual(listed, ["DRIVE nagy??lista.pdf túl nagy, kihagyva\n"]);
    await assert.rejects(
      readDriveFolder(
        drive({
          a: {
            name: "E-2026-00082-0.pdf",
            error: new GoogleReadonlyError("GOOGLE_RATE_LIMITED"),
          },
        }),
        folder,
      ),
      /GOOGLE_RATE_LIMITED/,
    );
  });

  const go = async (
    argv: string[],
    files: Record<string, FakeFile>,
    asked: string[] = [],
    environment: NodeJS.ProcessEnv = {},
    withDrive = true,
  ) => {
    let out = "";
    let err = "";
    const r = recorder();
    const code = await main(
      argv,
      { out: (t) => (out += t), err: (t) => (err += t) },
      {
        ...(withDrive ? { drive: drive(files, asked) } : {}),
        candidates: async () => [
          candidate("row-2", "2026/00002"),
          candidate("row-518", "ACRW-2026/00518"),
          candidate("row-3", "2026/00003"),
        ],
        rowsByNumber: async () => [],
        ownInvoicesByNumber: async () => [],
        documents: () => r.documents,
        store: r.store,
        textOf,
      },
      environment,
    );
    return { code, out, err, r };
  };

  it("main --drive-folder: reads the named folder, the same checks and the same store; a bad id, no key or a second source is refused", async () => {
    const files = {
      f1: {
        name: "2026-00002-1048133.pdf",
        body: pdf("x", "2026/00002").buffer,
      },
      f2: {
        name: "E-ACRW-2026-00518-0.pdf",
        body: pdf("x", "ACRW-2026/00518", "m", true, false).buffer,
      },
    };
    const asked: string[] = [];
    const dry = await go(
      ["--month", "2026-01", "--drive-folder", folder],
      files,
      asked,
    );
    assert.equal(dry.code, 1);
    assert.deepEqual(asked, [folder]);
    assert.match(
      dry.out,
      /^Fájl a 1AbCdEfGhIjKlMnOp_q-r Drive-mappából \(2026-01\): 2 PDF; PDF nélküli feed-sor: 3$/m,
    );
    assert.match(
      dry.out,
      /^FAJL E-2026-00002-1048133\.pdf \d+ bájt sha256:[0-9a-f]{16}$/m,
    );
    assert.match(dry.out, /^WOULD_STORE\s+2026\/00002 \(\d+ bájt\)$/m);
    // another cmfx customer's PDF in the folder: refused as in the letter path
    assert.match(dry.out, /^NOT_OUR_INVOICE\s+ACRW-2026\/00518$/m);
    assert.match(dry.out, /^NO_MAIL\s+2026\/00003$/m);
    assert.deepEqual([dry.r.puts, dry.r.sets], [[], []]);

    const applied = await go(
      ["--month", "2026-01", "--drive-folder", folder, "--apply"],
      files,
    );
    assert.equal(applied.code, 3);
    assert.deepEqual(applied.r.puts, ["external-invoice/row-2/cmfx.pdf"]);

    for (const argv of [
      ["--month", "2026-01", "--drive-folder", "rovid"],
      ["--month", "2026-01", "--drive-folder", "--apply"],
      // a flag long enough to pass the id's shape is still no folder (barracuda #2810)
      ["--month", "2026-01", "--drive-folder", "--valami-hosszu"],
      ["--month", "2026-01", "--drive-folder"],
      ["--month", "2026-01", "--drive-folder", folder, "--dir", "/x"],
      ["--month", "2026-01", "--drive-folder", folder, "--unas-link"],
      [
        "--month",
        "2026-01",
        "--drive-folder",
        folder,
        "--mail-id",
        "19c20725a72c042a",
      ],
    ]) {
      const refused = await go(argv, files, asked);
      assert.deepEqual([refused.code, refused.r.puts], [2, []], argv.join(" "));
    }
    // the refused runs read nothing: only the dry run's one listing is here
    assert.deepEqual(asked, [folder]);

    // without the Drive key it stops before reading anything; the info@ key does not stand in for it
    const noKey = await go(
      ["--month", "2026-01", "--drive-folder", folder],
      files,
      asked,
      {
        GMAIL_SUPPLIER_INVOICE_CLIENT_ID: "id",
        GMAIL_SUPPLIER_INVOICE_CLIENT_SECRET: "secret",
        GMAIL_SUPPLIER_INVOICE_REFRESH_TOKEN: "token",
      },
      false,
    );
    assert.equal(noKey.code, 2);
    assert.match(noKey.err, /Drive csak olvasó kulcsa nincs beállítva/);
    assert.equal(noKey.out, "");
  });
});

/*
  THE VERDICT LINE (785dfea6, acrobot 59099: the first live dry run said "NEM hiteles" for all three of Luca's mails, and nothing said why).
  WHAT TURNS IT RED: a missing header read as present, or a top header without verdicts printed as one; a local part (an address) printed;
  a forged top header's text printed unfiltered.
*/
describe("the mail's verdict line", () => {
  it("names the count, the top header's service and each method with its domain, never an address", () => {
    const line = authVerdictLine(
      [
        "mx.google.com; dkim=pass header.i=@acropora.hu header.s=google; spf=pass (google.com: domain of luca@acropora.hu designates 192.0.2.1 as permitted sender) smtp.mailfrom=luca@acropora.hu; dmarc=pass (p=NONE) header.from=acropora.hu",
        "other.example; dkim=fail",
      ],
      "luca@acropora.hu",
    );
    assert.equal(
      line,
      "Ítélet: feladó-domain acropora.hu; Authentication-Results 2 db; legfelső: mx.google.com; dkim=pass (acropora.hu); spf=pass (acropora.hu); dmarc=pass (acropora.hu)",
    );
    assert.doesNotMatch(line, /luca/);
  });

  it("no header at all, and a top header with no verdict in it, are told apart", () => {
    assert.equal(
      authVerdictLine([], "luca@acropora.hu"),
      "Ítélet: feladó-domain acropora.hu; Authentication-Results 0 db; legfelső: nincs",
    );
    assert.equal(
      authVerdictLine(["mx.google.com"], null),
      "Ítélet: feladó-domain -; Authentication-Results 1 db; legfelső: mx.google.com; nincs benne ítélet",
    );
  });

  it("a forged top header's text is narrowed to plain domain characters", () => {
    const line = authVerdictLine(
      ["evil<b>\u001b[31m; dkim=pass header.d=acro<x>pora.hu\u001b[0m"],
      "x@acropora.hu",
    );
    assert.equal(
      line,
      "Ítélet: feladó-domain acropora.hu; Authentication-Results 1 db; legfelső: evilb31m; dkim=pass (acroxpora.hu0m)",
    );
    assert.doesNotMatch(line, /[<>\u001b]/);
  });
});
