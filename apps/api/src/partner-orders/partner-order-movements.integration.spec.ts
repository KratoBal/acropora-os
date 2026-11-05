import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { PartnerOrdersRepository } from "./partner-orders.repository.js";

/**
 * AZ UTOLSO MOZGAS A NEGY LANCLEPESBOL, ADATBAZISON (S4b-1, barracuda #2230 review). A relacio-szurest (a TIG dokumentuma,
 * a TIG szamlaja a megrendelesen at) a tsc nem bizonyitja, ezert a valodi Postgres olvassa. MI PIROSIT: ha a TIG
 * dokumentuma vagy kiallitott szamlaja nem szamit; ha a piszkozat szamla (a datuma terv) vagy a sztorno szamitana; ha
 * a szamla datuma a nap elejere esne; ha egy masik megrendeles mozgasa az enyemhez tartozna.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "ORDMOVE-";
const n = String(Date.now() % 1_000_000);
const ids: Record<string, string> = {};

async function removeLeftovers() {
  const certificates = await prisma.completionCertificate.findMany({
    where: { number: { startsWith: PREFIX } },
    select: { id: true },
  });
  await prisma.invoice.deleteMany({
    where: { partnerName: { startsWith: PREFIX } },
  });
  await prisma.completionCertificate.deleteMany({
    where: { id: { in: certificates.map((row) => row.id) } },
  });
  await prisma.partnerOrder.deleteMany({
    where: { orderNumber: { startsWith: PREFIX } },
  });
  await prisma.quoteAcceptance.deleteMany({
    where: { quote: { quoteNumber: { startsWith: PREFIX } } },
  });
  await prisma.quoteVersion.deleteMany({
    where: { quote: { quoteNumber: { startsWith: PREFIX } } },
  });
  await prisma.quote.deleteMany({
    where: { quoteNumber: { startsWith: PREFIX } },
  });
  nincsMaradek([
    {
      nev: "PartnerOrder",
      darab: await prisma.partnerOrder.count({
        where: { orderNumber: { startsWith: PREFIX } },
      }),
    },
    {
      nev: "Quote",
      darab: await prisma.quote.count({
        where: { quoteNumber: { startsWith: PREFIX } },
      }),
    },
    {
      nev: "CompletionCertificate",
      darab: await prisma.completionCertificate.count({
        where: { number: { startsWith: PREFIX } },
      }),
    },
  ]);
}

async function makeOrder(key: string): Promise<string> {
  const quote = await prisma.quote.create({
    data: { quoteNumber: `${PREFIX}${key}-${n}`, title: `${PREFIX}${key}` },
    select: { id: true },
  });
  const version = await prisma.quoteVersion.create({
    data: {
      quoteId: quote.id,
      versionNumber: 1,
      validUntil: new Date("2027-01-01"),
      priceDisplay: "NET",
    },
    select: { id: true },
  });
  const acceptance = await prisma.quoteAcceptance.create({
    data: {
      quoteId: quote.id,
      quoteVersionId: version.id,
      source: "PHONE",
      acceptedAt: new Date("2026-11-01T08:00:00Z"),
    },
    select: { id: true },
  });
  const order = await prisma.partnerOrder.create({
    data: {
      orderNumber: `${PREFIX}${key}-${n}`,
      quoteId: quote.id,
      quoteVersionId: version.id,
      acceptanceId: acceptance.id,
    },
    select: { id: true },
  });
  return order.id;
}

describe(
  "the last movement of an order, on a real database",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new PartnerOrdersRepository();

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      ids.full = await makeOrder("full");
      ids.draft = await makeOrder("draft");
      ids.other = await makeOrder("other");
      ids.bare = await makeOrder("bare");

      // FULL: a TIG on day 0, its signed copy on day 10, an issued invoice dated day 12
      const full = await prisma.completionCertificate.create({
        data: {
          number: `${PREFIX}full-${n}`,
          partnerOrderId: ids.full,
          issuedAt: new Date("2026-11-01T09:00:00Z"),
        },
        select: { id: true },
      });
      await prisma.completionCertificateDocument.create({
        data: {
          certificateId: full.id,
          type: "SIGNED_FORM",
          fileName: "alairt.pdf",
          contentType: "application/pdf",
          sizeBytes: 1,
          createdAt: new Date("2026-11-11T09:00:00Z"),
        },
      });
      await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "SZAMLAZZ",
          status: "ISSUED",
          invoiceNumber: `${PREFIX}full-${n}`,
          partnerName: `${PREFIX}x`,
          completionCertificateId: full.id,
          issueDate: new Date("2026-11-13T00:00:00Z"),
        },
      });

      // DRAFT: a TIG on day 0 and a DRAFT invoice dated far in the future (its date is a plan)
      const draft = await prisma.completionCertificate.create({
        data: {
          number: `${PREFIX}draft-${n}`,
          partnerOrderId: ids.draft,
          issuedAt: new Date("2026-11-01T09:00:00Z"),
        },
        select: { id: true },
      });
      await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "SZAMLAZZ",
          status: "DRAFT",
          partnerName: `${PREFIX}x`,
          completionCertificateId: draft.id,
          issueDate: new Date("2027-06-01T00:00:00Z"),
        },
      });

      // OTHER: a TIG on day 40, a different order
      await prisma.completionCertificate.create({
        data: {
          number: `${PREFIX}other-${n}`,
          partnerOrderId: ids.other,
          issuedAt: new Date("2026-12-10T09:00:00Z"),
        },
      });
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("a certificate's signed copy and issued invoice are movements: the last one is the end of the invoice's day", async () => {
      const moved = await repository.lastMovements([ids.full!]);
      assert.equal(
        moved.get(ids.full!)?.toISOString(),
        "2026-11-14T00:00:00.000Z",
      );
    });

    it("a draft invoice's planned date is no movement: the certificate's own time stands", async () => {
      const moved = await repository.lastMovements([ids.draft!]);
      assert.equal(
        moved.get(ids.draft!)?.toISOString(),
        "2026-11-01T09:00:00.000Z",
      );
    });

    it("an order is not moved by another one's certificate, and an order with no movement is absent", async () => {
      const moved = await repository.lastMovements([
        ids.full!,
        ids.draft!,
        ids.other!,
        ids.bare!,
      ]);
      assert.equal(
        moved.get(ids.other!)?.toISOString(),
        "2026-12-10T09:00:00.000Z",
      );
      assert.equal(
        moved.get(ids.full!)?.toISOString(),
        "2026-11-14T00:00:00.000Z",
      );
      assert.equal(moved.has(ids.bare!), false);
      assert.equal((await repository.lastMovements([])).size, 0);
    });
  },
);
