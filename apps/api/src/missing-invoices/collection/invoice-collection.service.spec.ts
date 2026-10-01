import "reflect-metadata";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import PDFDocument from "pdfkit";

import { registerEmbeddedPdfFont } from "../../documents/pdf/branded-document.js";
import { GoogleReadonlyError } from "../../integrations/google/google-readonly.client.js";
import type { SupplierInvoiceImportService } from "../../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import type {
  CollectedDocumentInput,
  InvoiceCollectionRepository,
} from "./invoice-collection.repository.js";
import { unmatchedRetryDue } from "./invoice-collection.config.js";
import type { CardDebit } from "./invoice-text.js";
import {
  InvoiceCollectionService,
  type GoogleClientFactory,
} from "./invoice-collection.service.js";

function pdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 20 });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    registerEmbeddedPdfFont(doc).fontSize(10);
    lines.forEach((line, i) => doc.text(line, 30, 40 + i * 16));
    doc.end();
  });
}

const KEY = { CLIENT_ID: "c", CLIENT_SECRET: "s", REFRESH_TOKEN: "r" };
const env = (prefixes: string[], extra: Record<string, string> = {}) => ({
  INVOICE_COLLECTION_ENABLED: "true",
  ...Object.fromEntries(
    prefixes.flatMap((prefix) =>
      Object.entries(KEY).map(([name, value]) => [`${prefix}_${name}`, value]),
    ),
  ),
  ...extra,
});

function setup(input: {
  environment: NodeJS.ProcessEnv;
  messages: Record<string, { fileName: string; buffer: Buffer }[]>;
  seen?: string[];
  known?: Buffer[];
  failingUser?: string;
  failingCode?: string;
  failingDetail?: string;
  nav?: Record<string, string[]>;
  debits?: string[];
  cardDebits?: CardDebit[];
  retryDue?: boolean;
}) {
  const stored: CollectedDocumentInput[] = [];
  const recorded: string[] = [];
  const fetched: string[] = [];
  const finished: (string | null)[] = [];
  const failedFlags: boolean[] = [];
  const seenFlags: boolean[] = [];
  const gaps: (number | undefined)[] = [];
  const knownShas = new Set(
    (input.known ?? []).map((b) =>
      createHash("sha256").update(b).digest("hex"),
    ),
  );
  const repository = {
    seen: async (_source: string, ids: readonly string[], retry: boolean) => {
      seenFlags.push(retry);
      return new Set(ids.filter((id) => (input.seen ?? []).includes(id)));
    },
    unmatchedRetryDue: async () => input.retryDue ?? true,
    hasContent: async (sha: string) => knownShas.has(sha),
    navNumbers: async (base: string) => input.nav?.[base] ?? [],
    debitNarratives: async () => input.debits ?? [],
    cardDebits: async () => input.cardDebits ?? [],
    record: async (
      _source: string,
      id: string,
      fileName: string,
      verdict: string,
    ) => void recorded.push(`${id}/${fileName}:${verdict}`),
    store: async (document: CollectedDocumentInput) => {
      stored.push(document);
      return `doc-${stored.length}`;
    },
    startRun: async () => "run-1",
    finishRun: async (
      _id: string,
      _counts: unknown,
      error: string | null,
      failed: boolean,
    ) => {
      finished.push(error);
      failedFlags.push(failed);
    },
  } as unknown as InvoiceCollectionRepository;
  const google: GoogleClientFactory = (settings) => ({
    gmailMessageIds: async (user: string) => {
      gaps.push(settings.requestGapMs);
      if (user === input.failingUser)
        throw new GoogleReadonlyError(
          input.failingCode ?? "GOOGLE_AUTH_FAILED",
          input.failingDetail ?? null,
        );
      return Object.keys(input.messages);
    },
    gmailPdfMessage: async (_user: string, id: string) => {
      fetched.push(id);
      return {
        id,
        receivedAt: null,
        subject: null,
        sender: "szamla@szallito.hu",
        pdfs: input.messages[id]!,
        skippedTooLarge: 0,
      };
    },
    driveFolderPdfs: async () => [],
    driveFile: async () => Buffer.alloc(0),
  });
  const reader = {
    read: async () => {
      throw new Error("ismeretlen szállító");
    },
  } as unknown as SupplierInvoiceImportService;
  return {
    collection: new InvoiceCollectionService(
      repository,
      reader,
      google,
      input.environment,
    ),
    stored,
    recorded,
    fetched,
    finished,
    failedFlags,
    seenFlags,
    gaps,
  };
}

// Ami pirosít: ha a nem számlának látszó PDF tartalma tárolódna; ha egy már
// meglévő tartalom másodszor is bekerülne; ha egy látott levél újra letöltődne;
// ha egy forrás hibája a többit megállítaná; ha a kapcsoló nélkül futna.
describe("InvoiceCollectionService", () => {
  it("stores an invoice whose supplier's NAV number is in its text, and only counts the rest", async () => {
    const invoice = await pdf([
      "SZÁMLA",
      "Eladó: Szállító Kft., adószám: 12345678-2-42",
      "Vevő: Acropora Kft., adószám: 23916229-2-13",
      "Számla sorszáma: SZ-2026/0815",
    ]);
    const leaflet = await pdf([
      "Őszi akció",
      "Minden termék 20% kedvezménnyel",
    ]);
    // a saját kimenő számlánk: a NAV bejövő sorai közt nincs, tehát nem tárolódik
    const ours = await pdf([
      "SZÁMLA",
      "Eladó: Acropora Kft., adószám: 23916229-2-13",
      "Vevő: Vevő Bt., adószám: 87654321-2-41",
      "Számla sorszáma: ACRW-2026-00439",
    ]);
    const { collection, stored, recorded } = setup({
      environment: env(["GMAIL_FOXPOST"]),
      messages: {
        "m-1": [
          { fileName: "szamla.pdf", buffer: invoice },
          { fileName: "akcio.pdf", buffer: leaflet },
          { fileName: "E-ACRW-2026-00439.pdf", buffer: ours },
        ],
      },
      nav: { "12345678": ["SZ-2026/0815"] },
    });
    const counts = await collection.run("MANUAL");
    assert.deepEqual(
      stored.map((d) => [
        d.source,
        d.fileName,
        d.kind,
        d.payee,
        d.read,
        d.textReading,
      ]),
      [
        [
          "INFO_MAIL",
          "szamla.pdf",
          "INVOICE",
          "COMPANY",
          false,
          {
            invoiceNumber: "SZ-2026/0815",
            numberFrom: "NAV",
            supplierTaxNumber: "12345678-2-42",
          },
        ],
      ],
    );
    assert.deepEqual(recorded, [
      "m-1/akcio.pdf:NOT_INVOICE",
      "m-1/E-ACRW-2026-00439.pdf:UNMATCHED",
    ]);
    assert.deepEqual(
      [
        counts.filesSeen,
        counts.storedCount,
        counts.notInvoiceCount,
        counts.unmatchedCount,
      ],
      [3, 1, 1, 1],
    );
  });

  it("stores a foreign invoice whose number a debit narrative names, and only that", async () => {
    // Amblard, éles 2026-10-01: francia számla, nincs a NAV-ban; a közlemény
    // szó szerint megnevezi. A jóváírás közleménye a saját kimenő számlánk.
    const foreign = await pdf([
      "FACTURE / INVOICE",
      "Amblard SAS, TVA FR12345678901",
      "Client: Acropora Kft., VAT HU23916229",
      "Facture N° F2602896",
    ]);
    const unpaid = await pdf([
      "FACTURE / INVOICE",
      "Autre SAS, TVA FR98765432109",
      "Facture N° F2609999",
    ]);
    const { collection, stored, recorded } = setup({
      environment: env(["GMAIL_FOXPOST"]),
      messages: {
        "m-1": [
          { fileName: "F2602896.PDF", buffer: foreign },
          { fileName: "F2609999.PDF", buffer: unpaid },
        ],
      },
      debits: [
        "485,40 EUR F2602896 34 chemin de Berniquaut FR7630003004730002571158",
      ],
    });
    await collection.run("MANUAL");
    assert.deepEqual(
      stored.map((d) => [d.fileName, d.payee, d.textReading]),
      [
        [
          "F2602896.PDF",
          "COMPANY",
          {
            invoiceNumber: "F2602896",
            numberFrom: "LABEL",
            supplierTaxNumber: "FR12345678901",
            bankReference: "F2602896",
          },
        ],
      ],
    );
    assert.deepEqual(recorded, ["m-1/F2609999.PDF:UNMATCHED"]);
  });

  it("stores a NAV-less subscription invoice its card payment fits, with the payment's amount and partner (Hetzner)", async () => {
    const invoice = await pdf([
      "Hetzner Online GmbH Industriestr. 25 91710 Gunzenhausen Germany",
      "Acropora Kft.",
      "VAT Reg. No.: HU23916229",
      "Invoice no.: 089001181580",
      "Total | 46.64 EUR",
    ]);
    const other = await pdf([
      "INVOICE",
      "Hetzner Online GmbH",
      "Invoice no.: 1",
      "Total 1.00 EUR",
    ]);
    const { collection, stored, recorded } = setup({
      environment: env(["GMAIL_FOXPOST"]),
      messages: {
        "m-1": [
          { fileName: "Hetzner_2026-09-05_089001181580.pdf", buffer: invoice },
          { fileName: "Hetzner_masik.pdf", buffer: other },
        ],
      },
      cardDebits: [
        {
          id: "bt-hetzner",
          bookingDate: "2026-09-09",
          counterpartyName: "HETZNER ONLINE GMBH",
          amount: "17113",
          currency: "HUF",
          original: { amount: "46.64", currency: "EUR" },
        },
      ],
    });
    await collection.run("MANUAL");
    assert.deepEqual(
      stored.map((d) => [
        d.fileName,
        (d.textReading as { cardPayment?: unknown } | null)?.cardPayment,
      ]),
      [
        [
          "Hetzner_2026-09-05_089001181580.pdf",
          {
            amount: "46.64",
            currency: "EUR",
            partner: "HETZNER ONLINE GMBH",
            debitIds: ["bt-hetzner"],
          },
        ],
      ],
    );
    assert.deepEqual(recorded, ["m-1/Hetzner_masik.pdf:UNMATCHED"]);
  });

  it("skips the payment reminder but stores the invoice attached next to it (De Jong, 2026-09-24)", async () => {
    const reminder = await pdf([
      "De Jong Marinelife B.V.",
      "Spijksesteeg 2 A, 4212 SPIJK",
      "2nd REMINDER",
      "Our records show that invoice 26007910 is still open.",
      "IBAN NL30RABO0322265428",
    ]);
    const invoice = await pdf([
      "INVOICE",
      "De Jong Marinelife B.V., VAT NL001234567B01",
      "Customer: Acropora Kft., VAT HU23916229",
      "Invoice number 26007910",
      "IBAN NL30RABO0322265428",
    ]);
    const { collection, stored, recorded } = setup({
      environment: env(["GMAIL_FOXPOST"]),
      messages: {
        "m-1": [
          { fileName: "Second reminder 11069-26007910.pdf", buffer: reminder },
          { fileName: "inv26007910.pdf", buffer: invoice },
        ],
      },
      debits: [
        "1.703,08 EUR 26007910 Spijksesteeg 2 A RABONL2U NL30RABO0322265428 De Jong Marinelife B.V. 4212 SPIJK,",
      ],
    });
    await collection.run("MANUAL");
    assert.deepEqual(
      stored.map((d) => [
        d.fileName,
        (d.textReading as { bankReference?: string } | null)?.bankReference,
      ]),
      [["inv26007910.pdf", "26007910"]],
    );
    assert.deepEqual(recorded, [
      "m-1/Second reminder 11069-26007910.pdf:NOT_INVOICE",
    ]);
  });

  it("does not store an offer that quotes an invoice number the bank paid (acrobot 25784)", async () => {
    // a fájlnév semmit nem árul el: a CÍM dönt
    const offer = await pdf([
      "De Jong Marinelife B.V.",
      "Quotation #Q-2026/0412",
      "Customer: Acropora Kft., VAT HU23916229",
      "Following invoice 26007910, total 1.703,08 EUR",
      "IBAN NL30RABO0322265428",
    ]);
    const { collection, stored, recorded } = setup({
      environment: env(["GMAIL_FOXPOST"]),
      messages: { "m-1": [{ fileName: "doc0412.pdf", buffer: offer }] },
      debits: [
        "1.703,08 EUR 26007910 Spijksesteeg 2 A RABONL2U NL30RABO0322265428 De Jong Marinelife B.V. 4212 SPIJK,",
      ],
    });
    await collection.run("MANUAL");
    assert.deepEqual(stored, []);
    assert.deepEqual(recorded, ["m-1/doc0412.pdf:NOT_INVOICE"]);
  });

  it("never takes the supplier's IBAN for the invoice's bank reference", async () => {
    // a szállító IBAN-ja minden fizetésének közleményében ott áll
    const statement = await pdf([
      "INVOICE",
      "De Jong Marinelife B.V.",
      "Invoice number 26009999",
      "IBAN NL30RABO0322265428",
    ]);
    const { collection, stored, recorded } = setup({
      environment: env(["GMAIL_FOXPOST"]),
      messages: { "m-1": [{ fileName: "doc.pdf", buffer: statement }] },
      debits: [
        "1.703,08 EUR 26007910 Spijksesteeg 2 A RABONL2U NL30RABO0322265428 De Jong",
      ],
    });
    await collection.run("MANUAL");
    assert.deepEqual(stored, []);
    assert.deepEqual(recorded, ["m-1/doc.pdf:UNMATCHED"]);
  });

  it("stores an invoice whose order number the debit narrative names, keeping its own number", async () => {
    // Fauna Marin, éles 2026-10-01: a fizetés a rendelésszámot (20144304)
    // nevezi meg, a számla száma 40142365, a rendelésszám „Auftragsnr.” alatt
    // áll a számlán. Az összeg és a dátum (pont, vessző) nem hivatkozás.
    const invoice = await pdf([
      "Rechnung 40142365",
      "Fauna Marin GmbH, USt-IdNr. DE812345678",
      "Kunden-Nr. | Auftragsnr. | Datum | Betrag",
      "33620 | 20144304 | 18.09.2026 | 1.698,58",
    ]);
    const other = await pdf([
      "Rechnung 40199999",
      "Fauna Marin GmbH, USt-IdNr. DE812345678",
      "Datum 17.09.2026 | Betrag 1.698,58",
    ]);
    const { collection, stored, recorded } = setup({
      environment: env(["GMAIL_FOXPOST"]),
      messages: {
        "m-1": [
          {
            fileName: "Rechnung 40142365 - Kunden-Nr. 33620.pdf",
            buffer: invoice,
          },
          { fileName: "Rechnung 40199999.pdf", buffer: other },
        ],
      },
      debits: [
        "1.698,58 EUR 20144304 Gottlieb-Binder-Str. 9 DE55603900000376285001 Fauna Marin Gmbh",
      ],
    });
    await collection.run("MANUAL");
    assert.deepEqual(
      stored.map((d) => [
        d.fileName,
        (d.textReading as { bankReference?: string } | null)?.bankReference,
      ]),
      [["Rechnung 40142365 - Kunden-Nr. 33620.pdf", "20144304"]],
    );
    assert.deepEqual(recorded, ["m-1/Rechnung 40199999.pdf:UNMATCHED"]);
  });

  it("skips a content it already has and a mail it has already read", async () => {
    const invoice = await pdf(["Számla", "Számlaszám: A-1"]);
    const { collection, stored, recorded, fetched } = setup({
      environment: env(["GMAIL_FOXPOST"]),
      messages: {
        "m-old": [{ fileName: "a.pdf", buffer: invoice }],
        "m-new": [{ fileName: "a-masolat.pdf", buffer: invoice }],
      },
      seen: ["m-old"],
      known: [invoice],
    });
    await collection.run("MANUAL");
    assert.deepEqual(
      [fetched, stored.length, recorded],
      [["m-new"], 0, ["m-new/a-masolat.pdf:DUPLICATE"]],
    );
  });

  it("goes on with balazs@ when info@'s key fails, and names the failed source on the run", async () => {
    const invoice = await pdf([
      "Invoice",
      "Supplier VAT: 12345678-2-42",
      "Invoice number: X-7701",
    ]);
    const { collection, stored, finished, failedFlags } = setup({
      environment: env(["GMAIL_FOXPOST", "GMAIL_BALAZS"]),
      messages: { "m-1": [{ fileName: "x.pdf", buffer: invoice }] },
      failingUser: "info@acropora.hu",
      nav: { "12345678": ["X-7701"] },
    });
    await collection.run("SCHEDULED");
    assert.deepEqual(
      [stored.map((d) => d.source), finished, failedFlags],
      [["BALAZS_MAIL"], ["INFO_MAIL:GOOGLE_AUTH_FAILED"], [true]],
    );
  });

  /*
    A RATE LIMIT NEM HIBA (acrobot 25605, éles 2026-10-01: a futás FAILED lett,
    holott csak a Gmail kvótája fogyott el). MI PIROSÍT: ha a rate limit a
    futást FAILED-re vinné; ha a megállt forrás a többit megállítaná; ha a kódja
    nem látszana a futáson; ha a letöltés szünet nélkül menne; ha az UNMATCHED
    újraolvasás döntése nem jutna el a látott-szűrőig.
  */
  it("a rate-limited source pauses: the run is not failed, the other source goes on", async () => {
    const invoice = await pdf([
      "Invoice",
      "Supplier VAT: 12345678-2-42",
      "Invoice number: X-7701",
    ]);
    const { collection, stored, finished, failedFlags, gaps } = setup({
      environment: env(["GMAIL_FOXPOST", "GMAIL_BALAZS"]),
      messages: { "m-1": [{ fileName: "x.pdf", buffer: invoice }] },
      failingUser: "info@acropora.hu",
      failingCode: "GOOGLE_RATE_LIMITED",
      failingDetail: "403 userRateLimitExceeded usageLimits",
      nav: { "12345678": ["X-7701"] },
    });
    await collection.run("SCHEDULED");
    assert.deepEqual(
      [stored.map((d) => d.source), finished, failedFlags],
      [
        ["BALAZS_MAIL"],
        ["INFO_MAIL:GOOGLE_RATE_LIMITED 403 userRateLimitExceeded usageLimits"],
        [false],
      ],
    );
    assert.deepEqual(gaps, [250, 250]);
  });

  it("asks the seen-filter to re-read UNMATCHED only when it is due", async () => {
    for (const retryDue of [true, false]) {
      const { collection, seenFlags } = setup({
        environment: env(["GMAIL_FOXPOST"]),
        messages: {},
        retryDue,
      });
      await collection.run("SCHEDULED");
      assert.deepEqual(seenFlags, [retryDue]);
    }
  });

  it("does not run while switched off", async () => {
    const { collection } = setup({
      environment: {
        ...env(["GMAIL_FOXPOST"]),
        INVOICE_COLLECTION_ENABLED: "false",
      },
      messages: {},
    });
    await assert.rejects(collection.run("MANUAL"), /ki van kapcsolva/);
  });
});

/*
  AZ UNMATCHED ÚJRAOLVASÁS NAPONTA EGYSZER, VAGY ÚJ TERHELÉSRE (acrobot 25605).
  MI PIROSÍT: ha óránként újraolvasna; ha egy új terhelés vagy egy új nap nem
  indítaná el; ha a legelső futás nem olvasná újra.
*/
describe("unmatchedRetryDue", () => {
  const at = (iso: string) => new Date(iso);
  it("the first complete run of a Budapest day re-reads", () => {
    // 22:30 UTC = 00:30 Budapest, already the next day
    assert.equal(
      unmatchedRetryDue(
        at("2026-10-01T21:00:00Z"),
        0,
        at("2026-10-01T22:30:00Z"),
      ),
      true,
    );
    assert.equal(unmatchedRetryDue(null, 0, at("2026-10-01T10:00:00Z")), true);
  });
  it("later the same day only after a new debit", () => {
    const last = at("2026-10-01T08:00:00Z");
    const now = at("2026-10-01T09:00:00Z");
    assert.equal(unmatchedRetryDue(last, 0, now), false);
    assert.equal(unmatchedRetryDue(last, 1, now), true);
  });
});
