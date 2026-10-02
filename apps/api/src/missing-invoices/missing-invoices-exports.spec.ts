import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";

import type { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import type { CandidateDocument } from "./missing-invoice-matching.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { buildAccountantPackage } from "./missing-invoices-package.pdf.js";
import type { MissingInvoicesRepository } from "./missing-invoices.repository.js";
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
): CandidateDocument => ({
  source: "MAILBOX",
  number: `SZ-${overrides.id}`,
  date: "2026-08-01",
  gross: D(1000),
  currency: "HUF",
  supplierName: "Szállító Kft.",
  supplierAccounts: [],
  kind: "INVOICE",
  payee: "COMPANY",
  hasOriginal: true,
  ...overrides,
});

function service(input: {
  debits: ReturnType<typeof debit>[];
  documents: CandidateDocument[];
  files: Record<string, Uint8Array>;
}) {
  const asked: string[][] = [];
  const repository = {
    accounts: async () => [ACCOUNT],
    debits: async () => input.debits,
    credits: async () => [],
    statementCoverage: async () => new Set([`${ACCOUNT.id}:2026-08`]),
    manualMatches: async () => new Map(),
    candidates: async () => input.documents,
    uncheckedMailboxContent: async () => [],
    setPayee: async () => undefined,
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
      "4042A0000031808: nincs tárolt fájl",
      "CR4042A0000012507: csatolva",
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
