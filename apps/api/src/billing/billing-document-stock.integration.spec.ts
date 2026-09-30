import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import type { SzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import { BillingDocumentIssueService } from "./billing-document-issue.service.js";
import { BillingDocumentStockRepository } from "./billing-document-stock.repository.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";
import type { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";

/**
 * A KIÁLLÍTOTT SZÁMLA KÉSZLETHATÁSA VALÓDI ADATBÁZISON (acrobot kalibrációja,
 * 25245): kétszer kiállított ugyanaz a számla EGY mozgást ad; egy helyi
 * (syncToUnas=false) termék nem kerül a UNAS-kimenőbe, a UNAS-termék igen,
 * `BILLING_INVOICE` forrással; a több változatú termék sora látható okkal
 * kimarad; a webshop-rendelésből jövő számla nem von le újra.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "SZAMLKESZL";

async function removeLeftovers() {
  const variants = await prisma.productVariant.findMany({
    where: { sku: { startsWith: PREFIX } },
    select: { id: true },
  });
  const variantIds = variants.map((variant) => variant.id);
  const invoices = await prisma.invoice.findMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
    select: { id: true },
  });
  await prisma.stockMovementLine.deleteMany({
    where: { variantId: { in: variantIds } },
  });
  await prisma.stockMovement.deleteMany({
    where: {
      referenceType: "Invoice",
      referenceId: { in: invoices.map((invoice) => invoice.id) },
    },
  });
  await prisma.unasStockSyncOutbox.deleteMany({
    where: { variantId: { in: variantIds } },
  });
  await prisma.stockItem.deleteMany({
    where: { variantId: { in: variantIds } },
  });
  await prisma.invoice.deleteMany({
    where: { id: { in: invoices.map((invoice) => invoice.id) } },
  });
  await prisma.product.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

describe(
  "a kiállított számla készlethatása",
  { skip: gate.mode === "skip" },
  () => {
    const drafts = new BillingDocumentsService(
      new BillingDocumentsRepository(),
    );
    let calls = 0;
    const client: SzamlazzAgentClient = {
      generateInvoice: async () => {
        calls++;
        return {
          successful: true,
          // összeg nélkül a kiállítás a saját számítását veszi
          invoiceNumber: `${PREFIX}-2026-${calls}`,
        };
      },
    };
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
      { put: async () => undefined } as unknown as DocumentStore,
      new BillingDocumentStockRepository(),
      client,
      { BILLING_ISSUE_ENABLED: "true" },
    );
    let user: AuthenticatedUser;
    let customerId = "";
    const productIds: Record<string, string> = {};
    // A könyvelés a "fő raktárt" veszi (`ensureMainWarehouse`, a legelső
    // raktár), és üres adatbázisban LÉTREHOZZA. Ha itt maradna, a később futó
    // specek (a UNAS rendelés-szinkroné, ami ugyanezt hívja) már ezt kapnák
    // a saját raktáruk helyett: a CI-ben pontosan így bukott el két tesztjük.
    let warehousesBefore: string[] = [];
    const variantIds: Record<string, string> = {};

    const draft = (
      lines: [string, string][],
      sourceType: BillingDocumentDraftDto["sourceType"] = null,
    ) =>
      drafts.create(
        {
          documentType: "INVOICE",
          invoiceFormat: "PAPER",
          customerId,
          fulfillmentDate: "2026-09-30",
          dueDate: "2026-10-08",
          paymentMethod: "Átutalás",
          currency: "HUF",
          language: "hu",
          reference: null,
          note: null,
          sourceType,
          sourceId: sourceType ? `${PREFIX}-forras` : null,
          lines: lines.map(([key, quantity]) => ({
            productId: productIds[key]!,
            description: key,
            quantity,
            unit: "db",
            unitNet: "1000",
            vatRatePercent: "27",
            discountPercent: null,
            comment: null,
          })),
        } as BillingDocumentDraftDto,
        user,
      );

    const onHand = async (key: string) =>
      (
        await prisma.stockItem.findMany({
          where: { variantId: variantIds[key]! },
          select: { onHand: true },
        })
      ).map((item) => item.onHand.toString());

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      warehousesBefore = (
        await prisma.warehouse.findMany({ select: { id: true } })
      ).map((warehouse) => warehouse.id);
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
      for (const [key, catalogAuthority, skus] of [
        ["unas", "UNAS", ["U1"]],
        ["local", "ACROPORA", ["L1"]],
        ["multi", "UNAS", ["M1", "M2"]],
      ] as const) {
        const product = await prisma.product.create({
          data: { name: `${PREFIX} ${key}`, catalogAuthority },
          select: { id: true },
        });
        productIds[key] = product.id;
        for (const sku of skus) {
          const variant = await prisma.productVariant.create({
            data: { productId: product.id, sku: `${PREFIX}-${sku}` },
            select: { id: true },
          });
          variantIds[key] ??= variant.id;
        }
      }
    });

    after(async () => {
      await removeLeftovers();
      await prisma.warehouse.deleteMany({
        where: { id: { notIn: warehousesBefore } },
      });
      nincsMaradek([
        {
          nev: "a suite által létrehozott raktár bent maradt",
          darab: await prisma.warehouse.count({
            where: { id: { notIn: warehousesBefore } },
          }),
        },
        {
          nev: "a suite termékei bent maradtak",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite bizonylatai bent maradtak",
          darab: await prisma.invoice.count({
            where: { customer: { customerNumber: { startsWith: PREFIX } } },
          }),
        },
      ]);
    });

    it("books the invoice out once, UNAS product to the outbox, local one not, multi-variant line skipped with its reason", async () => {
      const created = await draft([
        ["unas", "2"],
        ["local", "1.5"],
        ["multi", "1"],
      ]);
      const issued = await issuing.issue(created.id, created.updatedAt, user);
      // A második kattintás a kiállított bizonylatot kapja, és nem von le újra.
      const again = await issuing.issue(created.id, created.updatedAt, user);

      assert.equal(
        await prisma.stockMovement.count({
          where: { referenceType: "Invoice", referenceId: created.id },
        }),
        1,
      );
      assert.deepEqual(await onHand("unas"), ["-2"]);
      assert.deepEqual(await onHand("local"), ["-1.5"]);
      const outbox = await prisma.unasStockSyncOutbox.findMany({
        where: {
          variantId: { in: [variantIds.unas!, variantIds.local!] },
        },
        select: { variantId: true, sourceProcess: true },
      });
      assert.deepEqual(outbox, [
        { variantId: variantIds.unas, sourceProcess: "BILLING_INVOICE" },
      ]);
      for (const detail of [issued, again])
        assert.deepEqual(
          detail.lines.map((line) => [line.description, line.stockOutcome]),
          [
            ["unas", "MOVED"],
            ["local", "MOVED"],
            ["multi", "VARIANT_NOT_CHOSEN"],
          ],
        );
    });

    it("does not book out an invoice made from a webshop order again", async () => {
      const created = await draft([["unas", "1"]], "SALES_ORDER");
      const issued = await issuing.issue(created.id, created.updatedAt, user);
      assert.equal(
        await prisma.stockMovement.count({
          where: { referenceType: "Invoice", referenceId: created.id },
        }),
        0,
      );
      assert.equal(issued.lines[0]!.stockOutcome, "MOVED_BY_SOURCE");
      assert.deepEqual(await onHand("unas"), ["-2"]);
    });
  },
);
