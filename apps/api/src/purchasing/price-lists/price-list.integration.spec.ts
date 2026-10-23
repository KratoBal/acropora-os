import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { PriceListRepository } from "./price-list.repository.js";
import { PriceListService } from "./price-list.service.js";
import { PriceListSuggestionRepository } from "./price-list-suggestion.repository.js";
import { PriceListSuggestionService } from "./price-list-suggestion.service.js";

/**
 * AZ ÁRLISTA FELTÖLTÉSE A VALÓDI ADATBÁZISON (task beszallitoi-arlistak-2): a
 * lista és a sorai egy tranzakcióban, a lenyomat egyedi, az EAN- és a
 * cikkszám-alapú automatikus kötés, az elutasított kötés nem jön vissza, a lista
 * törlése a sorokat viszi és a kötéseket megtartja. Sorokat hoz létre és töröl,
 * ezért csak teszt-adatbázison fut (`integrationDatabaseGate`).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "PRICELIST-";
const EAN_A = "9990000000017";

function hertlein(
  rows: { code: string; ean: string; price: string }[],
): Buffer {
  const header = [
    "Artikelnummer",
    "Artikelhersteller",
    "Produktname",
    "Beschreibung kurz",
    "Beschreibung lang",
    "EAN",
    "Kategorie",
    "Preis",
    "Preis 2",
    "Steuer",
    "Last Change",
    "UVP",
  ];
  const line = (cells: string[]) => cells.map((cell) => `"${cell}"`).join("|");
  return Buffer.from(
    [
      line(header),
      ...rows.map((row) =>
        line([
          row.code,
          "",
          `Example ${row.code}`,
          "",
          "",
          row.ean,
          "",
          row.price,
          "",
          "1",
          "",
          "",
        ]),
      ),
    ].join("\r\n") + "\r\n",
    "utf8",
  );
}

describe(
  "a beszállítói árlista feltöltése",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const service = new PriceListService(
      new PriceListRepository(),
      new PriceListSuggestionService(new PriceListSuggestionRepository()),
    );
    let supplierId = "";
    let userId = "";
    const variants: Record<string, string> = {};

    async function removeLeftovers() {
      await prisma.supplierPriceMatch.deleteMany({
        where: { supplier: { code: { startsWith: PREFIX } } },
      });
      await prisma.supplierPriceList.deleteMany({
        where: { supplier: { code: { startsWith: PREFIX } } },
      });
      await prisma.supplierProduct.deleteMany({
        where: { supplier: { code: { startsWith: PREFIX } } },
      });
      await prisma.productBarcode.deleteMany({ where: { code: EAN_A } });
      await prisma.productVariant.deleteMany({
        where: { sku: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      const users = await prisma.user.findMany({
        where: { email: { startsWith: "pricelist-" } },
        select: { id: true },
      });
      await prisma.auditLog.deleteMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: "pricelist-" } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: PREFIX } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      supplierId = (
        await prisma.supplier.create({
          data: {
            code: `${PREFIX}${suffix}`,
            name: `${PREFIX}Szallito`,
            isSupplier: true,
            isService: false,
          },
        })
      ).id;
      userId = (
        await prisma.user.create({
          data: {
            email: `pricelist-${suffix}@example.invalid`,
            displayName: "Arlista teszt",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
      for (const name of ["A", "B"]) {
        const product = await prisma.product.create({
          data: { name: `${PREFIX}${name}-${suffix}` },
        });
        variants[name] = (
          await prisma.productVariant.create({
            data: { productId: product.id, sku: `${PREFIX}${name}-${suffix}` },
          })
        ).id;
      }
      await prisma.productBarcode.create({
        data: { variantId: variants.A!, code: EAN_A },
      });
      // the supplier code the invoices already taught for P3
      await prisma.supplierProduct.create({
        data: {
          supplierId,
          variantId: variants.B!,
          supplierSku: "P3",
          currency: "EUR",
        },
      });
    });

    after(async () => {
      await removeLeftovers();
      await prisma.$disconnect();
    });

    const upload = (buffer: Buffer, fileName: string) =>
      service.upload({
        supplierId,
        format: "HERTLEIN_ARTIKEL",
        listDate: "2026-10-20",
        currency: "EUR",
        file: { originalname: fileName, buffer },
        userId,
      });

    it("saves the list and its rows, binds the barcode and the known code, refuses the same file twice, keeps the matches when the list goes", async () => {
      const file = hertlein([
        { code: "P1", ean: EAN_A, price: "11,20" },
        { code: "P2", ean: "9990000000024", price: "4,10" },
        { code: "P3", ean: "", price: "7,00" },
      ]);
      const result = await upload(file, `${PREFIX}v1.csv`);
      assert.deepEqual([result.rowCount, result.rejectedRowCount], [3, 0]);
      assert.deepEqual(result.matching, {
        alreadyMatched: 0,
        autoByEan: 1,
        autoByCode: 1,
        conflicts: 0,
        previouslyRejected: 0,
        unmatched: 1,
      });

      const entries = await prisma.supplierPriceListEntry.findMany({
        where: { listId: result.listId },
        orderBy: { supplierSku: "asc" },
        select: { supplierSku: true, unitPrice: true, gtin: true },
      });
      assert.deepEqual(
        entries.map((e) => [e.supplierSku, e.unitPrice.toString(), e.gtin]),
        [
          ["P1", "11.2", "09990000000017"],
          ["P2", "4.1", "09990000000024"],
          ["P3", "7", null],
        ],
      );
      const matches = await prisma.supplierPriceMatch.findMany({
        where: { supplierId },
        orderBy: { supplierSku: "asc" },
        select: {
          supplierSku: true,
          variantId: true,
          method: true,
          status: true,
        },
      });
      assert.deepEqual(matches, [
        {
          supplierSku: "P1",
          variantId: variants.A,
          method: "EAN",
          status: "AUTO",
        },
        {
          supplierSku: "P3",
          variantId: variants.B,
          method: "SUPPLIER_CODE",
          status: "AUTO",
        },
      ]);

      await assert.rejects(
        upload(file, `${PREFIX}v1-again.csv`),
        ConflictException,
      );
      assert.equal(
        await prisma.supplierPriceList.count({ where: { supplierId } }),
        1,
      );

      const removed = await service.remove(result.listId, userId);
      assert.equal(removed.removedRows, 3);
      assert.equal(
        await prisma.supplierPriceListEntry.count({
          where: { listId: result.listId },
        }),
        0,
      );
      assert.equal(
        await prisma.supplierPriceMatch.count({ where: { supplierId } }),
        2,
      );
    });

    it("does not bring back a rejected match when a corrected file is uploaded", async () => {
      await prisma.supplierPriceMatch.update({
        where: { supplierId_supplierSku: { supplierId, supplierSku: "P1" } },
        data: {
          status: "REJECTED",
          decidedAt: new Date(),
          decidedById: userId,
        },
      });
      const result = await upload(
        hertlein([
          { code: "P1", ean: EAN_A, price: "11,50" },
          { code: "P3", ean: "", price: "7,00" },
        ]),
        `${PREFIX}v2.csv`,
      );
      assert.deepEqual(result.matching, {
        alreadyMatched: 1,
        autoByEan: 0,
        autoByCode: 0,
        conflicts: 0,
        previouslyRejected: 1,
        unmatched: 0,
      });
      const p1 = await prisma.supplierPriceMatch.findUniqueOrThrow({
        where: { supplierId_supplierSku: { supplierId, supplierSku: "P1" } },
        select: { status: true },
      });
      assert.equal(p1.status, "REJECTED");
    });

    it("does not overwrite a rejection even when the barcode now belongs to a different product", async () => {
      // the data turned: the barcode moves to the other product
      await prisma.productBarcode.update({
        where: { code: EAN_A },
        data: { variantId: variants.B! },
      });
      const result = await upload(
        hertlein([
          { code: "P1", ean: EAN_A, price: "11,80" },
          { code: "P3", ean: "", price: "7,00" },
        ]),
        `${PREFIX}v3.csv`,
      );
      assert.deepEqual(result.matching, {
        alreadyMatched: 1,
        autoByEan: 0,
        autoByCode: 0,
        conflicts: 0,
        previouslyRejected: 1,
        unmatched: 0,
      });
      const p1 = await prisma.supplierPriceMatch.findUniqueOrThrow({
        where: { supplierId_supplierSku: { supplierId, supplierSku: "P1" } },
        select: { status: true, variantId: true, decidedById: true },
      });
      assert.deepEqual(p1, {
        status: "REJECTED",
        variantId: variants.A,
        decidedById: userId,
      });
    });

    it("counts a list's coverage in the database: matched by method, rejected, unmatched with and without a barcode, and our own barcode the matcher missed", async () => {
      // our own table holds a barcode written in groups: the matcher looks for the
      // exact forms and does not find it, the diagnostic count does
      await prisma.productBarcode.create({
        data: { variantId: variants.B!, code: "999 000 000 0024" },
      });
      // a barcode on TWO of our variants (the same code in two written forms) is a
      // conflict, not a mistake: the matcher rightly ties nothing, and the
      // diagnostic must not count it
      await prisma.productBarcode.createMany({
        data: [
          { variantId: variants.A!, code: "9990000000031" },
          { variantId: variants.B!, code: "09990000000031" },
        ],
      });
      const result = await upload(
        hertlein([
          { code: "P1", ean: EAN_A, price: "12,10" },
          { code: "P2", ean: "9990000000024", price: "4,10" },
          { code: "P3", ean: "", price: "7,00" },
          { code: "P4", ean: "", price: "3,00" },
          { code: "P5", ean: "9990000000031", price: "2,00" },
        ]),
        `${PREFIX}v4.csv`,
      );
      const coverage = (
        await new PriceListRepository().coverage([result.listId])
      ).get(result.listId)!;
      assert.deepEqual(
        { ...coverage, listId: undefined },
        {
          listId: undefined,
          rows: 5,
          eanAuto: 0,
          eanApproved: 0,
          codeAuto: 1,
          codeApproved: 0,
          nameAuto: 0,
          nameApproved: 0,
          rejected: 1,
          unmatchedWithBarcode: 2,
          unmatchedWithoutBarcode: 1,
          unmatchedBarcodeKnownToUs: 1,
        },
      );
    });
  },
);
