import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import type { SzamlazzAgentPdfClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import {
  prismaExternalPdfStore,
  UNKNOWN_NUMBER_REASON,
} from "./external-invoice-pdf-fill.js";
import { runExternalInvoicePdfFill } from "./external-invoice-pdf.scheduler.js";

/**
 * THE PDF CATCH-UP ON THE REAL DATABASE (card 10964cc7 follow-up). The unit
 * specs hold the store as a fake; what only the database can show is which
 * rows the store lists and that its write leaves a stored PDF alone. Invented
 * numbers, one far-away month (2098-05) that no other spec uses.
 */
const gate = integrationDatabaseGate(process.env);
const D = (value: string | number) => new Prisma.Decimal(value);
const MONTH = "2098-05";
const PDF = Buffer.from("%PDF-1.4\n%valami\n");

describe(
  "the external invoice PDF store on the real database",
  { skip: gate.mode === "skip" },
  () => {
    const marker = `pdfsch-${randomUUID().slice(0, 8)}`;
    const ids: Record<"missing" | "stored" | "unknown" | "failed", string> = {
      missing: "",
      stored: "",
      unknown: "",
      failed: "",
    };
    const numbers: Record<keyof typeof ids, string> = {
      missing: `ACRW-2098/${marker}-1`,
      stored: `ACRW-2098/${marker}-2`,
      unknown: `ACRW-2098/${marker}-3`,
      failed: `ACRW-2098/${marker}-4`,
    };
    const STORED_KEY = `external-invoice/${marker}/cmfx.pdf`;

    const create = async (
      name: keyof typeof ids,
      extra: { pdfStorageKey?: string; pdfMissingReason?: string },
    ) => {
      const row = await prisma.externalBillingDocument.create({
        data: {
          externalId: `${marker}-${name}`,
          documentNumber: numbers[name],
          feedMessageId: `${marker}-${name}`,
          feedReceivedAt: new Date(`${MONTH}-10T10:00:00Z`),
          kindCode: "SZ",
          electronic: true,
          issueDate: new Date(`${MONTH}-10T00:00:00Z`),
          currency: "HUF",
          customerName: marker,
          netAmount: D(1000),
          vatAmount: D(270),
          grossAmount: D(1270),
          lines: [],
          ...extra,
        },
      });
      ids[name] = row.id;
    };

    const mine = <T extends { id: string }>(rows: T[]) =>
      rows.filter((row) => Object.values(ids).includes(row.id));

    const removeLeftovers = () =>
      prisma.externalBillingDocument.deleteMany({
        where: { customerName: marker },
      });

    before(async () => {
      if (gate.mode !== "run") return;
      await create("missing", {});
      await create("stored", { pdfStorageKey: STORED_KEY });
      await create("unknown", { pdfMissingReason: UNKNOWN_NUMBER_REASON });
      await create("failed", { pdfMissingReason: "SZAMLAZZ_PDF_HTTP_500" });
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    const fresh = (name: keyof typeof ids) =>
      prisma.externalBillingDocument.findUniqueOrThrow({
        where: { id: ids[name] },
        select: { pdfStorageKey: true, pdfMissingReason: true },
      });

    it("lists the rows without a PDF; a stored one and a number Számlázz.hu rejected stay out", async () => {
      const rows = mine(await prismaExternalPdfStore.candidates(MONTH));
      assert.deepEqual(
        rows.map((row) => row.id).sort(),
        [ids.failed, ids.missing].sort(),
      );
      const again = mine(
        await prismaExternalPdfStore.candidates(MONTH, { retryUnknown: true }),
      );
      assert.deepEqual(
        again.map((row) => row.id).sort(),
        [ids.failed, ids.missing, ids.unknown].sort(),
      );
    });

    it("a write never overwrites a stored PDF, and a failure mark never erases it", async () => {
      await prismaExternalPdfStore.setPdf(
        ids.stored,
        "external-invoice/x/szamlazz.pdf",
        null,
      );
      await prismaExternalPdfStore.setPdf(
        ids.stored,
        null,
        "SZAMLAZZ_PDF_FAILED",
      );
      assert.deepEqual(await fresh("stored"), {
        pdfStorageKey: STORED_KEY,
        pdfMissingReason: null,
      });
    });

    it("the daily run fills the rows without a PDF and touches no other", async () => {
      const asked: string[] = [];
      const client = {
        downloadInvoicePdf: async (xml: string) => {
          asked.push(/<szamlaszam>([^<]*)<\/szamlaszam>/.exec(xml)?.[1] ?? "");
          return { successful: true, pdf: PDF };
        },
      } as unknown as SzamlazzAgentPdfClient;
      const summary = await runExternalInvoicePdfFill({
        now: new Date(`${MONTH}-20T04:00:00Z`),
        store: prismaExternalPdfStore,
        credential: async () => ({ agentKey: "kulcs" }),
        client,
        documents: { put: async () => undefined },
      });
      assert.equal(summary.skipped, null);
      assert.deepEqual(asked.sort(), [numbers.failed, numbers.missing].sort());
      const filled = await fresh("missing");
      assert.match(filled.pdfStorageKey ?? "", /szamlazz\.pdf$/);
      assert.equal(filled.pdfMissingReason, null);
      assert.match(
        (await fresh("failed")).pdfStorageKey ?? "",
        /szamlazz\.pdf$/,
      );
      assert.deepEqual(await fresh("stored"), {
        pdfStorageKey: STORED_KEY,
        pdfMissingReason: null,
      });
      assert.deepEqual(await fresh("unknown"), {
        pdfStorageKey: null,
        pdfMissingReason: UNKNOWN_NUMBER_REASON,
      });
      // the second run has nothing left to ask for
      asked.length = 0;
      await runExternalInvoicePdfFill({
        now: new Date(`${MONTH}-21T04:00:00Z`),
        store: prismaExternalPdfStore,
        credential: async () => ({ agentKey: "kulcs" }),
        client,
        documents: { put: async () => undefined },
      });
      assert.deepEqual(asked, []);
    });
  },
);
