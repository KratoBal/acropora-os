import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { integrationDatabaseGate } from "../../common/integration-database.js";
import type { NavInvoiceDigestItem } from "../../integrations/nav/nav-online-invoice.client.js";
import { NavIncomingInvoiceRepository } from "./nav-incoming-invoice.repository.js";

/**
 * A VISSZATÖLTŐ BEÍRÁSA VALÓDI ADATBÁZISON: a kurzor (a napi szinkron
 * kiindulópontja) a `moveCursor: false` beírás után bájtra ugyanaz marad, a
 * számla viszont bekerül, és egy második beírás nem hoz létre újat.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "NAVVISSZA";
const CURSOR = { provider: "NAV", stream: "INBOUND_INVOICES" };

const item = (invoiceNumber: string): NavInvoiceDigestItem =>
  ({
    invoiceNumber,
    invoiceOperation: "CREATE",
    supplierTaxNumber: "99999999",
    supplierName: `${PREFIX} Kft.`,
    invoiceIssueDate: "2026-01-10",
    insDate: "2026-01-10T10:00:00Z",
    currency: "HUF",
  }) as NavInvoiceDigestItem;

describe("a NAV-visszatöltés beírása", { skip: gate.mode === "skip" }, () => {
  const repository = new NavIncomingInvoiceRepository();
  let cursorBefore: Date | null = null;
  const runIds: string[] = [];

  async function removeLeftovers() {
    await prisma.navIncomingInvoice.deleteMany({
      where: { navInvoiceNumber: { startsWith: PREFIX } },
    });
    await prisma.navInvoiceSyncRun.deleteMany({
      where: { id: { in: runIds } },
    });
  }

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    cursorBefore =
      (
        await prisma.integrationCursor.findUnique({
          where: { provider_stream: CURSOR },
        })
      )?.lastSuccessfulWindowEnd ?? null;
  });

  after(async () => {
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "a suite NAV-számlái bent maradtak",
        darab: await prisma.navIncomingInvoice.count({
          where: { navInvoiceNumber: { startsWith: PREFIX } },
        }),
      },
    ]);
  });

  const apply = async (items: NavInvoiceDigestItem[]) => {
    const windowStart = new Date("2026-01-01T00:00:00Z");
    const windowEnd = new Date("2026-01-31T00:00:00Z");
    const runId = await repository.createRun({ windowStart, windowEnd });
    runIds.push(runId);
    return repository.applyDigest(runId, items, windowStart, windowEnd, {
      moveCursor: false,
    });
  };

  it("writes the old window's invoice without touching the daily sync's cursor, once", async () => {
    const first = await apply([item(`${PREFIX}-1`)]);
    const second = await apply([item(`${PREFIX}-1`)]);
    assert.deepEqual(
      [first.createdCount, second.createdCount, second.skippedCount],
      [1, 0, 1],
    );
    const cursorAfter =
      (
        await prisma.integrationCursor.findUnique({
          where: { provider_stream: CURSOR },
        })
      )?.lastSuccessfulWindowEnd ?? null;
    assert.deepEqual(cursorAfter, cursorBefore);
    assert.equal(await repository.countKnown([item(`${PREFIX}-1`)]), 1);
  });
});
