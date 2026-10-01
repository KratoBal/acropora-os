import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { MissingInvoicesRepository } from "./missing-invoices.repository.js";
import { BillingDocumentListRepository } from "../billing/billing-document-list.repository.js";
import { SzamlazzFeedsRepository } from "./szamlazz-feeds.repository.js";

/**
 * A SZÁMLÁZZ.HU TOVÁBBÍTÁS A VALÓDI ADATBÁZISON (acrobot 25686). MI PIROSÍT: ha
 * egy újraküldött üzenet másodszor is bekerülne; ha a továbbított számla nem
 * lenne a Hiányzó számlák jelöltje, a saját forrásával, a bruttójával és a
 * szállító nevével (akkor az összeg-szabály nem párosíthatná).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "szamlazz-it-";

async function removeLeftovers() {
  await prisma.incomingBillingDocument.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.externalBillingDocument.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.szamlazzFeedMessage.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: { gmailMessageId: { startsWith: `szamlazz:szamlabe:${PREFIX}` } },
  });
}

describe(
  "a Számlázz.hu továbbítás tárolása",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new SzamlazzFeedsRepository();

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a kimenő számla vetítés-sorai bent maradtak",
          darab: await prisma.externalBillingDocument.count({
            where: { externalId: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a bejövő számla vetítés-sorai bent maradtak",
          darab: await prisma.incomingBillingDocument.count({
            where: { externalId: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a továbbítás teszt-sorai bent maradtak",
          darab: await prisma.szamlazzFeedMessage.count({
            where: { externalId: { startsWith: PREFIX } },
          }),
        },
      ]);
    });

    it("a message is stored once, a resent one is recognised", async () => {
      const message = {
        kind: "SZAMLAKI" as const,
        externalId: `${PREFIX}1`,
        sha256: "x",
        body: "<szamla/>",
      };
      assert.deepEqual(
        [
          await repository.storeRaw(message),
          await repository.storeRaw(message),
        ],
        ["NEW", "SEEN"],
      );
    });

    /**
     * UGYANAZ A SZÁMLA, MÁS TARTALOMMAL (acrobot 25781): a Számlázz.hu a
     * fizetési állapot vagy egy mező változása után ugyanazzal az azonosítóval
     * küldi újra. MI PIROSÍT: ha az új tartalom eldobódna (a régi egyedi kulcs
     * ezt tette); ha felülírná a régit; ha ugyanaz a tartalom kétszer íródna; ha
     * egy másik fajta azonos azonosítója változatnak számítana.
     */
    it("the same invoice with a different body is a new version, and the old one stays", async () => {
      const first = {
        kind: "SZAMLAKI" as const,
        externalId: `${PREFIX}2`,
        sha256: "elso",
        body: "<szamla>fizetetlen</szamla>",
      };
      const paid = {
        ...first,
        sha256: "masodik",
        body: "<szamla>fizetve</szamla>",
      };
      assert.deepEqual(
        [
          await repository.storeRaw(first),
          await repository.storeRaw(paid),
          await repository.storeRaw(paid),
          await repository.storeRaw({ ...first, kind: "SZAMLABE" }),
        ],
        ["NEW", "NEW_VERSION", "SEEN", "NEW"],
      );
      const rows = await prisma.szamlazzFeedMessage.findMany({
        where: { kind: "SZAMLAKI", externalId: `${PREFIX}2` },
        // a sha256 szerint, nem az idő szerint: két sor egy ezredmásodpercen belül
        // is keletkezhet, és az azonos időbélyeg sorrendje nem rögzített
        orderBy: { sha256: "asc" },
        select: { sha256: true, body: true },
      });
      assert.deepEqual(rows, [
        { sha256: "elso", body: "<szamla>fizetetlen</szamla>" },
        { sha256: "masodik", body: "<szamla>fizetve</szamla>" },
      ]);
    });

    /**
     * A KIMENŐ SZÁMLA A SZÁMLÁZÁS LISTÁJÁBA (acrobot 25812), a valódi
     * adatbázison. MI PIROSÍT: ha egy korábbi változat felülírná a későbbit (a
     * visszatöltés bármilyen sorrendben futhat); ha a változatok száma nem
     * számolódna; ha a lista „csak a külsők” szűrővel nem hozná, vagy „csak a
     * mieink” szűrővel hozná.
     */
    it("an outgoing invoice is projected once, from its latest version, and lists as external", async () => {
      const externalId = `${PREFIX}ki-1`;
      const base = {
        kind: "SZAMLAKI" as const,
        externalId,
        body: "<szamla/>",
      };
      await repository.storeRaw({ ...base, sha256: "regi" });
      await repository.storeRaw({ ...base, sha256: "uj" });
      // az érkezés sorrendje rögzítve: egy ezredmásodpercen belül is jöhettek
      await prisma.szamlazzFeedMessage.updateMany({
        where: { externalId, sha256: "regi" },
        data: { receivedAt: new Date("2026-10-01T10:00:00Z") },
      });
      await prisma.szamlazzFeedMessage.updateMany({
        where: { externalId, sha256: "uj" },
        data: { receivedAt: new Date("2026-10-01T11:00:00Z") },
      });
      const projection = (documentNumber: string) => ({
        externalId,
        kindCode: "SZ",
        documentNumber,
        electronic: true,
        issueDate: "2026-09-30",
        fulfillmentDate: null,
        dueDate: "2026-10-08",
        paymentMethod: "Átutalás",
        currency: "HUF",
        customerName: "Teszt Akvárium Bt.",
        customerTaxNumber: null,
        customerAddress: null,
        netAmount: "100",
        vatAmount: "27",
        grossAmount: "127",
        lines: [],
        cancelled: false,
        // a legújabb változat hozza a kifizetést (a Számlázz.hu újraküldi)
        payments:
          documentNumber === "UJ-1"
            ? [
                {
                  date: "2026-09-28",
                  title: "átutalás",
                  amount: "127",
                  note: "Automatikus banki tranzakció párosítás",
                  bankTransactionId: "77877311",
                },
              ]
            : [],
        paymentsKnown: documentNumber === "UJ-1",
        paidAmount: documentNumber === "UJ-1" ? "127.00" : "0.00",
        lastPaymentDate: documentNumber === "UJ-1" ? "2026-09-28" : null,
      });
      assert.deepEqual(
        [
          await repository.projectOutgoing({
            externalId,
            sha256: "uj",
            projection: projection("UJ-1"),
          }),
          await repository.projectOutgoing({
            externalId,
            sha256: "regi",
            projection: projection("REGI-1"),
          }),
          await repository.projectOutgoing({
            externalId,
            sha256: "nincs",
            projection: projection("SEHOL"),
          }),
        ],
        ["PROJECTED", "OLDER", "MISSING"],
      );
      const row = await prisma.externalBillingDocument.findUniqueOrThrow({
        where: { source_externalId: { source: "SZAMLAZZ", externalId } },
        select: {
          documentNumber: true,
          versionCount: true,
          paidAmount: true,
          lastPaymentDate: true,
          paymentsKnown: true,
          payments: true,
        },
      });
      assert.deepEqual(
        [
          row.documentNumber,
          row.versionCount,
          row.paidAmount.toFixed(2),
          row.lastPaymentDate?.toISOString().slice(0, 10),
          row.paymentsKnown,
          (row.payments as { bankTransactionId: string }[])[0]
            ?.bankTransactionId,
        ],
        ["UJ-1", 2, "127.00", "2026-09-28", true, "77877311"],
      );

      const list = new BillingDocumentListRepository();
      const numbers = async (origin?: "OWN" | "EXTERNAL") =>
        (
          await list.list({ page: 1, pageSize: 100, q: "UJ-1", origin })
        ).items.map((item) => [item.documentNumber, item.origin]);
      assert.deepEqual(await numbers("EXTERNAL"), [["UJ-1", "EXTERNAL"]]);
      assert.deepEqual(await numbers(), [["UJ-1", "EXTERNAL"]]);
      assert.deepEqual(await numbers("OWN"), []);
    });

    /**
     * A BEJÖVŐ SZÁMLA A SZÁMLÁZÁS „BEJÖVŐ” NÉZETÉBE (acrobot 25869, A szelet), a
     * valódi adatbázison. MI PIROSÍT: ha egy korábbi változat felülírná a
     * későbbit; ha a változatok száma nem számolódna; ha a kifizetett összeg és
     * az utolsó kifizetés napja nem a kifizetésekből jönne; ha a forrás-dokumentum
     * (a PDF hordozója) nem kötődne, vagy egy `.xml` forrás PDF-nek látszana.
     */
    it("an incoming invoice is projected once, from its latest version, with its payments and source", async () => {
      const externalId = `${PREFIX}be-1`;
      const base = {
        kind: "SZAMLABE" as const,
        externalId,
        body: "<szamlabe/>",
      };
      await repository.storeRaw({ ...base, sha256: "regi" });
      await repository.storeRaw({ ...base, sha256: "uj" });
      await prisma.szamlazzFeedMessage.updateMany({
        where: { externalId, sha256: "regi" },
        data: { receivedAt: new Date("2026-10-01T10:00:00Z") },
      });
      await prisma.szamlazzFeedMessage.updateMany({
        where: { externalId, sha256: "uj" },
        data: { receivedAt: new Date("2026-10-01T11:00:00Z") },
      });
      const { id: sourceId } = await repository.storeInvoice({
        externalId,
        fileName: "BE-1.pdf",
        content: Buffer.from("%PDF-1.4 teszt"),
        sha256: `${PREFIX}sha-be-1`,
        receivedAt: new Date("2026-10-01T10:00:00Z"),
        payee: "COMPANY",
        textReading: { invoiceNumber: "UJ-BE-1" },
      });
      const projection = (documentNumber: string) => ({
        externalId,
        kindCode: "SZ",
        documentNumber,
        electronic: true,
        issueDate: "2026-09-28",
        fulfillmentDate: "2026-09-25",
        dueDate: "2026-10-06",
        paymentMethod: "Átutalás",
        currency: "HUF",
        exchangeRate: null,
        exchangeBank: null,
        supplierName: "KBOSS.hu Kft.",
        supplierTaxNumber: "13421739-2-41",
        supplierEuTaxNumber: null,
        supplierAddress: null,
        supplierBankAccount: null,
        buyerName: "Acropora Kft.",
        buyerTaxNumber: "23916229-2-42",
        netAmount: "10000",
        vatAmount: "2700",
        grossAmount: "12700",
        lines: [],
        vatSummary: [],
        paymentsKnown: true,
        payments: [
          {
            date: "2026-10-02",
            title: "átutalás",
            amount: "2700",
            note: null,
            bankTransactionId: null,
          },
          {
            date: "2026-09-30",
            title: "átutalás",
            amount: "10000",
            note: null,
            bankTransactionId: "9001",
          },
        ],
        note: null,
        orderNumber: null,
        referencedInvoiceNumber: null,
        referencedProformaNumber: null,
        cancelled: false,
      });
      assert.deepEqual(
        [
          await repository.projectIncoming({
            externalId,
            sha256: "uj",
            projection: projection("UJ-BE-1"),
          }),
          await repository.projectIncoming({
            externalId,
            sha256: "regi",
            projection: projection("REGI-BE-1"),
          }),
          await repository.projectIncoming({
            externalId,
            sha256: "nincs",
            projection: projection("SEHOL"),
          }),
        ],
        ["PROJECTED", "OLDER", "MISSING"],
      );
      const row = await prisma.incomingBillingDocument.findUniqueOrThrow({
        where: { source_externalId: { source: "SZAMLAZZ", externalId } },
      });
      assert.deepEqual(
        [
          row.documentNumber,
          row.versionCount,
          row.paidAmount.toString(),
          row.lastPaymentDate?.toISOString().slice(0, 10),
          row.sourceDocumentId,
          row.hasPdf,
        ],
        ["UJ-BE-1", 2, "12700", "2026-10-02", sourceId, true],
      );
    });

    it("a forwarded invoice is a candidate, with its source, gross and supplier", async () => {
      const { id } = await repository.storeInvoice({
        externalId: `${PREFIX}2`,
        fileName: "E-KBOSS-2026-1234.pdf",
        content: Buffer.from("%PDF-1.4 teszt"),
        sha256: `${PREFIX}sha-2`,
        receivedAt: new Date("2026-08-14T00:00:00Z"),
        payee: "COMPANY",
        textReading: {
          invoiceNumber: "E-KBOSS-2026-1234",
          numberFrom: "SZAMLAZZ",
          supplierTaxNumber: "13421739-2-41",
          supplierName: "KBOSS.hu Kft.",
          gross: "12700.0",
          currency: "HUF",
        },
      });
      const candidates = await new MissingInvoicesRepository().candidates(
        "2026-08-01",
        "2026-08-31",
      );
      const found = candidates.find(
        (d) => d.id === id || d.aliasIds?.includes(id),
      );
      assert.deepEqual(
        [
          found?.source,
          found?.gross?.toString(),
          found?.supplierName,
          found?.payee,
          found?.number,
        ],
        ["SZAMLAZZ", "12700", "KBOSS.hu Kft.", "COMPANY", "E-KBOSS-2026-1234"],
      );
    });
  },
);
