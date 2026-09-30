import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import type { SzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import { BillingDocumentIssueService } from "./billing-document-issue.service.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";
import type { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";

/**
 * A KIÁLLÍTÁS VALÓDI ADATBÁZISON, HAMIS SZÁMLÁZZ.HU-VAL. Amit csak adatbázis
 * bizonyít: a feltételes foglalás két egyidejű kiállításból EGY hívást enged;
 * a kiállított sor a kiküldött (2 tizedes) összegeket és a vevő-snapshotot
 * viseli; a partner utólagos módosítása a kiállított bizonylaton NEM látszik;
 * a régi `updatedAt`-tel indított kiállítás nem fut le.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "SZAMLKIAL";

async function removeLeftovers() {
  await prisma.invoice.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

describe(
  "a számlázási bizonylat kiállítása",
  { skip: gate.mode === "skip" },
  () => {
    const drafts = new BillingDocumentsService(
      new BillingDocumentsRepository(),
    );
    let calls = 0;
    const client: SzamlazzAgentClient = {
      generateInvoice: async () => {
        calls++;
        // a két egyidejű kérés közül a második a foglaláson áll meg; a hívás lassú
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          successful: true,
          invoiceNumber: `${PREFIX}-2026-${calls}`,
          netTotal: 2350,
          grossTotal: 2985,
          pdf: Buffer.from("%PDF-1.4 teszt"),
        };
      },
    };
    const stored: unknown[] = [];
    const issuing = new BillingDocumentIssueService(
      new BillingDocumentsRepository(),
      new BillingDocumentIssueRepository(),
      {
        resolve: async () => ({
          agentKey: "it-key",
          source: "database",
          revision: "db:1",
        }),
      } as unknown as SzamlazzCredentialProvider,
      {
        put: async (key: unknown) => void stored.push(key),
      } as unknown as DocumentStore,
      client,
      { BILLING_ISSUE_ENABLED: "true" },
    );
    let user: AuthenticatedUser;
    let customerId = "";

    const dto = () =>
      ({
        documentType: "INVOICE",
        invoiceFormat: "ELECTRONIC",
        customerId,
        fulfillmentDate: "2026-09-30",
        dueDate: "2026-10-08",
        paymentMethod: "Átutalás",
        currency: "HUF",
        language: "hu",
        reference: null,
        note: null,
        sourceType: null,
        sourceId: null,
        lines: [
          {
            productId: null,
            description: "Tropic Marin Pro-Reef 25 kg",
            quantity: "1.5",
            unit: "db",
            unitNet: "1566.93",
            vatRatePercent: "27",
            discountPercent: null,
            comment: "A második zsák sérült",
          },
        ],
      }) as BillingDocumentDraftDto;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      user = {
        id: (
          await prisma.user.create({
            data: {
              email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
              displayName: `${PREFIX} aktor`,
              role: "OWNER",
            },
            select: { id: true },
          })
        ).id,
      } as AuthenticatedUser;
      customerId = (
        await prisma.customer.create({
          data: {
            customerNumber: `${PREFIX}-C1`,
            type: "COMPANY",
            displayName: `${PREFIX} partner`,
            taxNumber: "12345678-2-42",
            email: "szamla@example.invalid",
            addresses: {
              create: {
                type: "BILLING",
                isDefault: true,
                postalCode: "1146",
                city: "Budapest",
                line1: "Állatkerti krt. 6-12.",
              },
            },
          },
          select: { id: true },
        })
      ).id;
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a suite bizonylatai bent maradtak",
          darab: await prisma.invoice.count({
            where: { customer: { customerNumber: { startsWith: PREFIX } } },
          }),
        },
        {
          nev: "a suite partnerei bent maradtak",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite felhasználói bent maradtak",
          darab: await prisma.user.count({
            where: { email: { startsWith: PREFIX.toLowerCase() } },
          }),
        },
      ]);
    });

    it("two simultaneous issues make ONE call, and the row carries what was sent", async () => {
      const draft = await drafts.create(dto(), user);
      calls = 0;
      const results = await Promise.allSettled([
        issuing.issue(draft.id, draft.updatedAt, user),
        issuing.issue(draft.id, draft.updatedAt, user),
      ]);
      assert.equal(calls, 1);
      assert.deepEqual(results.map((result) => result.status).sort(), [
        "fulfilled",
        "rejected",
      ]);
      const refused = results.find((result) => result.status === "rejected");
      assert.ok(
        (refused as PromiseRejectedResult).reason instanceof ConflictException,
      );

      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: draft.id },
        include: { lines: true },
      });
      assert.deepEqual(
        [
          row.status,
          row.invoiceNumber,
          row.issueAttemptCount,
          row.emailStatus,
          row.netAmount?.toFixed(0),
          row.grossAmount?.toFixed(0),
        ],
        ["ISSUED", `${PREFIX}-2026-1`, 1, "PENDING", "2350", "2985"],
      );
      // the draft stored 2350.3950; the invoice line carries the sent 2350.40
      assert.equal(row.lines[0]!.netAmount.toFixed(4), "2350.4000");
      assert.deepEqual(row.buyerSnapshot, {
        name: `${PREFIX} partner`,
        country: "HU",
        zip: "1146",
        city: "Budapest",
        address: "Állatkerti krt. 6-12.",
        taxNumber: "12345678-2-42",
        euTaxNumber: null,
        email: "szamla@example.invalid",
      });
      assert.ok(row.pdfStorageKey);
    });

    it("a later change to the partner does not change the issued document's buyer", async () => {
      const issued = await prisma.invoice.findFirstOrThrow({
        where: {
          customer: { customerNumber: { startsWith: PREFIX } },
          status: "ISSUED",
        },
        select: { id: true, buyerSnapshot: true },
      });
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          displayName: `${PREFIX} ÁTNEVEZVE`,
          email: "uj@example.invalid",
        },
      });
      const after = await prisma.invoice.findUniqueOrThrow({
        where: { id: issued.id },
        select: { buyerSnapshot: true, partnerName: true },
      });
      assert.deepEqual(after.buyerSnapshot, issued.buyerSnapshot);
      assert.equal(after.partnerName, `${PREFIX} partner`);
    });

    it("an issue started from an older version of the draft does not run", async () => {
      const draft = await drafts.create(dto(), user);
      const saved = await drafts.update(draft.id, {
        ...dto(),
        expectedUpdatedAt: draft.updatedAt,
        note: "módosítva",
      } as BillingDocumentDraftDto);
      assert.notEqual(saved.updatedAt, draft.updatedAt);
      calls = 0;
      await assert.rejects(
        () => issuing.issue(draft.id, draft.updatedAt, user),
        ConflictException,
      );
      assert.equal(calls, 0);
      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: draft.id },
        select: { status: true },
      });
      assert.equal(row.status, "DRAFT");
    });
  },
);
