import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";
import {
  PosProductSearchRepository,
  type PosProductSearchDatabase,
} from "./pos-product-search.repository.js";

// No database connection: verify the additive response against existing
// stock/price/VAT fallback values and the sale resolver's snapshot flag.
describe("POS search package flag", () => {
  it("uses the sale resolver's UNAS flag and leaves every existing field intact", async () => {
    const decimal = (value: string) => new Prisma.Decimal(value);
    const variants = [true, false, null].map((flag, index) => ({
      id: `v${index}`,
      productId: `p${index}`,
      sku: `SKU${index}`,
      name: null,
      unit: "db",
      vatRate: index === 0 ? decimal("27") : null,
      unasReportedStock: index === 1 ? decimal("4") : null,
      product: {
        name: `Termék ${index}`,
        unasSnapshot:
          flag === null
            ? null
            : {
                grossPrice: decimal("1000"),
                vatRate: decimal("5"),
                reportedStock: decimal("8"),
                // A flagged package still counts as a package even if its components
                // cannot be resolved; checkout is responsible for that validation.
                isPackageProduct: flag,
              },
      },
    }));
    let query: any;
    const database: PosProductSearchDatabase = {
      warehouse: {
        findFirst: async () => ({ id: "main", name: "Fő raktár" }),
        create: async () => ({ id: "main", name: "Fő raktár" }),
      },
      productVariant: {
        findMany: async (args) => {
          query = args;
          return variants;
        },
      },
      stockItem: {
        findMany: async () => [
          { variantId: "v0", onHand: decimal("10"), reserved: decimal("2") },
        ],
      },
    };
    const result = await new PosProductSearchRepository(database).search("SKU");
    assert.deepEqual(result, [
      {
        variantId: "v0",
        productId: "p0",
        sku: "SKU0",
        productName: "Termék 0",
        unit: "db",
        vatRate: "27",
        grossPrice: "1000",
        currentStock: "8",
        isPackageProduct: true,
      },
      {
        variantId: "v1",
        productId: "p1",
        sku: "SKU1",
        productName: "Termék 1",
        unit: "db",
        vatRate: "5",
        grossPrice: "1000",
        currentStock: "4",
        isPackageProduct: false,
      },
      {
        variantId: "v2",
        productId: "p2",
        sku: "SKU2",
        productName: "Termék 2",
        unit: "db",
        vatRate: null,
        grossPrice: null,
        currentStock: "0",
        isPackageProduct: false,
      },
    ]);
    assert.equal(query.select.productId, true);
    assert.equal(
      query.select.product.select.unasSnapshot.select.isPackageProduct,
      true,
    );
    assert.equal(query.where.OR[2].barcodes.some.code.contains, "SKU");
  });
});
