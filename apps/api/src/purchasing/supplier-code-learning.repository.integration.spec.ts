import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  SUPPLIER_LINE_EAN_POLICY,
  SUPPLIER_LINE_JEV_POLICY,
} from "./line-suggestions/supplier-line-policy.js";
import { SupplierCodeLearningRepository } from "./supplier-code-learning.repository.js";

/**
 * What the learning DOES in the database, not what it asks for: the two
 * unique keys of SupplierProduct (supplier + code, supplier + variant) are
 * the ones a conflict must be reported against instead of overwritten, and
 * an accepted Jev suggestion must not become a mapping.
 *
 * Creates and removes rows, so it runs only on a database named for testing;
 * see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "CODELEARN-";

describe(
  "learning a supplier's code from a saved invoice line",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const repository = new SupplierCodeLearningRepository();
    let supplierId: string;
    const variants: string[] = [];
    const runIds: string[] = [];

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const supplier = await prisma.supplier.create({
        data: {
          code: `${PREFIX}${suffix}`,
          name: `${PREFIX}Szallito`,
          isSupplier: true,
          isService: false,
        },
      });
      supplierId = supplier.id;
      for (const name of ["A", "B", "C", "D"]) {
        const product = await prisma.product.create({
          data: { name: `${PREFIX}${name}-${suffix}` },
        });
        const variant = await prisma.productVariant.create({
          data: { productId: product.id, sku: `${PREFIX}${name}-${suffix}` },
        });
        variants.push(variant.id);
      }
    });

    after(async () => {
      await removeLeftovers();
      await prisma.$disconnect();
    });

    async function removeLeftovers() {
      await prisma.decisionRun.deleteMany({
        where: { entityType: `${PREFIX}line` },
      });
      await prisma.supplierProduct.deleteMany({
        where: { supplier: { code: { startsWith: PREFIX } } },
      });
      await prisma.productVariant.deleteMany({
        where: { sku: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: PREFIX } },
      });
    }

    const line = (supplierSku: string, variantId: string, runId?: string) => ({
      supplierSku,
      variantId,
      sourceDescription: `${supplierSku} leiras`,
      unitNet: 12.5,
      decisionRunId: runId ?? null,
    });

    async function run(policyKey: string, selectedValue: string) {
      const created = await prisma.decisionRun.create({
        data: {
          policyKey,
          policyVersion: 1,
          projectionHash: `h-${runIds.length}-${suffix}`,
          optionsHash: "o",
          requestedModel: "m",
          selectedValue,
          exposure: "SHOWN",
          status: "OK",
          entityType: `${PREFIX}line`,
        },
      });
      runIds.push(created.id);
      return created.id;
    }

    it("learns a linked code once, even when the invoice repeats it", async () => {
      const result = await repository.learn({
        supplierId,
        currency: "EUR",
        lines: [line("K-1", variants[0]!), line(" K-1 ", variants[0]!)],
      });
      assert.deepEqual(result, { learned: 1, conflicts: [] });
      const rows = await prisma.supplierProduct.findMany({
        where: { supplierId },
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.supplierSku, "K-1");
      assert.equal(rows[0]!.variantId, variants[0]);
      assert.equal(rows[0]!.currency, "EUR");
      assert.equal(rows[0]!.supplierName, "K-1 leiras");
    });

    it("the next invoice with the same pair changes nothing", async () => {
      const result = await repository.learn({
        supplierId,
        currency: "EUR",
        lines: [line("K-1", variants[0]!)],
      });
      assert.deepEqual(result, { learned: 0, conflicts: [] });
    });

    it("reports a code already on another product, and keeps the old one", async () => {
      const result = await repository.learn({
        supplierId,
        currency: "EUR",
        lines: [line("K-1", variants[1]!)],
      });
      assert.equal(result.learned, 0);
      assert.deepEqual(
        result.conflicts.map((conflict) => conflict.reason),
        ["CODE_ON_OTHER_PRODUCT"],
      );
      assert.equal(
        result.conflicts[0]!.otherProductName,
        `${PREFIX}A-${suffix}`,
      );
      const row = await prisma.supplierProduct.findFirstOrThrow({
        where: { supplierId, supplierSku: "K-1" },
      });
      assert.equal(row.variantId, variants[0]);
    });

    it("reports a product that already has another code at this supplier", async () => {
      const result = await repository.learn({
        supplierId,
        currency: "EUR",
        lines: [line("K-2", variants[0]!)],
      });
      assert.equal(result.learned, 0);
      assert.deepEqual(result.conflicts, [
        {
          supplierSku: "K-2",
          productName: `${PREFIX}A-${suffix}`,
          reason: "PRODUCT_HAS_OTHER_CODE",
          otherSupplierSku: "K-1",
        },
      ]);
    });

    it("does not learn from an accepted Jev suggestion, but does from a person's other pick", async () => {
      const jevRun = await run(SUPPLIER_LINE_JEV_POLICY.key, variants[2]!);
      const overruled = await run(SUPPLIER_LINE_JEV_POLICY.key, variants[1]!);
      const eanRun = await run(SUPPLIER_LINE_EAN_POLICY.key, variants[1]!);
      const result = await repository.learn({
        supplierId,
        currency: "EUR",
        lines: [
          // the Jev offered C and the person took it: not learned
          line("K-3", variants[2]!, jevRun),
          // the Jev offered B, the person picked D instead: learned
          line("K-4", variants[3]!, overruled),
          // an accepted EAN suggestion is a deterministic match: learned
          line("K-5", variants[1]!, eanRun),
        ],
      });
      assert.deepEqual(result, { learned: 2, conflicts: [] });
      const codes = (
        await prisma.supplierProduct.findMany({
          where: { supplierId },
          orderBy: { supplierSku: "asc" },
        })
      ).map((row) => `${row.supplierSku}:${row.variantId}`);
      assert.deepEqual(codes, [
        `K-1:${variants[0]}`,
        `K-4:${variants[3]}`,
        `K-5:${variants[1]}`,
      ]);
    });
  },
);
