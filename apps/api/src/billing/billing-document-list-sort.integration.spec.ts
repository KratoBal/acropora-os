import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { BillingDocumentListRepository } from "./billing-document-list.repository.js";

/**
 * A KIMENŐ LISTA RENDEZÉSE VALÓDI POSTGRESEN (Balázs kérése, kártya 2f6369a4): a saját és a külső (feed) sorok EGY listán, ugyanazon
 * a kulcson. Mi pirosít: ha a két forrás nem ugyanazt a mezőt rendezi (az összefésülés hézagos vagy fordított lenne); ha az üres
 * határidő/kelt nem a legnagyobb (növekvőben hátul, csökkenőben elöl); ha a lap a rendezés UTÁN nem folytatja az elsőt hézag
 * nélkül; ha rendezés nélkül az eddigi sorrend (kelt szerint csökkenő) változik.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "SORTLIST-";
const n = String(Date.now() % 1_000_000);
const repository = new BillingDocumentListRepository();

const own = (key: string, gross: number, day: string, due: string | null) =>
  prisma.invoice.create({
    data: {
      direction: "OUTBOUND",
      documentType: "INVOICE",
      source: "SZAMLAZZ",
      sourceType: "MANUAL",
      status: "ISSUED",
      invoiceNumber: `${PREFIX}${n}-${key}`,
      partnerName: `${PREFIX}vevo`,
      currency: "HUF",
      grossAmount: new Prisma.Decimal(gross),
      netAmount: new Prisma.Decimal(gross),
      vatAmount: new Prisma.Decimal(0),
      issueDate: new Date(`${day}T10:00:00Z`),
      dueDate: due ? new Date(`${due}T00:00:00Z`) : null,
    },
  });

const external = (
  key: string,
  gross: number,
  day: string,
  due: string | null,
) =>
  prisma.externalBillingDocument.create({
    data: {
      externalId: `${PREFIX}${n}-${key}`,
      feedMessageId: `${PREFIX}${n}-msg-${key}`,
      feedReceivedAt: new Date(),
      kindCode: "SZ",
      documentNumber: `${PREFIX}${n}-${key}`,
      electronic: true,
      issueDate: new Date(`${day}T00:00:00Z`),
      dueDate: due ? new Date(`${due}T00:00:00Z`) : null,
      currency: "HUF",
      customerName: `${PREFIX}vevo`,
      netAmount: new Prisma.Decimal(gross),
      vatAmount: new Prisma.Decimal(0),
      grossAmount: new Prisma.Decimal(gross),
      lines: [],
    },
  });

describe(
  "the outgoing list: sort across the own and the external rows",
  { skip: gate.mode === "skip" },
  () => {
    async function removeLeftovers() {
      await prisma.invoice.deleteMany({
        where: { invoiceNumber: { startsWith: PREFIX } },
      });
      await prisma.externalBillingDocument.deleteMany({
        where: { documentNumber: { startsWith: PREFIX } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      // two own and two external rows, interleaved in every key; one own row has no due date
      await own("o1", 100, "2026-09-01", "2026-09-10");
      await own("o3", 300, "2026-09-03", null);
      await external("e2", 200, "2026-09-02", "2026-09-20");
      await external("e4", 400, "2026-09-04", "2026-09-05");
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    const list = async (
      filter: Parameters<
        BillingDocumentListRepository["list"]
      >[0] extends infer Q
        ? Partial<Q>
        : never,
    ) =>
      (
        await repository.list({
          page: 1,
          pageSize: 50,
          q: `${PREFIX}${n}`,
          ...filter,
        })
      ).items
        .map((item) => item.documentNumber?.slice(-2))
        .join(",");

    it("merges the two sources by the amount, both ways", async () => {
      assert.equal(
        await list({ sort: "grossAmount", direction: "asc" }),
        "o1,e2,o3,e4",
      );
      assert.equal(
        await list({ sort: "grossAmount", direction: "desc" }),
        "e4,o3,e2,o1",
      );
    });

    it("merges them by the issue date, both ways", async () => {
      assert.equal(
        await list({ sort: "issueDate", direction: "asc" }),
        "o1,e2,o3,e4",
      );
      assert.equal(
        await list({ sort: "issueDate", direction: "desc" }),
        "e4,o3,e2,o1",
      );
    });

    it("puts the empty due date last ascending and first descending, across both sources", async () => {
      assert.equal(
        await list({ sort: "dueDate", direction: "asc" }),
        "e4,o1,e2,o3",
      );
      assert.equal(
        await list({ sort: "dueDate", direction: "desc" }),
        "o3,e2,o1,e4",
      );
    });

    it("pages the sorted list without a gap or an overlap", async () => {
      const first = await list({
        sort: "grossAmount",
        direction: "asc",
        pageSize: 2,
        page: 1,
      });
      const second = await list({
        sort: "grossAmount",
        direction: "asc",
        pageSize: 2,
        page: 2,
      });
      assert.equal(`${first},${second}`, "o1,e2,o3,e4");
    });

    it("keeps the old order (issue date, newest first) without a sort", async () => {
      assert.equal(await list({}), "e4,o3,e2,o1");
    });
  },
);
