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
  nav?: Record<string, string[]>;
}) {
  const stored: CollectedDocumentInput[] = [];
  const recorded: string[] = [];
  const fetched: string[] = [];
  const finished: (string | null)[] = [];
  const knownShas = new Set(
    (input.known ?? []).map((b) =>
      createHash("sha256").update(b).digest("hex"),
    ),
  );
  const repository = {
    seen: async (_source: string, ids: readonly string[]) =>
      new Set(ids.filter((id) => (input.seen ?? []).includes(id))),
    hasContent: async (sha: string) => knownShas.has(sha),
    navNumbers: async (base: string) => input.nav?.[base] ?? [],
    ownAccounts: async () => ["1170900220624460"],
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
    finishRun: async (_id: string, _counts: unknown, error: string | null) =>
      void finished.push(error),
  } as unknown as InvoiceCollectionRepository;
  const google: GoogleClientFactory = () => ({
    gmailMessageIds: async (user: string) => {
      if (user === input.failingUser)
        throw new GoogleReadonlyError("GOOGLE_AUTH_FAILED");
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
      "Bankszámlaszám: 11709002-20624460-00000000",
    ]);
    // egy szállító számlája, amit se illesztő, se NAV-sor nem ismer
    const unknown = await pdf([
      "Invoice",
      "Supplier VAT: DE152405660",
      "Invoice number: RE67456",
    ]);
    const { collection, stored, recorded } = setup({
      environment: env(["GMAIL_FOXPOST"]),
      messages: {
        "m-1": [
          { fileName: "szamla.pdf", buffer: invoice },
          { fileName: "akcio.pdf", buffer: leaflet },
          { fileName: "E-ACRW-2026-00439.pdf", buffer: ours },
          { fileName: "RE67456.pdf", buffer: unknown },
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
      "m-1/E-ACRW-2026-00439.pdf:OWN_INVOICE",
      "m-1/RE67456.pdf:UNMATCHED",
    ]);
    assert.deepEqual(
      [
        counts.filesSeen,
        counts.storedCount,
        counts.notInvoiceCount,
        counts.unmatchedCount,
        counts.ownInvoiceCount,
      ],
      [4, 1, 1, 1, 1],
    );
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
    const { collection, stored, finished } = setup({
      environment: env(["GMAIL_FOXPOST", "GMAIL_BALAZS"]),
      messages: { "m-1": [{ fileName: "x.pdf", buffer: invoice }] },
      failingUser: "info@acropora.hu",
      nav: { "12345678": ["X-7701"] },
    });
    await collection.run("SCHEDULED");
    assert.deepEqual(
      [stored.map((d) => d.source), finished],
      [["BALAZS_MAIL"], ["INFO_MAIL:GOOGLE_AUTH_FAILED"]],
    );
  });

  it("stores a known invoice even when our bank account stands in it", async () => {
    // például egy csoportos beszedési megbízás: a mi számlánk áll rajta, és mégis bejövő
    const invoice = await pdf([
      "SZÁMLA",
      "Eladó: Szállító Kft., adószám: 12345678-2-42",
      "Számla sorszáma: SZ-2026/0999",
      "Terhelendő számla: 11709002-20624460-00000000",
    ]);
    const { collection, stored, recorded } = setup({
      environment: env(["GMAIL_FOXPOST"]),
      messages: { "m-1": [{ fileName: "sz.pdf", buffer: invoice }] },
      nav: { "12345678": ["SZ-2026/0999"] },
    });
    await collection.run("MANUAL");
    assert.deepEqual([stored.length, recorded], [1, []]);
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
