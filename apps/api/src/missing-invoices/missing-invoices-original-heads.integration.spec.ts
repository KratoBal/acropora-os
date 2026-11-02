import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { headOutcome } from "./missing-invoices-package.pdf.js";
import { MissingInvoicesRepository } from "./missing-invoices.repository.js";

/**
 * A HÓNAP LAPJA A FÁJLOK FEJLÉCÉT OLVASSA valódi adatbázison (`originalHeads`:
 * nyers SQL, `substring(... from 1 for 5)`), mert a hamis tárolóval futó
 * egységtesztek a tábla- és oszlopneveket nem látják (barracuda, #2014 review).
 *
 * MI PIROSÍT: ha a lekérdezés tábla- vagy oszlopneve elromlana (a végpont
 * 500-at adna); ha a fejléc nem öt bájt volna; ha a PDF és az XML döntése
 * ugyanaz lenne; ha a Foxpost-elszámolás PDF-je kimaradna; ha a teljes fájl
 * kerülne vissza a fejléc helyett.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "fejlec-teszt-";
const PDF = Buffer.from("%PDF-1.7 a teljes fájl hosszabb, mint a fejléc");
const XML = Buffer.from("<Szamla>nem PDF</Szamla>");

async function removeLeftovers() {
  await prisma.incomingSupplierDocument.deleteMany({
    where: { gmailMessageId: { startsWith: PREFIX } },
  });
  await prisma.foxpostSettlement.deleteMany({
    where: { gmailMessageId: { startsWith: PREFIX } },
  });
}

const supplierDocument = (name: string, content: Buffer) => ({
  gmailMessageId: `${PREFIX}${name}`,
  fileName: `${name}.bin`,
  sizeBytes: content.length,
  sha256: `${PREFIX}${name}`,
  content: new Uint8Array(content),
  status: "FAILED" as const,
  kind: "INVOICE" as const,
  origin: "UPLOAD",
});

describe(
  "az eredeti fájlok fejléce (originalHeads)",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new MissingInvoicesRepository();
    const ids: Record<string, string> = {};

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      for (const [name, content] of [
        ["pdf", PDF],
        ["xml", XML],
      ] as const)
        ids[name] = (
          await prisma.incomingSupplierDocument.create({
            data: supplierDocument(name, content),
            select: { id: true },
          })
        ).id;
      ids.foxpost = (
        await prisma.foxpostSettlement.create({
          data: {
            gmailMessageId: `${PREFIX}foxpost`,
            xlsxAttachmentId: `${PREFIX}x`,
            xlsxFileName: "elszamolas.xlsx",
            xlsxContent: new Uint8Array(Buffer.from("PK")),
            xlsxSha256: `${PREFIX}xlsx`,
            pdfAttachmentId: `${PREFIX}p`,
            pdfFileName: "elszamolas.pdf",
            pdfContent: new Uint8Array(PDF),
            pdfSha256: `${PREFIX}pdf`,
          },
          select: { id: true },
        })
      ).id;
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("returns five bytes of each stored file, from both tables, with the file name", async () => {
      const heads = await repository.originalHeads([
        ids.pdf!,
        ids.xml!,
        ids.foxpost!,
        "nem-letezo-azonosito",
      ]);
      assert.equal(heads.size, 3, "an unknown id is simply absent");
      assert.equal(heads.get(ids.pdf!)!.content.length, 5);
      assert.equal(heads.get(ids.pdf!)!.fileName, "pdf.bin");
      assert.equal(heads.get(ids.foxpost!)!.fileName, "elszamolas.pdf");
      assert.equal(
        Buffer.from(heads.get(ids.foxpost!)!.content).toString("latin1"),
        "%PDF-",
      );
    });

    it("the package decision on the head: the PDF is in, the XML is not a PDF", async () => {
      const heads = await repository.originalHeads([ids.pdf!, ids.xml!]);
      const outcome = (id: string) =>
        headOutcome({ paperOriginal: false }, { file: heads.get(id) ?? null });
      assert.equal(outcome(ids.pdf!), "ATTACHED");
      assert.equal(outcome(ids.xml!), "NOT_PDF");
    });

    it("an empty id list asks nothing", async () => {
      assert.equal((await repository.originalHeads([])).size, 0);
    });
  },
);
