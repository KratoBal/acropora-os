import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { PriceListRepository } from "./price-list.repository.js";
import { PriceListService } from "./price-list.service.js";
import { PriceListSuggestionRepository } from "./price-list-suggestion.repository.js";
import { PriceListSuggestionService } from "./price-list-suggestion.service.js";

/**
 * A NÉV ALAPÚ JAVASLAT ÉLETE A VALÓDI ADATBÁZISON (task arlista-nev-javaslat): a
 * feltöltés javaslatot készít a kötés nélküli sorokra, a jóváhagyás ember általi
 * kötést csinál (NAME, APPROVED) és eltünteti a cikkszám többi függő javaslatát,
 * az elutasított jelölt nem jön vissza, és egy már kötött cikkszámot a jóváhagyás
 * nem ír felül. Sorokat hoz létre és töröl, ezért csak teszt-adatbázison fut.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "PLSUG-";

function hertlein(
  rows: { code: string; name: string; ean?: string }[],
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
          row.name,
          "",
          "",
          row.ean ?? "",
          "",
          "11,20",
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
  "a névből javasolt párosítás élete",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const suggestionRepository = new PriceListSuggestionRepository();
    const suggestions = new PriceListSuggestionService(suggestionRepository);
    const service = new PriceListService(
      new PriceListRepository(),
      suggestions,
    );
    let supplierId = "";
    let userId = "";
    let variant2kg = "";
    let variant500g = "";

    async function removeLeftovers() {
      await prisma.supplierPriceSuggestion.deleteMany({
        where: { supplier: { code: { startsWith: PREFIX } } },
      });
      await prisma.supplierPriceMatch.deleteMany({
        where: { supplier: { code: { startsWith: PREFIX } } },
      });
      await prisma.supplierPriceList.deleteMany({
        where: { supplier: { code: { startsWith: PREFIX } } },
      });
      await prisma.productVariant.deleteMany({
        where: { sku: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: "Plsugbrand" } },
      });
      const users = await prisma.user.findMany({
        where: { email: { startsWith: "plsug-" } },
        select: { id: true },
      });
      await prisma.auditLog.deleteMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: "plsug-" } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: PREFIX } },
      });
    }

    const upload = (
      rows: { code: string; name: string; ean?: string }[],
      fileName: string,
    ) =>
      service.upload({
        supplierId,
        format: "HERTLEIN_ARTIKEL",
        listDate: "2026-10-20",
        currency: "EUR",
        file: { originalname: fileName, buffer: hertlein(rows) },
        userId,
      });

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
            email: `plsug-${suffix}@example.invalid`,
            displayName: "Javaslat teszt",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
      for (const [key, name] of [
        ["2kg", "Plsugbrand Reef Salt tengeri só 2kg"],
        ["500g", "Plsugbrand Reef Salt tengeri só 500g"],
      ] as const) {
        const product = await prisma.product.create({ data: { name } });
        const id = (
          await prisma.productVariant.create({
            data: { productId: product.id, sku: `${PREFIX}${key}-${suffix}` },
          })
        ).id;
        if (key === "2kg") variant2kg = id;
        else variant500g = id;
      }
    });

    after(async () => {
      await removeLeftovers();
      await prisma.$disconnect();
    });

    it("makes a suggestion for an unmatched row, with the right pack size only", async () => {
      const result = await upload(
        [{ code: "N1", name: "Plsugbrand Reef Salt tengeri só 2 kg" }],
        `${PREFIX}v1.csv`,
      );
      assert.equal(result.nameSuggestions, 1);
      const rows = await prisma.supplierPriceSuggestion.findMany({
        where: { supplierId },
        select: { supplierSku: true, variantId: true, status: true },
      });
      assert.deepEqual(rows, [
        { supplierSku: "N1", variantId: variant2kg, status: "PENDING" },
      ]);
    });

    it("lists the pending suggestion with the supplier's row and the candidate", async () => {
      const page = await suggestions.pending(supplierId, 0);
      assert.equal(page.total, 1);
      const item = page.items[0]!;
      assert.deepEqual(
        [item.supplierSku, item.listedName, item.unitPrice, item.currency],
        ["N1", "Plsugbrand Reef Salt tengeri só 2 kg", "11.2", "EUR"],
      );
      assert.equal(item.variantId, variant2kg);
      assert.ok(item.score >= 0.75 && item.score <= 1);
    });

    it("turns an approval into a person's NAME match, removes the sku's other pending candidates and does not come back", async () => {
      // a second candidate for the same sku, as a looser pass would have made it
      await prisma.supplierPriceSuggestion.create({
        data: {
          supplierId,
          supplierSku: "N1",
          variantId: variant500g,
          score: 0.76,
          basis: {},
        },
      });
      const [first] = (await suggestions.pending(supplierId, 0)).items.filter(
        (item) => item.variantId === variant2kg,
      );
      const decision = await suggestions.approve([first!.id], userId);
      assert.deepEqual(decision, { decided: 1, skipped: 0, barcodesAdded: 0 });
      const match = await prisma.supplierPriceMatch.findUniqueOrThrow({
        where: { supplierId_supplierSku: { supplierId, supplierSku: "N1" } },
        select: {
          variantId: true,
          method: true,
          status: true,
          decidedById: true,
        },
      });
      assert.deepEqual(match, {
        variantId: variant2kg,
        method: "NAME",
        status: "APPROVED",
        decidedById: userId,
      });
      assert.equal(
        await prisma.supplierPriceSuggestion.count({
          where: { supplierId, supplierSku: "N1" },
        }),
        0,
      );
      // the row is tied now: a new pass makes nothing for it
      const again = await upload(
        [
          { code: "N1", name: "Plsugbrand Reef Salt tengeri só 2 kg" },
          // another row, so the file is not the same bytes as the first upload
          { code: "N9", name: "Completely Unrelated Thing Alpha" },
        ],
        `${PREFIX}v1b.csv`,
      );
      assert.equal(again.nameSuggestions, 0);
    });

    it("keeps a rejected candidate rejected: a new pass does not bring it back", async () => {
      const first = await upload(
        [{ code: "N2", name: "Plsugbrand Reef Salt tengeri só 500 g" }],
        `${PREFIX}v2.csv`,
      );
      assert.equal(first.nameSuggestions, 1);
      const [item] = (await suggestions.pending(supplierId, 0)).items;
      assert.equal(item!.variantId, variant500g);
      assert.deepEqual(await suggestions.reject([item!.id], userId), {
        decided: 1,
        skipped: 0,
      });
      const regenerated = await suggestions.generateForList(first.listId);
      assert.equal(regenerated.stored, 0);
      assert.equal((await suggestions.pending(supplierId, 0)).total, 0);
      assert.equal(
        await prisma.supplierPriceSuggestion.count({
          where: { supplierId, supplierSku: "N2", status: "REJECTED" },
        }),
        1,
      );
    });

    it("does not overwrite a tied sku: an approval of a stale suggestion is skipped", async () => {
      const stale = await prisma.supplierPriceSuggestion.create({
        data: {
          supplierId,
          supplierSku: "N3",
          variantId: variant500g,
          score: 0.9,
          basis: {},
        },
        select: { id: true },
      });
      await prisma.supplierPriceMatch.create({
        data: {
          supplierId,
          supplierSku: "N3",
          variantId: variant2kg,
          method: "EAN",
          status: "AUTO",
        },
      });
      assert.deepEqual(await suggestions.approve([stale.id], userId), {
        decided: 0,
        skipped: 1,
        barcodesAdded: 0,
      });
      const match = await prisma.supplierPriceMatch.findUniqueOrThrow({
        where: { supplierId_supplierSku: { supplierId, supplierSku: "N3" } },
        select: { variantId: true, method: true, status: true },
      });
      assert.deepEqual(match, {
        variantId: variant2kg,
        method: "EAN",
        status: "AUTO",
      });
      // a tied sku is not offered for approval either
      assert.equal((await suggestions.pending(supplierId, 0)).total, 0);
    });

    it("gives an approved pair's variant the supplier's barcode when it has none, typed, sourced, primary and logged", async () => {
      const uploaded = await upload(
        [
          {
            code: "N6",
            name: "Plsugbrand Reef Salt tengeri só 500 g",
            ean: "4006381333931",
          },
        ],
        `${PREFIX}v6.csv`,
      );
      assert.equal(uploaded.nameSuggestions, 1);
      const [pending] = (await suggestions.pending(supplierId, 0)).items.filter(
        (item) => item.supplierSku === "N6",
      );
      assert.equal(pending!.variantId, variant500g);
      assert.equal(
        await prisma.productBarcode.count({
          where: { variantId: variant500g },
        }),
        0,
      );
      assert.deepEqual(await suggestions.approve([pending!.id], userId), {
        decided: 1,
        skipped: 0,
        barcodesAdded: 1,
      });
      const barcode = await prisma.productBarcode.findFirstOrThrow({
        where: { variantId: variant500g },
        select: { code: true, isPrimary: true, type: true, source: true },
      });
      assert.deepEqual(barcode, {
        code: "4006381333931",
        isPrimary: true,
        type: "EAN13",
        source: "IMPORT",
      });
      assert.equal(
        await prisma.auditLog.count({
          where: {
            userId,
            action: "product-barcode.added-from-price-list",
          },
        }),
        1,
      );
    });

    it("does not overwrite or add beside a variant that already has a barcode", async () => {
      await upload(
        [
          {
            code: "N7",
            name: "Plsugbrand Reef Salt tengeri só 500 g Beutel",
            ean: "5901234123457",
          },
        ],
        `${PREFIX}v7.csv`,
      );
      const [pending] = (await suggestions.pending(supplierId, 0)).items.filter(
        (item) => item.supplierSku === "N7",
      );
      assert.equal(pending!.variantId, variant500g);
      assert.deepEqual(await suggestions.approve([pending!.id], userId), {
        decided: 1,
        skipped: 0,
        barcodesAdded: 0,
      });
      const codes = await prisma.productBarcode.findMany({
        where: { variantId: variant500g },
        select: { code: true },
      });
      assert.deepEqual(codes, [{ code: "4006381333931" }]);
    });
    it("pages by sku: a sku's candidates are never split over two pages, and the total counts skus", async () => {
      // three pending skus with two candidates each
      for (const sku of ["P-A", "P-B", "P-C"])
        for (const [variantId, score] of [
          [variant2kg, 0.9],
          [variant500g, 0.8],
        ] as const)
          await prisma.supplierPriceSuggestion.create({
            data: { supplierId, supplierSku: sku, variantId, score, basis: {} },
          });
      const first = await suggestionRepository.pendingIds(supplierId, 2, 0);
      assert.equal(first.total, 3);
      assert.equal(first.ids.length, 4);
      const second = await suggestionRepository.pendingIds(supplierId, 2, 2);
      assert.equal(second.total, 3);
      assert.equal(second.ids.length, 2);
      const details = await suggestionRepository.details(first.ids);
      // each sku appears with both candidates, the better one first
      assert.deepEqual(
        details.map((row) => [row.supplierSku, Number(row.score)]),
        [
          ["P-A", 0.9],
          ["P-A", 0.8],
          ["P-B", 0.9],
          ["P-B", 0.8],
        ],
      );
      const rest = await suggestionRepository.details(second.ids);
      assert.deepEqual(
        rest.map((row) => row.supplierSku),
        ["P-C", "P-C"],
      );
    });
  },
);
