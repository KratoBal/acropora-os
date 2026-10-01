import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { MissingInvoicesRepository } from "./missing-invoices.repository.js";
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
