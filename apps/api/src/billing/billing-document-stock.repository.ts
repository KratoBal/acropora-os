import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { generateCode } from "../common/code-generator.util.js";
import { postInventoryMovement } from "../common/inventory-movement-writer.js";
import { parseUnasPackageComponents } from "../common/unas-package-product.util.js";
import { retryOnTakenCode } from "../common/unique-code.util.js";
import { ensureMainWarehouse } from "../common/warehouse.util.js";
import { isUnasMasteredVariant } from "../products/catalog-authority.js";
import {
  invoiceStockIdempotencyKey,
  planInvoiceStock,
  type StockComponentVariant,
  type StockProduct,
  invoiceStornoStockIdempotencyKey,
} from "./billing-document-stock.js";

export interface InvoiceStockResult {
  /** Már könyvelve volt (ismételt kiállítás-kattintás): semmi új nem íródott. */
  alreadyPosted: boolean;
  movedLines: number;
}

/**
 * A SZÁMLA KÉSZLETKÖNYVELÉSE. Egy tranzakció: a központi író
 * (`postInventoryMovement`, UNAS-terméknél a kimenő sorral együtt) és a sorok
 * `stockOutcome`-ja együtt kerül be, vagy egyik sem. Az idempotencia-kulcs a
 * számla azonosítójából képződik, tehát egy második hívás nem von le újra.
 */
@Injectable()
export class BillingDocumentStockRepository {
  private readonly database = prisma;

  async postIssuedInvoice(
    invoiceId: string,
    actorUserId: string,
  ): Promise<InvoiceStockResult | null> {
    const invoice = await this.database.invoice.findFirst({
      where: { id: invoiceId, status: "ISSUED" },
      select: {
        id: true,
        invoiceNumber: true,
        documentType: true,
        sourceType: true,
        lines: {
          select: {
            id: true,
            kind: true,
            productId: true,
            variantId: true,
            quantity: true,
          },
        },
      },
    });
    if (!invoice) return null;

    const productIds = [
      ...new Set(invoice.lines.flatMap((line) => line.productId ?? [])),
    ];
    const products = await this.database.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        type: true,
        catalogAuthority: true,
        variants: {
          where: { isActive: true },
          select: { id: true, sku: true, unit: true },
        },
        unasSnapshot: {
          select: { isPackageProduct: true, packageComponents: true },
        },
      },
    });
    const productById = new Map<string, StockProduct>(
      products.map((product) => [
        product.id,
        {
          id: product.id,
          type: product.type,
          catalogAuthority: product.catalogAuthority,
          variants: product.variants,
          isPackageProduct: product.unasSnapshot?.isPackageProduct ?? false,
          packageComponents: product.unasSnapshot?.packageComponents ?? null,
        },
      ]),
    );
    const componentSkus = [
      ...new Set(
        [...productById.values()].flatMap((product) =>
          product.isPackageProduct
            ? parseUnasPackageComponents(product.packageComponents).map(
                (component) => component.sku,
              )
            : [],
        ),
      ),
    ];
    const components =
      componentSkus.length > 0
        ? await this.database.productVariant.findMany({
            where: { sku: { in: componentSkus }, isActive: true },
            select: {
              id: true,
              sku: true,
              unit: true,
              product: {
                select: {
                  catalogAuthority: true,
                  unasSnapshot: { select: { isPackageProduct: true } },
                },
              },
            },
          })
        : [];
    const componentsBySku = new Map<string, StockComponentVariant>(
      components.map((variant) => [
        variant.sku,
        {
          id: variant.id,
          sku: variant.sku,
          unit: variant.unit,
          catalogAuthority: variant.product.catalogAuthority,
          isPackageProduct:
            variant.product.unasSnapshot?.isPackageProduct ?? false,
        },
      ]),
    );

    const plan = planInvoiceStock({
      documentType: invoice.documentType,
      sourceType: invoice.sourceType,
      lines: invoice.lines,
      products: productById,
      componentsBySku,
    });
    const warehouse =
      plan.movement.length > 0
        ? await ensureMainWarehouse(this.database)
        : null;

    return retryOnTakenCode({ field: "movementNumber" }, () =>
      this.database.$transaction(async (transaction) => {
        let alreadyPosted = false;
        if (warehouse) {
          const posted = await postInventoryMovement(transaction, {
            idempotencyKey: invoiceStockIdempotencyKey(invoice.id),
            movementNumber: generateCode("SZLA"),
            type: "SALE",
            warehouseId: warehouse.id,
            referenceType: "Invoice",
            referenceId: invoice.id,
            performedById: actorUserId,
            note: invoice.invoiceNumber,
            sourceProcess: "BILLING_INVOICE",
            lines: plan.movement,
          });
          alreadyPosted = posted.alreadyPosted;
        }
        // Az eredményt csak az első könyvelés írja: egy ismételt hívás nem
        // írja felül azzal, amit a termék MA mondana.
        if (!alreadyPosted)
          for (const [lineId, outcome] of plan.outcomes)
            await transaction.invoiceLine.updateMany({
              where: { id: lineId, invoiceId: invoice.id, stockOutcome: null },
              data: { stockOutcome: outcome },
            });
        return {
          alreadyPosted,
          movedLines: [...plan.outcomes.values()].filter(
            (outcome) => outcome === "MOVED",
          ).length,
        };
      }),
    );
  }

  /**
   * A SZTORNÓ VISSZAADJA A SZÁMLA ELADÁSÁT (számlázási brief, 1. pont). A
   * számla kiállításkori `SALE` mozgásának sorait egy `RETURN_IN` mozgás adja
   * vissza, ugyanabba a raktárba, a sztornó soron hivatkozva. Ami a számlán
   * nem mozgott (nem készletes tétel, fel nem oldott csomag), az most sem
   * mozdul: a forrás a tényleges mozgás, nem a számla mai sorai. Saját
   * idempotencia-kulcs, tehát egy második hívás nem ad vissza kétszer.
   */
  async postStornoReturn(
    invoiceId: string,
    stornoId: string,
    stornoNumber: string | null,
    actorUserId: string,
  ): Promise<{ alreadyPosted: boolean; returnedLines: number } | null> {
    const sale = await this.database.stockMovement.findFirst({
      where: { idempotencyKey: invoiceStockIdempotencyKey(invoiceId) },
      select: {
        sourceWarehouseId: true,
        lines: {
          select: {
            variantId: true,
            quantity: true,
            unit: true,
            variant: {
              select: {
                sku: true,
                product: { select: { catalogAuthority: true } },
              },
            },
          },
        },
      },
    });
    if (!sale || sale.lines.length === 0) return null;
    const warehouseId =
      sale.sourceWarehouseId ?? (await ensureMainWarehouse(this.database)).id;
    return retryOnTakenCode({ field: "movementNumber" }, () =>
      this.database.$transaction(async (transaction) => {
        const posted = await postInventoryMovement(transaction, {
          idempotencyKey: invoiceStornoStockIdempotencyKey(invoiceId),
          movementNumber: generateCode("SZTO"),
          type: "RETURN_IN",
          warehouseId,
          referenceType: "Invoice",
          referenceId: stornoId,
          performedById: actorUserId,
          note: stornoNumber,
          sourceProcess: "BILLING_STORNO",
          lines: sale.lines.map((line) => ({
            variantId: line.variantId,
            sku: line.variant.sku,
            unit: line.unit,
            // a mozgás sora a mennyiség abszolút értékét tárolja; vissza: +
            quantityDelta: line.quantity.abs(),
            syncToUnas: isUnasMasteredVariant({
              product: {
                catalogAuthority: line.variant.product.catalogAuthority,
              },
            }),
          })),
        });
        return {
          alreadyPosted: posted.alreadyPosted,
          returnedLines: posted.alreadyPosted ? 0 : sale.lines.length,
        };
      }),
    );
  }
}
