import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";

import { candidateDocument } from "../testing/billing-documents.fixture.js";
import type { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import type { CandidateDocument } from "./missing-invoice-matching.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { buildAccountantPackage } from "./missing-invoices-package.pdf.js";
import type {
  MissingInvoicesRepository,
  PackageBillingRow,
} from "./missing-invoices.repository.js";
import type { StoredReading } from "../billing/foreign-invoice/reading-values.js";
import { pairingNumberKey } from "../billing/incoming-billing-documents.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";

const D = (v: number | string) => new Prisma.Decimal(v);
const ACCOUNT = {
  id: "acc",
  accountNumber: "1170900220624460",
  currency: "HUF",
  name: "Fő számla",
};

async function pdfOfPages(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

let n = 0;
const debit = (date: string, amount: number, name: string, overrides = {}) => ({
  id: `d${++n}`,
  bankAccountId: ACCOUNT.id,
  amount: D(amount),
  currency: "HUF",
  bookingDate: new Date(`${date}T00:00:00Z`),
  counterpartyAccount: null,
  counterpartyName: name,
  narrative: "",
  transactionType: "ÁTUTALÁS",
  comment: null,
  categoryOverride: null,
  paperOriginalAt: null,
  ...overrides,
});

const document = (
  overrides: Partial<CandidateDocument> & { id: string },
): CandidateDocument =>
  candidateDocument({
    source: "MAILBOX",
    gross: D(1000),
    hasOriginal: true,
    ...overrides,
  });

function service(input: {
  debits: ReturnType<typeof debit>[];
  documents: CandidateDocument[];
  files: Record<string, Uint8Array>;
  feed?: { sourceDocumentId: string | null; documentNumber: string }[];
  readings?: Map<string, StoredReading>;
  /** a bejövő számlák sorai (a könyvelői csomag a számla kelte szerint) */
  billing?: PackageBillingRow[];
  /** minden bejövő számla-sor hivatkozása, a sztornózott és a nem könyvelendő is */
  refs?: { sourceDocumentId: string | null; documentNumber: string }[];
}) {
  const asked: string[][] = [];
  const askedHeads: string[][] = [];
  const repository = {
    accounts: async () => [ACCOUNT],
    debits: async () => input.debits,
    credits: async () => [],
    statementCoverage: async () => new Set([`${ACCOUNT.id}:2026-08`]),
    manualMatches: async () => new Map(),
    candidates: async () => input.documents,
    uncheckedMailboxContent: async () => [],
    setPayee: async () => undefined,
    packageReadings: async () => ({
      feed: input.feed ?? [],
      readings: input.readings ?? new Map(),
    }),
    packageBillingRows: async () => ({
      rows: input.billing ?? [],
      refs:
        input.refs ??
        (input.billing ?? []).map((row) => ({
          sourceDocumentId: row.sourceDocumentId,
          documentNumber: row.documentNumber,
        })),
    }),
    originalHeads: async (ids: readonly string[]) => {
      askedHeads.push([...ids]);
      return new Map(
        ids
          .filter((id) => input.files[id])
          .map((id) => [
            id,
            { fileName: `${id}.pdf`, content: input.files[id]!.slice(0, 5) },
          ]),
      );
    },
    originals: async (ids: readonly string[]) => {
      asked.push([...ids]);
      return new Map(
        ids
          .filter((id) => input.files[id])
          .map((id) => [
            id,
            { fileName: `${id}.pdf`, content: input.files[id]! },
          ]),
      );
    },
  } as unknown as MissingInvoicesRepository;
  const reader = {} as SupplierInvoiceImportService;
  return {
    missing: new MissingInvoicesService(repository, reader, {}),
    asked,
    askedHeads,
  };
}

describe("the missing list (xlsx)", () => {
  it("lists the month's missing items with numeric amounts, the shared labels, and the faulty invoice's number", async () => {
    const { missing } = service({
      debits: [
        debit("2026-08-03", 1000, "Szállító Kft."),
        debit("2026-08-04", 2500, "Díjbekérő Bt.", { comment: "kérve" }),
        debit("2026-08-05", 777, "Senki Bt."),
        debit("2026-09-02", 555, "Senki Bt."),
      ],
      documents: [
        document({ id: "ok", gross: D(1000) }),
        document({
          id: "proforma",
          gross: D(2500),
          supplierName: "Díjbekérő Bt.",
          kind: "PROFORMA",
        }),
      ],
      files: {},
    });
    const { fileName, content } = await missing.missingXlsx("2026-08");
    assert.equal(fileName, "hianyzo-szamlak-2026-08.xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as unknown as ExcelJS.Buffer);
    const rows = workbook.worksheets[0]!.getSheetValues().slice(
      2,
    ) as unknown[][];
    assert.deepEqual(
      rows.map((row) => [row[3], row[5], row[10], row[11], row[12]]),
      [
        ["Díjbekérő Bt.", 2500, "Csak díjbekérő", "kérve", "SZ-proforma"],
        ["Senki Bt.", 777, "Nincs számla", "", ""],
      ],
    );
  });
});

describe("the missing list names the missing invoices (acrobot 25610)", () => {
  it("lists every paired number, the missing ones BY NAME and the difference", async () => {
    const { missing } = service({
      debits: [
        debit("2026-08-20", 3000, "Fluidra Magyarország Kft.", {
          narrative: "KS26/08132 KS26/08382 KS26/08999",
        }),
      ],
      documents: [
        document({
          id: "a",
          number: "KS26/08132",
          supplierName: "Fluidra Magyarország Kft.",
          source: "NAV",
          hasOriginal: false,
        }),
        document({
          id: "b",
          number: "KS26/08382",
          supplierName: "Fluidra Magyarország Kft.",
        }),
      ],
      files: {},
    });
    const { content } = await missing.missingXlsx("2026-08");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0]!;
    const header = (sheet.getRow(1).values as unknown[]).slice(12);
    assert.deepEqual(header, [
      "Számla száma",
      "Hiányzó számla",
      "Összeg-eltérés",
    ]);
    const row = sheet.getRow(2).values as unknown[];
    assert.deepEqual(
      [row[12], row[13], row[14]],
      ["KS26/08132, KS26/08382", "KS26/08132, KS26/08999", "1000 HUF"],
    );
  });
});

describe("the accountant package (pdf)", () => {
  it("puts a cover first, then every attachable original, and keeps the found items only", async () => {
    const { missing, asked } = service({
      debits: [
        debit("2026-08-03", 1000, "Szállító Kft."),
        debit("2026-08-04", 2000, "Szállító Kft."),
        debit("2026-08-05", 3000, "Szállító Kft."),
      ],
      documents: [
        // az összevont számla fő azonosítója a NAV-soré, a fájl a társánál van
        document({
          id: "nav-1",
          source: "NAV",
          gross: D(1000),
          originalId: "mb-1",
          aliasIds: ["mb-1"],
        }),
        document({ id: "mb-2", gross: D(2000) }),
        document({ id: "proforma", gross: D(3000), kind: "PROFORMA" }),
      ],
      files: { "mb-1": await pdfOfPages(2), "mb-2": await pdfOfPages(3) },
    });
    const { fileName, content } = await missing.accountantPackage("2026-08");
    assert.equal(fileName, "konyveloi-csomag-2026-08.pdf");
    assert.deepEqual(asked, [["mb-1", "mb-2"]]);
    const pdf = await PDFDocument.load(content);
    assert.equal(pdf.getPageCount(), 1 + 2 + 3);
  });
});

/*
  A CSAK POSTAFIÓKBÓL ISMERT SZÁMLA A CSOMAGBAN (kártya e4c3b0fb, acrobot
  27599): a PDF marad, a kinyert SZÁMOK csak jóváhagyás után mennek a
  borítóra. Kitalált szállító és számok.

  MI PIROSÍT: ha az ellenőrizetlen olvasat nettója a borítóra kerülne; ha a
  jelölés elmaradna; ha a jóváhagyott sor számai nem kerülnének ki; ha a
  Számlázz.hu-ban is álló számla is „Ellenőrizendő” lenne.
*/
describe("the accountant package marks mailbox-only invoices", () => {
  const reading = (state: "TO_REVIEW" | "VERIFIED"): StoredReading => ({
    id: "r1",
    documentId: "mb-f",
    state,
    supplierName: "Kitalált Előfizetés Inc.",
    supplierTaxNumber: null,
    supplierEuTaxNumber: "IE9999999XX",
    documentNumber: "SZ-mb-f",
    issueDate: new Date("2026-08-01T00:00:00Z"),
    fulfillmentDate: null,
    dueDate: null,
    currency: "EUR",
    netAmount: D("81.30"),
    vatAmount: D("0.00"),
    grossAmount: D("81.30"),
    sources: {},
    warnings: [],
    hasText: true,
    readAt: new Date("2026-08-02T00:00:00Z"),
    reviewedAt: state === "VERIFIED" ? new Date("2026-08-03T00:00:00Z") : null,
    reviewedByUserId: null,
    incomingBillingDocumentId: null,
    createdAt: new Date("2026-08-02T00:00:00Z"),
    updatedAt: new Date("2026-08-02T00:00:00Z"),
  });
  const cover = async (input: {
    readings?: Map<string, StoredReading>;
    feed?: { sourceDocumentId: string | null; documentNumber: string }[];
  }) => {
    const { missing } = service({
      debits: [debit("2026-08-03", 1000, "Szállító Kft.")],
      documents: [document({ id: "mb-f", gross: D(1000) })],
      files: { "mb-f": await pdfOfPages(1) },
      ...input,
    });
    const { content } = await missing.accountantPackage("2026-08");
    assert.equal((await PDFDocument.load(content)).getPageCount(), 1 + 1);
    // a hosszú sort a borító tördeli: szóközzel fűzve mérünk
    return (await pdfTextLines(new Uint8Array(content))).join(" ");
  };

  it("an unverified reading: the PDF goes, the figures do not, marked Ellenőrizendő", async () => {
    const text = await cover({
      readings: new Map([["mb-f", reading("TO_REVIEW")]]),
    });
    assert.ok(text.includes("SZ-mb-f: Ellenőrizendő"), text);
    assert.ok(!text.includes("81.30"), "ellenőrizetlen szám a borítón");
  });

  it("no reading at all is marked the same way", async () => {
    assert.ok((await cover({})).includes("SZ-mb-f: Ellenőrizendő"));
  });

  it("a verified reading puts its figures on the cover", async () => {
    const text = await cover({
      readings: new Map([["mb-f", reading("VERIFIED")]]),
    });
    assert.ok(
      text.includes(
        "SZ-mb-f: ellenőrzött adat: nettó 81.30 EUR, ÁFA 0.00 EUR, bruttó 81.30 EUR, adószám IE9999999XX",
      ),
      text,
    );
    assert.ok(!text.includes("Ellenőrizendő"));
  });

  it("a reading stored under the merged candidate's alias still counts", async () => {
    const { missing } = service({
      debits: [debit("2026-08-03", 1000, "Szállító Kft.")],
      documents: [
        document({ id: "mb-f", gross: D(1000), aliasIds: ["mb-alias"] }),
      ],
      files: { "mb-f": await pdfOfPages(1) },
      readings: new Map([["mb-alias", reading("VERIFIED")]]),
    });
    const { content } = await missing.accountantPackage("2026-08");
    const text = (await pdfTextLines(new Uint8Array(content))).join(" ");
    assert.ok(text.includes("ellenőrzött adat: nettó 81.30 EUR"), text);
  });

  it("an invoice the Számlázz.hu feed also has is not marked", async () => {
    const text = await cover({
      feed: [{ sourceDocumentId: null, documentNumber: "SZ-mb-f" }],
    });
    assert.ok(!text.includes("Ellenőrizendő"), text);
    assert.ok(text.includes("SZ-mb-f: csatolva"), text);
  });
});

/*
  A SZTORNÓZOTT VÁSÁRLÁS A CSOMAGBAN (acrobot 25981). MI PIROSÍT: ha a
  jóváíró (könyvelendő bizonylat) vagy az eredeti számla kimaradna; ha a kettő
  két külön sorba kerülne, vagy a sor nem mondaná meg, hogy összetartoznak és
  mi lett a visszatérítéssel; ha egy számla nélküli tétel is bekerülne.
*/
describe("the accountant package with a cancelled purchase", () => {
  it("the original and the credit note in one row, marked as belonging together", async () => {
    const { missing } = service({
      debits: [
        debit("2026-08-21", 85000, "Tesla Inc", {
          narrative: "2026.08.17 7413124583 Tesla Inc -APPLE",
        }),
        debit("2026-08-22", 4321, "Senki Bt."),
      ],
      documents: [
        document({
          id: "nav-orig",
          source: "NAV",
          number: "4042A0000031808",
          date: "2026-08-17",
          gross: D(0),
          supplierName: "Tesla Hungary Kft.",
          hasOriginal: false,
        }),
        document({
          id: "cr",
          source: "SZAMLAZZ",
          number: "CR4042A0000012507",
          date: "2026-08-25",
          gross: D(-85000),
          supplierName: "Tesla Hungary Kft.",
        }),
      ],
      files: { cr: await pdfOfPages(1) },
    });
    const { content } = await missing.accountantPackage("2026-08");
    assert.equal((await PDFDocument.load(content)).getPageCount(), 1 + 1);
    const cover = (await pdfTextLines(new Uint8Array(content))).join("\n");
    for (const expected of [
      "Tesla Inc | 85 000 HUF",
      "sztornózott vásárlás: az eredeti számla és a jóváíró együtt; a visszatérítés várható (határidő: 2026-09-24)",
      "4042A0000031808 (Tesla Hungary Kft.): nincs tárolt fájl",
      "CR4042A0000012507 (Tesla Hungary Kft.): csatolva",
    ])
      assert.ok(cover.includes(expected), `a borítón nincs: ${expected}`);
    assert.ok(!cover.includes("Senki Bt."), "számla nélküli tétel a csomagban");
  });
});

describe("buildAccountantPackage", () => {
  it("names on the cover what could not be attached, instead of dropping it silently", async () => {
    const { pdf, outcomes } = await buildAccountantPackage({
      month: "2026-08",
      company: { name: "Acropora Kft.", taxNumber: "23916229" },
      entries: [
        {
          bookingDate: "2026-08-03",
          partner: "Szállító Kft.",
          amount: "12700",
          currency: "HUF",
          paperOriginal: false,
          documents: [
            {
              number: "SZ-1",
              file: { fileName: "a.xml", content: Buffer.from("<Szamla/>") },
            },
            {
              number: "SZ-2",
              file: {
                fileName: "b.pdf",
                content: Buffer.from("%PDF-1.4 torott"),
              },
            },
            {
              number: "SZ-3",
              file: { fileName: "c.pdf", content: await pdfOfPages(1) },
            },
          ],
        },
        {
          bookingDate: "2026-08-04",
          partner: "Papír Bt.",
          amount: "500",
          currency: "HUF",
          paperOriginal: true,
          documents: [{ number: "NAV-9", file: null }],
        },
      ],
    });
    assert.deepEqual(outcomes, ["NOT_PDF", "UNREADABLE", "ATTACHED", "PAPER"]);
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), 2);
    const cover = (await pdfTextLines(new Uint8Array(pdf))).join("\n");
    for (const expected of [
      "Könyvelői csomag, 2026. augusztus",
      "12 700 HUF",
      "SZ-1: nem PDF, nincs benne",
      "SZ-2: a PDF nem olvasható, nincs benne",
      "SZ-3: csatolva",
      "NAV-9: papíron megvan",
    ])
      assert.ok(cover.includes(expected), `a borítón nincs: ${expected}`);
  });
});

/*
  A KIÁLLÍTÓ CÉG NEVE A SZÁMLASZÁM UTÁN (Balázs, 2026-11-02 21:18 UTC): a banki
  közlemény („SIMPLEP*dijnet”) nem mondja meg, ki állította ki a számlát. MI
  PIROSÍT: ha a kiállító neve hiányozna a számlaszám után, amikor eltér a soron
  álló partnertől; ha a névvel azonos kiállító is kiírva ismétlődne; ha a
  kiállító nélküli dokumentum üres zárójelet kapna.
*/
describe("the package names the issuer after the invoice number", () => {
  const cover = async (supplierName: string, partner: string) => {
    const { missing } = service({
      debits: [
        debit("2026-08-08", 1979, partner, { narrative: "168987SZC26" }),
      ],
      documents: [
        document({
          id: "dij",
          number: "168987SZC26",
          gross: D(1979),
          supplierName,
        }),
      ],
      files: { dij: await pdfOfPages(1) },
    });
    const { content } = await missing.accountantPackage("2026-08");
    return (await pdfTextLines(new Uint8Array(content))).join(" ");
  };

  it("a bank text that is not the issuer: the issuer follows the number", async () => {
    const text = await cover("Dijnet Zrt.", "SIMPLEP*dijnet");
    assert.ok(text.includes("168987SZC26 (Dijnet Zrt.): csatolva"), text);
    assert.ok(text.includes("SIMPLEP*dijnet"), text);
  });

  it("the same name as the partner is not repeated, and no name means no brackets", async () => {
    const same = await cover("szállító  kft.", "Szállító Kft.");
    assert.ok(same.includes("168987SZC26: csatolva"), same);
    const none = await cover("", "SIMPLEP*dijnet");
    assert.ok(none.includes("168987SZC26: csatolva"), none);
    assert.ok(!none.includes("()"), none);
  });
});

describe("a paper-only item (Aqua-Light, acrobot 25752; murena's export test, 25764)", () => {
  // MI PIROSIT: ha a jelolt, szamla nelkuli tetel a hianylistan maradna,
  // vagy a konyveloi csomag boritoja nem sorolna fel "papiron megvan"-kent;
  // a jeloletlen ag a kontroll (enelkul egy mindig ures xlsx is zold volna)
  for (const marked of [true, false])
    it(`${marked ? "marked: off the missing list, on the cover as paper" : "unmarked: stays on the missing list, not on the cover"}`, async () => {
      const { missing } = service({
        debits: [
          debit("2026-08-07", 297458, "AQUA-LIGHT GmbH", {
            paperOriginalAt: marked ? new Date() : null,
          }),
        ],
        documents: [],
        files: {},
      });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        (await missing.missingXlsx("2026-08"))
          .content as unknown as ExcelJS.Buffer,
      );
      const rows: string[] = [];
      workbook.worksheets[0]!.eachRow((row, i) => {
        if (i > 1) rows.push((row.values as unknown[]).join("|"));
      });
      assert.equal(
        rows.some((r) => r.includes("AQUA-LIGHT")),
        !marked,
      );

      const { content } = await missing.accountantPackage("2026-08");
      const cover = (await pdfTextLines(new Uint8Array(content))).join("\n");
      assert.equal(cover.includes("AQUA-LIGHT GmbH | 297 458 HUF"), marked);
      assert.equal(cover.includes("papíron megvan"), marked);
    });
});

/**
 * A PAPÍRON IS MEGLÉVŐ SZÁMLA (Balázs, 2026-11-02 11:21 UTC, kártya: Megvan
 * sorok „Papíron megvan” jelölője). MI PIROSÍT: ha a jelölt, párosított számla
 * PDF-je mégis a csomagba kerülne (vagy a fájlját akkor is lekérnénk); ha a
 * tétel a borítóról eltűnne; ha a jeletlen tételé is kimaradna (enélkül egy
 * mindig üres csomag is zöld volna: ez a kontroll); ha a jelölés visszavonása
 * nem hozná vissza a PDF-et.
 */
describe("a paired invoice that is on paper too", () => {
  const build = async (paperOriginalAt: Date | null) => {
    const { missing, asked } = service({
      debits: [debit("2026-08-03", 1000, "Szállító Kft.", { paperOriginalAt })],
      documents: [document({ id: "ok", gross: D(1000) })],
      files: { ok: await pdfOfPages(2) },
    });
    const { content } = await missing.accountantPackage("2026-08");
    return {
      pages: (await PDFDocument.load(content)).getPageCount(),
      cover: (await pdfTextLines(new Uint8Array(content))).join("\n"),
      asked: asked.flat(),
    };
  };

  it("unmarked: its PDF is in the package (the control)", async () => {
    const result = await build(null);
    assert.equal(result.pages, 1 + 2);
    assert.ok(result.cover.includes("SZ-ok: csatolva"), result.cover);
    assert.deepEqual(result.asked, ["ok"]);
  });

  it("marked: no PDF in the package and no file fetched, the item stays on the cover as paper", async () => {
    const result = await build(new Date("2026-11-02T10:00:00Z"));
    assert.equal(result.pages, 1);
    assert.ok(result.cover.includes("Szállító Kft. | 1 000 HUF"), result.cover);
    assert.ok(result.cover.includes("SZ-ok: papíron megvan"), result.cover);
    assert.ok(!result.cover.includes("csatolva"), result.cover);
    assert.deepEqual(result.asked, []);
  });

  it("the package builder itself leaves a marked entry's PDF out, even when the file is handed to it", async () => {
    const { pdf, outcomes } = await buildAccountantPackage({
      month: "2026-08",
      company: { name: "Acropora Kft.", taxNumber: "23916229" },
      entries: [
        {
          bookingDate: "2026-08-03",
          partner: "Szállító Kft.",
          amount: "1000",
          currency: "HUF",
          paperOriginal: true,
          documents: [
            {
              number: "SZ-1",
              file: { fileName: "a.pdf", content: await pdfOfPages(3) },
            },
          ],
        },
      ],
    });
    assert.deepEqual(outcomes, ["PAPER"]);
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
  });
});

/**
 * A RENDEZÉS A LAPOZÁS ELŐTT (Balázs, 2026-11-02 12:49 UTC). MI PIROSÍT: ha a
 * szerver az oldalt vágná, és csak utána rendezne (az 1. oldal nem a legnagyobb
 * összegeket adná); ha a 2. oldal a rendezés irányát elveszítené.
 */
describe("the month list is sorted before it is paged", () => {
  const amounts = [500, 90000, 1200, 45000, 7, 300000];
  const build = () =>
    service({
      debits: amounts.map((amount, i) =>
        debit(`2026-08-0${i + 1}`, amount, `Szállító ${i + 1}`),
      ),
      documents: [],
      files: {},
    }).missing;

  it("the first page holds the largest amounts of the WHOLE set, the second the next ones", async () => {
    const missing = build();
    const page = async (n: number) =>
      (
        await missing.month("2026-08", {
          tab: "ALL",
          sort: "amount",
          direction: "desc",
          page: n,
          pageSize: 2,
        })
      ).items.map((i) => i.amount);
    assert.deepEqual(await page(1), ["300000", "90000"]);
    assert.deepEqual(await page(2), ["45000", "1200"]);
    assert.deepEqual(await page(3), ["500", "7"]);
  });

  it("ascending is the reverse order, and no sort keeps the list's own order", async () => {
    const missing = build();
    const ask = async (extra: object) =>
      (
        await missing.month("2026-08", {
          tab: "ALL",
          page: 1,
          pageSize: 100,
          ...extra,
        })
      ).items.map((i) => i.amount);
    const asc = await ask({ sort: "amount", direction: "asc" });
    assert.deepEqual(asc, ["7", "500", "1200", "45000", "90000", "300000"]);
    assert.equal((await ask({})).length, 6);
    assert.deepEqual(
      (await ask({ sort: "amount" })).slice(),
      asc,
      "the direction defaults to ascending",
    );
  });
});

/*
  A KÖNYVELŐI CSOMAG A SZÁMLA KELTE SZERINT (Balázs, 2026-11-02 20:12 UTC,
  a kelte 2026-11-04 07:11 UTC óta): a hónap MINDEN bejövő számlája benne van, kifizetve vagy sem, és egy
  számla pontosan egy hónapban.

  MI PIROSÍT: ha a kifizetetlen számla (a Fluidra KS26/12407 alakja: kiállítva
  és teljesítve 10-22, nincs terhelés) kimaradna; ha a szeptemberi számla, amit
  októberben fizettek, az októberi csomagban IS szerepelne; ha a PDF nélküli
  számla nem a „PDF hiányzik” sorral jönne; ha a papíron meglévő számla fájlja
  bekerülne, vagy „PDF hiányzik”-ot kapna; ha a sorok által már hordott
  dokumentum a banki oldalról másodszor is megjelenne.
*/
describe("the accountant package by invoice date", () => {
  const billingRow = (
    overrides: Partial<PackageBillingRow> & { id: string },
  ): PackageBillingRow => ({
    documentNumber: `KS-${overrides.id}`,
    supplierName: "Fluidra Magyarország Kft.",
    supplierTaxNumber: "12345678-2-41",
    sourceDocumentId: `src-${overrides.id}`,
    grossAmount: D(56420),
    currency: "HUF",
    issueDate: new Date("2026-10-22T00:00:00Z"),
    paperOriginalAt: null,
    pdfIds: [`src-${overrides.id}`],
    ...overrides,
  });
  const coverOf = async (
    input: Parameters<typeof service>[0],
    month = "2026-10",
  ) => {
    const { missing } = service(input);
    const { content } = await missing.accountantPackage(month);
    return {
      pages: (await PDFDocument.load(content)).getPageCount(),
      cover: (await pdfTextLines(new Uint8Array(content))).join(" "),
    };
  };

  it("an UNPAID invoice is in the package with its PDF (no bank debit at all)", async () => {
    const { pages, cover } = await coverOf({
      debits: [],
      documents: [],
      billing: [billingRow({ id: "fluidra", documentNumber: "KS26/12407" })],
      files: { "src-fluidra": await pdfOfPages(2) },
    });
    assert.equal(pages, 1 + 2);
    assert.ok(cover.includes("2026-10-22"), cover);
    assert.ok(cover.includes("Fluidra Magyarország Kft."), cover);
    assert.ok(cover.includes("56 420 HUF"), cover);
    assert.ok(cover.includes("KS26/12407: csatolva"), cover);
  });

  it("an invoice with no PDF from any source is a cover line, PDF hiányzik, with number, supplier and amount", async () => {
    const { pages, cover } = await coverOf({
      debits: [],
      documents: [],
      billing: [
        billingRow({
          id: "nopdf",
          documentNumber: "KS26/00001",
          grossAmount: D("123.50"),
          currency: "EUR",
          pdfIds: [],
        }),
      ],
      files: {},
    });
    assert.equal(pages, 1);
    assert.ok(cover.includes("KS26/00001: PDF hiányzik"), cover);
    assert.ok(cover.includes("Fluidra Magyarország Kft."), cover);
    assert.ok(cover.includes("123,50 EUR"), cover);
    assert.ok(!cover.includes("nincs tárolt fájl"), cover);
  });

  it("takes the first PDF among the candidates, and a non-PDF file is named on the cover", async () => {
    const xml = new TextEncoder().encode("<Szamla/>");
    const withPdf = await coverOf({
      debits: [],
      documents: [],
      billing: [billingRow({ id: "two", pdfIds: ["xml", "pdf"] })],
      files: { xml, pdf: await pdfOfPages(1) },
    });
    assert.equal(withPdf.pages, 2);
    const onlyXml = await coverOf({
      debits: [],
      documents: [],
      billing: [
        billingRow({ id: "x", documentNumber: "KS-X", pdfIds: ["xml"] }),
      ],
      files: { xml },
    });
    assert.equal(onlyXml.pages, 1);
    assert.ok(
      onlyXml.cover.includes("KS-X: nem PDF, nincs benne"),
      onlyXml.cover,
    );
  });

  it("a September invoice paid in October is NOT in the October package: the bank side leaves out what a row already brings", async () => {
    // a feed-sor (szeptember) a dokumentumán át hordozza; a terhelés októberi
    const { pages, cover } = await coverOf({
      debits: [debit("2026-10-05", 1000, "Szállító Kft.")],
      documents: [
        document({
          id: "mb-sept",
          number: "SEPT-1",
          date: "2026-09-20",
          gross: D(1000),
        }),
      ],
      billing: [],
      refs: [{ sourceDocumentId: "mb-sept", documentNumber: "SEPT-1" }],
      files: { "mb-sept": await pdfOfPages(1) },
    });
    assert.equal(pages, 1);
    assert.ok(!cover.includes("SEPT-1"), cover);
    assert.ok(!cover.includes("Szállító Kft."), cover);
  });

  it("an invoice a row carries is on the bank side NOWHERE else: once, with the row's own data", async () => {
    // a postafiókos példány száma szóközzel írt, a feed-soré nem: szám szerint
    // egyezik, tehát egyszer szerepel (a sor saját adatával)
    const { pages, cover } = await coverOf({
      debits: [debit("2026-10-05", 56420, "Fluidra Magyarország Kft.")],
      documents: [
        document({
          id: "mb-f",
          number: "KS 26/12407",
          date: "2026-10-22",
          gross: D(56420),
          supplierName: "Fluidra Magyarország Kft.",
        }),
      ],
      billing: [billingRow({ id: "fluidra", documentNumber: "KS26/12407" })],
      files: {
        "src-fluidra": await pdfOfPages(1),
        "mb-f": await pdfOfPages(1),
      },
    });
    assert.equal(pages, 2);
    assert.equal(cover.split("56 420 HUF").length - 1, 1, cover);
    assert.ok(cover.includes("számla kelte"), cover);
  });

  it("the mailbox-only invoice stays, in the month of its OWN date, not the payment's", async () => {
    const input = {
      debits: [debit("2026-10-03", 1000, "Szállító Kft.")],
      documents: [
        document({ id: "mb-sept", number: "MB-1", date: "2026-09-28" }),
      ],
      billing: [],
      files: { "mb-sept": await pdfOfPages(1) },
    };
    const october = await coverOf(input, "2026-10");
    assert.equal(october.pages, 1);
    assert.ok(!october.cover.includes("MB-1"), october.cover);
    const september = await coverOf(input, "2026-09");
    assert.equal(september.pages, 2);
    assert.ok(september.cover.includes("MB-1: csatolva"), september.cover);
  });

  it("a paper-original invoice: no PDF in the package, the cover says papíron megvan (not PDF hiányzik)", async () => {
    const { pages, cover } = await coverOf({
      debits: [
        debit("2026-10-05", 56420, "Fluidra Magyarország Kft.", {
          paperOriginalAt: new Date("2026-10-06T00:00:00Z"),
        }),
      ],
      documents: [
        document({
          id: "src-fluidra",
          source: "SZAMLAZZ",
          number: "KS26/12407",
          date: "2026-10-22",
          gross: D(56420),
          supplierName: "Fluidra Magyarország Kft.",
        }),
      ],
      billing: [billingRow({ id: "fluidra", documentNumber: "KS26/12407" })],
      files: { "src-fluidra": await pdfOfPages(3) },
    });
    assert.equal(pages, 1);
    assert.ok(cover.includes("KS26/12407: papíron megvan"), cover);
    assert.ok(!cover.includes("PDF hiányzik"), cover);
  });

  it("the paper mark on the DEBIT reaches the invoice row when the debit is paired to the mailbox copy (another id, same number): papíron megvan, not nem PDF", async () => {
    // MMXH alakja (Balázs, 2026-11-03 00:03 UTC): a terhelés a postafiókos
    // példányhoz van párosítva, a sor saját forrás-dokumentuma (src-fluidra)
    // egy nem PDF fájl, és a borító „nem PDF, nincs benne”-t írt
    const { pages, cover } = await coverOf({
      debits: [
        debit("2026-10-05", 56420, "Fluidra Magyarország Kft.", {
          paperOriginalAt: new Date("2026-10-06T00:00:00Z"),
        }),
      ],
      documents: [
        document({
          id: "mb-f",
          number: "KS 26/12407",
          date: "2026-10-22",
          gross: D(56420),
          supplierName: "Fluidra Magyarország Kft.",
        }),
      ],
      billing: [billingRow({ id: "fluidra", documentNumber: "KS26/12407" })],
      files: { "src-fluidra": new TextEncoder().encode("<Szamla/>") },
    });
    assert.equal(pages, 1);
    assert.ok(cover.includes("KS26/12407: papíron megvan"), cover);
    assert.ok(!cover.includes("nem PDF"), cover);
  });

  it("the same compacted number at ANOTHER supplier: the marked debit's paper mark does not drop that supplier's PDF from the package", async () => {
    // barracuda, #2013 review: 2026/0001 és 2026-0001
    const { pages, cover } = await coverOf({
      debits: [
        debit("2026-10-05", 56420, "Fluidra Magyarország Kft.", {
          paperOriginalAt: new Date("2026-10-06T00:00:00Z"),
        }),
      ],
      documents: [
        document({
          id: "mb-f",
          number: "2026/0001",
          date: "2026-10-22",
          gross: D(56420),
          supplierName: "Fluidra Magyarország Kft.",
        }),
      ],
      billing: [
        billingRow({
          id: "other",
          documentNumber: "2026-0001",
          supplierName: "Másik Szállító Kft.",
          sourceDocumentId: "src-other",
          pdfIds: ["src-other"],
        }),
      ],
      files: { "src-other": await pdfOfPages(1) },
    });
    assert.equal(pages, 2, "the other supplier's PDF is in the package");
    assert.ok(cover.includes("2026-0001: csatolva"), cover);
    assert.ok(!cover.includes("papíron megvan"), cover);
  });

  it("documentPairings: one number key, the MARKED pairing wins, so the list agrees with the package", async () => {
    const unmarked = debit("2026-10-03", 1000, "Szállító Kft.");
    const marked = debit("2026-10-04", 1000, "Szállító Kft.", {
      paperOriginalAt: new Date("2026-10-06T00:00:00Z"),
    });
    const { missing } = service({
      debits: [unmarked, marked],
      documents: [
        document({
          id: "a",
          number: "AB 1",
          date: "2026-10-02",
          gross: D(1000),
        }),
        document({
          id: "b",
          number: "AB-1",
          date: "2026-10-02",
          gross: D(1000),
        }),
      ],
      files: {},
    });
    const pairings = await missing.documentPairings();
    const key = pairingNumberKey("AB 1", "Szállító Kft.")!;
    const byKey = pairings.get(key);
    const byId = [pairings.get("a"), pairings.get("b")];
    assert.ok(byKey, "the number key exists");
    assert.ok(
      byId.some((p) => p?.paperOriginal),
      "precondition: one of the two documents is paired to the marked debit",
    );
    // ha bármelyik párosítás jelölt, a kulcs a jelöltet adja
    assert.equal(
      byKey!.paperOriginal,
      byId.some((p) => p?.paperOriginal),
    );
  });

  it("a cancelled purchase's original dated in September and refunded in October is in the October refund row only", async () => {
    const input = {
      debits: [
        debit("2026-10-21", 85000, "Tesla Inc", {
          narrative: "2026.10.17 7413124583 Tesla Inc -APPLE",
        }),
      ],
      documents: [
        document({
          id: "nav-orig",
          source: "NAV",
          number: "4042A0000031808",
          date: "2026-10-17",
          gross: D(0),
          supplierName: "Tesla Hungary Kft.",
          hasOriginal: false,
        }),
        document({
          id: "cr",
          number: "CR4042A0000012507",
          date: "2026-10-18",
          gross: D(-85000),
          supplierName: "Tesla Hungary Kft.",
        }),
      ],
      billing: [
        billingRow({
          id: "orig",
          documentNumber: "4042A0000031808",
          sourceDocumentId: "nav-orig",
          grossAmount: D(0),
          supplierName: "Tesla Hungary Kft.",
          issueDate: new Date("2026-09-30T00:00:00Z"),
        }),
      ],
      files: { cr: await pdfOfPages(1) },
    };
    const september = await coverOf(input, "2026-09");
    assert.ok(!september.cover.includes("4042A0000031808"), september.cover);
    const october = await coverOf(input, "2026-10");
    assert.ok(october.cover.includes("sztornózott vásárlás"), october.cover);
  });

  it("an UNPAID invoice marked paper-original on its own row: no PDF in the package, papíron megvan, not PDF hiányzik", async () => {
    const { pages, cover } = await coverOf({
      debits: [],
      documents: [],
      billing: [
        billingRow({
          id: "paper",
          documentNumber: "KS26/00099",
          paperOriginalAt: new Date("2026-10-23T00:00:00Z"),
        }),
      ],
      files: { "src-paper": await pdfOfPages(3) },
    });
    assert.equal(pages, 1);
    assert.ok(cover.includes("KS26/00099: papíron megvan"), cover);
    assert.ok(!cover.includes("PDF hiányzik"), cover);
  });

  it("a cancelled purchase keeps original and credit note in one row, and the row's own copy is not added a second time", async () => {
    const { pages, cover } = await coverOf(
      {
        debits: [
          debit("2026-10-21", 85000, "Tesla Inc", {
            narrative: "2026.10.17 7413124583 Tesla Inc -APPLE",
          }),
        ],
        documents: [
          document({
            id: "nav-orig",
            source: "NAV",
            number: "4042A0000031808",
            date: "2026-10-17",
            gross: D(0),
            supplierName: "Tesla Hungary Kft.",
            hasOriginal: false,
          }),
          document({
            id: "cr",
            number: "CR4042A0000012507",
            date: "2026-10-18",
            gross: D(-85000),
            supplierName: "Tesla Hungary Kft.",
          }),
        ],
        // a jóváíró feed-sora is ott áll a bejövő számlák között
        billing: [
          billingRow({
            id: "cr",
            documentNumber: "CR4042A0000012507",
            sourceDocumentId: "cr",
            grossAmount: D(-85000),
            supplierName: "Tesla Hungary Kft.",
          }),
        ],
        files: { cr: await pdfOfPages(1) },
      },
      "2026-10",
    );
    assert.ok(cover.includes("sztornózott vásárlás"), cover);
    // a sor saját példánya (szállítóval, „számla kelte” jelöléssel) nincs
    // ott: csak a sztornózott vásárlás sora
    assert.ok(!cover.includes("| Tesla Hungary Kft."), cover);
    assert.ok(!cover.includes("számla kelte"), cover);
    assert.equal(pages, 2);
  });

  /*
    A HÓNAP LAPJA A CSOMAG SZEMÉVEL (Balázs, 2026-11-02 22:37 UTC: a csomag
    borítóján „nem PDF”, a Hiányzó számlák lapon ez nem látszott).

    MI PIROSÍT: ha a lap más döntést használna, mint a borító (a darabszámuk
    eltér); ha a ki nem fizetett számla nem szerepelne a blokkban; ha a
    kifizetett számla PDF-hiánya nem a terhelés során látszana; ha a lap a
    teljes fájlokat húzná be (a fejléc elég); ha a papíron meglévő számla
    hiányzónak látszana; ha a szűrő nem a csomag döntéséből szűrne.
  */
  it("the page check and the package cover are ONE decision: the same lacking count, unpaid invoices listed with their PDF status", async () => {
    const input = {
      debits: [],
      documents: [],
      billing: [
        billingRow({ id: "ok", documentNumber: "KS-OK" }),
        billingRow({ id: "nopdf", documentNumber: "KS-NOPDF", pdfIds: [] }),
        billingRow({ id: "xml", documentNumber: "KS-XML", pdfIds: ["xml"] }),
        billingRow({
          id: "paper",
          documentNumber: "KS-PAPER",
          pdfIds: [],
          paperOriginalAt: new Date("2026-10-23T00:00:00Z"),
        }),
      ],
      files: {
        "src-ok": await pdfOfPages(1),
        xml: new TextEncoder().encode("<Szamla/>"),
      },
    };
    const { missing, asked, askedHeads } = service(input);
    const check = await missing.packageCheck("2026-10");
    assert.deepEqual(
      check.unpaid.map((invoice) => [invoice.number, invoice.pdf]),
      [
        ["KS-OK", "ATTACHED"],
        ["KS-NOPDF", "PDF_MISSING"],
        ["KS-XML", "NOT_PDF"],
        ["KS-PAPER", "PAPER"],
      ],
    );
    assert.equal(check.lackingCount, 2);
    assert.deepEqual(check.items, []);
    assert.equal(asked.length, 0, "the page reads heads, never the full files");
    assert.ok(askedHeads.length > 0);
    // a borító UGYANEZT mondja
    const { cover } = await coverOf(input);
    const lackingOnCover = [
      ...cover.matchAll(/PDF hiányzik|nem PDF, nincs benne|nincs tárolt fájl/g),
    ].length;
    assert.equal(lackingOnCover, check.lackingCount, cover);
    assert.ok(cover.includes("KS-PAPER: papíron megvan"), cover);
  });

  it("an unreadable PDF is the one thing the page cannot see: the page says it is in the package, the cover says it is unreadable", async () => {
    const broken = new TextEncoder().encode("%PDF-1.4 this is not a pdf");
    const input = {
      debits: [],
      documents: [],
      billing: [billingRow({ id: "broken", documentNumber: "KS-BROKEN" })],
      files: { "src-broken": broken },
    };
    const check = await service(input).missing.packageCheck("2026-10");
    assert.equal(check.unpaid[0]!.pdf, "ATTACHED");
    assert.equal(check.lackingCount, 0);
    const { cover } = await coverOf(input);
    assert.ok(cover.includes("KS-BROKEN: a PDF nem olvasható"), cover);
  });

  it("a PAID invoice shows on its debit: the missing PDF is attached to the invoice ROW, and it is not in the unpaid block", async () => {
    const paid = debit("2026-10-05", 56420, "Fluidra Magyarország Kft.");
    const { missing } = service({
      debits: [paid],
      documents: [
        // a terheléshez a postafiókos példány van párosítva: más azonosító, ugyanaz a szám
        document({
          id: "mb-f",
          number: "KS 26/12407",
          date: "2026-10-22",
          gross: D(56420),
          supplierName: "Fluidra Magyarország Kft.",
        }),
      ],
      billing: [
        billingRow({
          id: "fluidra",
          documentNumber: "KS26/12407",
          pdfIds: [],
        }),
      ],
      files: {},
    });
    const check = await missing.packageCheck("2026-10");
    assert.deepEqual(check.items, [
      {
        id: paid.id,
        pdf: "PDF_MISSING",
        attach: { kind: "ROW", id: "fluidra" },
      },
    ]);
    assert.deepEqual(check.unpaid, []);
    assert.equal(check.lackingCount, 1);
  });

  it("a debit whose invoice only the bank side knows: the PDF is attached through the debit (BANK), and a stored file means it is in", async () => {
    const withFile = debit("2026-10-03", 1000, "Szállító Kft.");
    const noFile = debit("2026-10-04", 2000, "Másik Bt.");
    const { missing } = service({
      debits: [withFile, noFile],
      documents: [
        document({
          id: "mb-1",
          number: "MB-1",
          date: "2026-10-02",
          gross: D(1000),
        }),
        document({
          id: "mb-2",
          number: "MB-2",
          date: "2026-10-02",
          gross: D(2000),
          supplierName: "Másik Bt.",
        }),
      ],
      billing: [],
      files: { "mb-1": await pdfOfPages(1) },
    });
    const check = await missing.packageCheck("2026-10");
    assert.deepEqual(
      check.items.map((entry) => [entry.id, entry.pdf, entry.attach.kind]),
      [
        [withFile.id, "ATTACHED", "BANK"],
        [noFile.id, "NO_FILE", "BANK"],
      ],
    );
  });

  it("the month list filters on the package decision before it pages: only the items lacking a PDF", async () => {
    const good = debit("2026-10-03", 1000, "Szállító Kft.");
    const bad = debit("2026-10-04", 2000, "Másik Bt.");
    const { missing } = service({
      debits: [good, bad],
      documents: [
        document({
          id: "mb-1",
          number: "MB-1",
          date: "2026-10-02",
          gross: D(1000),
        }),
        document({
          id: "mb-2",
          number: "MB-2",
          date: "2026-10-02",
          gross: D(2000),
          supplierName: "Másik Bt.",
        }),
      ],
      billing: [],
      files: { "mb-1": await pdfOfPages(1) },
    });
    const all = await missing.month("2026-10", {
      tab: "FOUND",
      page: 1,
      pageSize: 25,
    });
    assert.equal(all.pagination.totalItems, 2);
    const lacking = await missing.month("2026-10", {
      tab: "FOUND",
      packagePdf: "MISSING",
      page: 1,
      pageSize: 25,
    });
    assert.deepEqual(
      lacking.items.map((item) => item.id),
      [bad.id],
    );
    assert.equal(lacking.pagination.totalItems, 1);
  });
});

/*
  A SZÁMLÁN ÁLLÓ „PAPÍRON MEGVAN” A PÁROSÍTOTT TERHELÉS TÉTELÉN IS LÁTSZIK
  (Balázs, 2026-11-02 22:23 UTC): egy korábbi hónapban teljesített, a bejövő
  számlák során jelölt számla későbbi terhelése nem „hiányzik”, és a jelölés
  látszik rajta. MI PIROSÍT: ha a számlán álló jelölés nem érné el a terhelés
  tételét; ha a jelöletlen számla terhelése is papírosnak látszana (kontroll);
  ha a jelölés a számla másik forrású társáról (összevont jelölt) elveszne.
*/
describe("the paper mark of the invoice shows on its paired debit", () => {
  const items = async (documents: CandidateDocument[]) => {
    const { missing } = service({
      debits: [
        debit("2026-08-10", 1000, "Szállító Kft."),
        debit("2026-08-11", 2000, "Másik Kft."),
      ],
      documents,
      files: {},
    });
    const month = await missing.month("2026-08", {
      tab: "ALL",
      page: 1,
      pageSize: 100,
    });
    return new Map(month.items.map((item) => [item.partner, item]));
  };

  it("a marked invoice: the debit is Megvan and shows the mark; the unmarked one does not", async () => {
    const result = await items([
      document({ id: "marked", gross: D(1000), paperMarked: true }),
      document({
        id: "plain",
        gross: D(2000),
        supplierName: "Másik Kft.",
      }),
    ]);
    const marked = result.get("Szállító Kft.")!;
    const plain = result.get("Másik Kft.")!;
    assert.deepEqual([marked.state, marked.paperOriginal], ["FOUND", true]);
    // a jelölés a SZÁMLÁN áll: a terhelésen itt nem vonható vissza
    assert.equal(marked.paperOriginalMarkedHere, false);
    assert.deepEqual([plain.state, plain.paperOriginal], ["FOUND", false]);
  });

  it("a mark on the debit itself is marked here, with or without the invoice's", async () => {
    const { missing } = service({
      debits: [
        debit("2026-08-10", 1000, "Szállító Kft.", {
          paperOriginalAt: new Date(),
        }),
      ],
      documents: [document({ id: "d1", gross: D(1000) })],
      files: {},
    });
    const month = await missing.month("2026-08", {
      tab: "ALL",
      page: 1,
      pageSize: 10,
    });
    const item = month.items.find((i) => i.partner === "Szállító Kft.")!;
    assert.deepEqual(
      [item.paperOriginal, item.paperOriginalMarkedHere],
      [true, true],
    );
  });

  it("a merged candidate carries the mark of any of its sources", async () => {
    const result = await items([
      document({
        id: "nav-1",
        source: "NAV",
        gross: D(1000),
        hasOriginal: true,
        aliasIds: ["feed-1"],
        paperMarked: true,
      }),
    ]);
    assert.equal(result.get("Szállító Kft.")!.paperOriginal, true);
  });
});
