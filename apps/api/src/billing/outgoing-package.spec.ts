import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument } from "pdf-lib";

import { Prisma } from "@acropora/database";

import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";
import {
  OutgoingPackageService,
  externalKind,
} from "./outgoing-package.service.js";
import {
  buildOutgoingPackage,
  externalNotInvoice,
  outgoingPackageRows,
  outgoingTotals,
  type OutgoingCandidate,
} from "./outgoing-package.js";

/**
 * A HAVI KIMENŐ CSOMAG (hétfői lista N1). MI PIROSÍT: ugyanaz a számlaszám
 * kétszer kerül a csomagba (az OS-ben kiállított a Számlázz.hu feedjében is
 * visszajön); a Számlázz.hu sora nyer az OS-é helyett; a díjbekérő bekerül; a
 * hónap UTC szerint vág (egy éjféli kiállítás rossz hónapba esik); a PDF
 * nélküli számla kiesik a csomagból; az összesítő lebegőpontosan számol.
 */
const jelolt = (over: Partial<OutgoingCandidate>): OutgoingCandidate => ({
  source: "SZAMLAZZ",
  number: "ACRW-2026/00500",
  issuedAt: new Date("2026-09-15T00:00:00Z"),
  fulfillmentDate: null,
  customer: "Vevő Kft.",
  paymentMethod: "átutalás",
  gross: "1000.00",
  currency: "HUF",
  kind: null,
  cancelled: false,
  notInvoice: false,
  pdfKey: null,
  missingReason: null,
  ...over,
});

async function pdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

describe("a hónap tételei", () => {
  it("számlaszámonként egy, és az OS sora nyer, akármelyik jön előbb", () => {
    const rows = outgoingPackageRows("2026-09", [
      jelolt({
        number: "ACRW-2026/00501",
        source: "SZAMLAZZ",
        customer: "feed",
      }),
      jelolt({
        number: "ACRW-2026/00501",
        source: "OS",
        customer: "os",
        issuedAt: new Date("2026-09-15T08:00:00Z"),
      }),
      jelolt({ number: "ACRW-2026/00502", source: "EBIZ", customer: "ebiz" }),
      jelolt({
        number: "ACRW-2026/00502",
        source: "SZAMLAZZ",
        customer: "feed2",
      }),
    ]);
    assert.deepEqual(
      rows.map((r) => [r.number, r.source, r.customer]),
      [
        ["ACRW-2026/00501", "OS", "os"],
        ["ACRW-2026/00502", "SZAMLAZZ", "feed2"],
      ],
    );
  });

  it("a Számlázz.hu-n sztornózott OS-számla sztornó jele az ikertől jön (barracuda, #1662)", () => {
    const rows = outgoingPackageRows("2026-09", [
      jelolt({ number: "A", source: "OS", cancelled: false }),
      jelolt({ number: "A", source: "SZAMLAZZ", cancelled: true }),
      jelolt({ number: "B", source: "OS", cancelled: false }),
      jelolt({ number: "B", source: "SZAMLAZZ", cancelled: false }),
    ]);
    assert.deepEqual(
      rows.map((r) => [r.number, r.source, r.cancelled]),
      [
        ["A", "OS", true],
        ["B", "OS", false],
      ],
    );
  });

  it("a külső bizonylat fajtája a borítóra kerül; a sima számlának nincs", () => {
    assert.deepEqual(
      ["SZ", "sz", "SS", "HS", "JS", "ES", "VS"].map(externalKind),
      [
        null,
        null,
        "Sztornó számla",
        "Helyesbítő számla",
        "Jóváíró számla",
        "Előlegszámla",
        "Végszámla",
      ],
    );
  });

  it("a díjbekérő és a szállítólevél kimarad", () => {
    assert.equal(externalNotInvoice("D"), true);
    assert.equal(externalNotInvoice("SL"), true);
    assert.equal(externalNotInvoice("SZ"), false);
    assert.equal(externalNotInvoice("SS"), false);
    assert.deepEqual(
      outgoingPackageRows("2026-09", [jelolt({ notInvoice: true })]),
      [],
    );
  });

  it("a hónap budapesti naptár szerint: az OS éjféli kiállítása a következő hónapé", () => {
    const rows = outgoingPackageRows("2026-10", [
      // 2026-09-30 22:30 UTC = 2026-10-01 00:30 Budapesten
      jelolt({
        source: "OS",
        number: "A",
        issuedAt: new Date("2026-09-30T22:30:00Z"),
      }),
      // a feed a kelte napját adja, UTC éjfélként
      jelolt({ number: "B", issuedAt: new Date("2026-09-30T00:00:00Z") }),
      jelolt({ number: "C", issuedAt: new Date("2026-10-31T00:00:00Z") }),
    ]);
    assert.deepEqual(
      rows.map((r) => [r.number, r.issueDay]),
      [
        ["A", "2026-10-01"],
        ["C", "2026-10-31"],
      ],
    );
  });

  it("az összesítő forrásonként és devizánként, fillérre, a sztornó levonva", () => {
    assert.deepEqual(
      outgoingTotals([
        jelolt({ gross: "0.10" }),
        jelolt({ gross: "0.20" }),
        jelolt({ gross: "-0.05" }),
        jelolt({ gross: "12.5", currency: "EUR" }),
        jelolt({ source: "OS", gross: "100" }),
      ]),
      [
        { source: "OS", currency: "HUF", count: 1, gross: "100.00" },
        { source: "SZAMLAZZ", currency: "EUR", count: 1, gross: "12.50" },
        { source: "SZAMLAZZ", currency: "HUF", count: 3, gross: "0.25" },
      ],
    );
  });
});

describe("a csomag", () => {
  it("a borító után a csatolható PDF-ek; a PDF nélküli és a rossz fájl nem esik ki, csak nem csatolódik", async () => {
    const rows = outgoingPackageRows("2026-09", [
      jelolt({ number: "A" }),
      jelolt({ number: "B", missingReason: "SZAMLAZZ_PDF_REJECTED_7" }),
      jelolt({ number: "C" }),
      jelolt({ number: "D" }),
    ]);
    const files: Record<string, Uint8Array | null> = {
      A: await pdf(2),
      B: null,
      C: Buffer.from("<html>nem pdf</html>"),
      D: await pdf(1),
    };
    const out = await buildOutgoingPackage({
      month: "2026-09",
      company: { name: "Acropora Kft.", taxNumber: "12345678" },
      lines: rows.map((row) => ({ row, file: files[row.number]! })),
    });
    assert.deepEqual(out.outcomes, [
      "ATTACHED",
      "NO_FILE",
      "NOT_PDF",
      "ATTACHED",
    ]);
    const doc = await PDFDocument.load(out.pdf);
    // egy borítólap + 2 + 1
    assert.equal(doc.getPageCount(), 4);
    // a borító minden tételt felsorol, a PDF nélkülit külön blokkban is, és
    // minden lap alján ott a hónap és az oldalszám
    const sorok = (await readPdfTextLines(out.pdf)).map(
      (l) => `${l.pageNumber}|${l.text}`,
    );
    for (const vart of [
      "1|Kimenő számlák, 2026. szeptember",
      "1|2. B 2026-09-15 Vevő Kft. 1 000,00 HUF",
      "1|Számlázz.hu; átutalás; nincs PDF",
      "1|Számlázz.hu: 4 db, 4 000,00 HUF",
      "1|PDF nélkül: 2 db",
      "1|B (Számlázz.hu): nincs PDF, SZAMLAZZ_PDF_REJECTED_7",
      "1|C (Számlázz.hu): nem PDF, nincs benne",
      "1|2026-09 1 / 4",
      "4|2026-09 4 / 4",
    ])
      assert.ok(sorok.includes(vart), `hiányzik: ${vart}\n${sorok.join("\n")}`);
  });
});

describe("a csomag adatai", () => {
  it("az OS díjbekérője és a feed díjbekérője kimarad, a PDF a saját kulcsáról jön, és egy olvashatatlan tár nem állítja meg", async () => {
    const kert: string[] = [];
    let ablak: unknown;
    const egyPdf = await pdf(1);
    const service = new OutgoingPackageService({
      get: async (key: {
        owner: string;
        ownerId: string;
        documentId: string;
      }) => {
        kert.push(`${key.owner}/${key.ownerId}/${key.documentId}`);
        if (key.ownerId === "x2") throw new Error("a tár nem érhető el");
        return egyPdf;
      },
    } as never);
    const os = (over: Record<string, unknown>) => ({
      id: "i1",
      invoiceNumber: "ACRW-2026/00510",
      documentType: "INVOICE",
      issueDate: new Date("2026-09-10T09:00:00Z"),
      fulfillmentDate: null,
      partnerName: "OS vevő",
      paymentMethod: "átutalás",
      grossAmount: new Prisma.Decimal("1270"),
      currency: "HUF",
      pdfStorageKey: "invoices/i1/billing-document.pdf",
      ...over,
    });
    const kulso = (over: Record<string, unknown>) => ({
      id: "x1",
      source: "SZAMLAZZ",
      kindCode: "SZ",
      documentNumber: "ACRW-2026/00511",
      issueDate: new Date("2026-09-11T00:00:00Z"),
      fulfillmentDate: null,
      customerName: "Külső vevő",
      paymentMethod: null,
      grossAmount: new Prisma.Decimal("500"),
      currency: "HUF",
      cancelled: false,
      pdfStorageKey: "external-invoices/x1/szamlazz.pdf",
      pdfMissingReason: null,
      ...over,
    });
    (service as unknown as { database: unknown }).database = {
      invoice: {
        findMany: async (args: { where: { issueDate: unknown } }) => {
          ablak = args.where.issueDate;
          return [
            os({}),
            os({ id: "i2", invoiceNumber: "D-1", documentType: "PROFORMA" }),
          ];
        },
      },
      externalBillingDocument: {
        findMany: async () => [
          kulso({}),
          // az OS számlája a feedből is visszajön: nem kerül bele másodszor
          kulso({ id: "x3", documentNumber: "ACRW-2026/00510" }),
          kulso({ id: "x4", documentNumber: "D-2", kindCode: "D" }),
          kulso({
            id: "x5",
            documentNumber: "ACRW-2026/00513",
            kindCode: "SS",
            pdfStorageKey: null,
          }),
          kulso({
            id: "x2",
            documentNumber: "ACRW-2026/00512",
            source: "EBIZ",
            pdfStorageKey: "external-invoices/x2/ebiz.pdf",
          }),
        ],
      },
    };
    const { fileName, content } = await service.build("2026-09");
    assert.equal(fileName, "kimeno-szamlak-2026-09.pdf");
    assert.deepEqual(ablak, {
      gte: new Date("2026-08-31T00:00:00Z"),
      lt: new Date("2026-10-02T00:00:00Z"),
    });
    assert.deepEqual(kert, [
      "invoice/i1/billing-document.pdf",
      "external-invoice/x1/szamlazz.pdf",
      "external-invoice/x2/ebiz.pdf",
    ]);
    // borító + a két megjött PDF; az eBIZ-é a tár hibája miatt nincs benne
    assert.equal((await PDFDocument.load(content)).getPageCount(), 3);
    const borito = (await readPdfTextLines(content)).map((l) => l.text);
    assert.ok(
      borito.some((l) => l.startsWith("Sztornó számla, Számlázz.hu")),
      borito.join("\n"),
    );
  });
});
