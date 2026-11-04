import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { MissingInvoicesRepository } from "./missing-invoices.repository.js";

/**
 * A KÖNYVELŐI CSOMAG BEJÖVŐ SZÁMLÁINAK KIVÁLASZTÁSA valódi adatbázison: a
 * hónapkulcs a SZÁMLA KELTE (Balázs, 2026-11-04 07:11 UTC; a teljesítés napja
 * nem számít), a sztornózott és a nem könyvelendő sor kimarad, de a
 * hivatkozások között ott van.
 *
 * MI PIROSÍT: ha a kifizetetlen, októberben kelt számla kimaradna; ha az
 * októberben kelt, de szeptemberben teljesített számla a szeptemberi
 * csomagba kerülne (a #2002 óta ez történt); ha a szeptemberben kelt, de
 * októberben teljesített számla az októberi csomagba kerülne; ha a teljesítés
 * nélküli sor kimaradna; ha a sztornózott vagy nem könyvelendő sor bekerülne.
 * Távoli hónapot használ (2099), hogy a közös fejlesztői adat ne zavarjon.
 */
const gate = integrationDatabaseGate(process.env);
const SUPPLIER = "CSOMAGSOR-TESZT Kft.";
const day = (value: string) => new Date(`${value}T00:00:00Z`);

async function removeLeftovers() {
  await prisma.incomingBillingDocument.deleteMany({
    where: { supplierName: SUPPLIER },
  });
}

function row(
  externalId: string,
  overrides: {
    issueDate: string;
    fulfillmentDate: string | null;
    cancelled?: boolean;
    notBookable?: boolean;
  },
) {
  return {
    source: "SZAMLAZZ",
    externalId,
    feedMessageId: `csomagsor-${externalId}`,
    feedReceivedAt: day("2099-04-01"),
    kindCode: "I",
    documentNumber: `CSOMAGSOR-${externalId}`,
    electronic: true,
    issueDate: day(overrides.issueDate),
    fulfillmentDate: overrides.fulfillmentDate
      ? day(overrides.fulfillmentDate)
      : null,
    currency: "HUF",
    supplierName: SUPPLIER,
    buyerName: "Acropora Kft.",
    netAmount: 100,
    vatAmount: 27,
    grossAmount: 127,
    lines: [],
    vatSummary: [],
    payments: [],
    paymentsKnown: false,
    paidAmount: 0,
    cancelled: overrides.cancelled ?? false,
    notBookable: overrides.notBookable ?? false,
  };
}

describe(
  "a könyvelői csomag bejövő számlái",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new MissingInvoicesRepository();

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      await prisma.incomingBillingDocument.createMany({
        data: [
          // kifizetetlen, októberben teljesített (a Fluidra KS26/12407 alakja)
          row("okt", {
            issueDate: "2099-10-22",
            fulfillmentDate: "2099-10-22",
          }),
          // októberben kelt, szeptemberben teljesített: CSAK október (a kelte dönt)
          row("teljesites-szept", {
            issueDate: "2099-10-02",
            fulfillmentDate: "2099-09-30",
          }),
          // szeptemberben kelt, októberben teljesített: CSAK szeptember
          row("kelt-szept", {
            issueDate: "2099-09-30",
            fulfillmentDate: "2099-10-02",
          }),
          // teljesítés nélkül is a kelte dönt
          row("nincs-teljesites", {
            issueDate: "2099-10-05",
            fulfillmentDate: null,
          }),
          row("sztorno", {
            issueDate: "2099-10-06",
            fulfillmentDate: "2099-10-06",
            cancelled: true,
          }),
          row("nem-konyvelendo", {
            issueDate: "2099-10-07",
            fulfillmentDate: "2099-10-07",
            notBookable: true,
          }),
        ],
      });
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    const numbers = async (month: string) =>
      (await repository.packageBillingRows(month)).rows
        .filter((r) => r.supplierName === SUPPLIER)
        .map((r) => r.documentNumber)
        .sort();

    it("October holds the invoices ISSUED in October (whatever their fulfilment month), not the cancelled or non-bookable ones", async () => {
      assert.deepEqual(await numbers("2099-10"), [
        "CSOMAGSOR-nincs-teljesites",
        "CSOMAGSOR-okt",
        "CSOMAGSOR-teljesites-szept",
      ]);
    });

    it("the invoice issued in September but fulfilled in October is in September only", async () => {
      assert.deepEqual(await numbers("2099-09"), ["CSOMAGSOR-kelt-szept"]);
    });

    it("the references hold every row, the cancelled and the non-bookable too", async () => {
      const { refs } = await repository.packageBillingRows("2099-10");
      const mine = refs
        .map((r) => r.documentNumber)
        .filter((n) => n.startsWith("CSOMAGSOR-"))
        .sort();
      assert.equal(mine.length, 6);
      assert.ok(mine.includes("CSOMAGSOR-sztorno"));
      assert.ok(mine.includes("CSOMAGSOR-nem-konyvelendo"));
    });
  },
);
