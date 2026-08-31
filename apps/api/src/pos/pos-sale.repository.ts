import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  PosPaymentMethod,
  PosSaleDetail,
  PosSaleListResponse,
  PosSaleStockWarning,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import {
  postInventoryMovement,
  type InventoryMovementDatabase,
} from "../common/inventory-movement-writer.js";
import {
  ensureMainWarehouse,
  type WarehouseLookupDatabase,
} from "../common/warehouse.util.js";
import { isUnasMasteredVariant } from "../products/catalog-authority.js";
import { parseUnasPackageComponents } from "../common/unas-package-product.util.js";
import { retryOnTakenCode } from "../common/unique-code.util.js";
import type { PosSaleListQueryDto } from "./dto/pos-sale-list-query.dto.js";
import {
  toPosSaleDetail,
  toPosSaleListItem,
  type SalesOrderListWithRelations,
  type SalesOrderWithRelations,
} from "./pos-sale.types.js";

const detailInclude = {
  customer: { select: { displayName: true } },
  soldBy: { select: { displayName: true } },
  lines: true,
} as const;

const listInclude = {
  customer: { select: { displayName: true } },
  soldBy: { select: { displayName: true } },
  _count: { select: { lines: true } },
} as const;

export interface PosSaleVariantInfo {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  /** VAT rate percentage, e.g. "27". Null when neither the variant nor the UNAS snapshot has one. */
  vatRate: Prisma.Decimal | null;
  /** Best known current quantity: local StockItem, falling back to the UNAS reported stock, then 0. */
  currentQty: Prisma.Decimal;
  /** A helyi termék készletmozgása nem kerülhet az UNAS outboxba. */
  syncToUnas: boolean;
  stockComponents: PosSaleStockComponent[];
}

export interface PosSaleStockComponent {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  quantityPerSale: Prisma.Decimal;
  syncToUnas: boolean;
}

export interface PosSaleCurrentStock {
  warehouseId: string;
  variants: Map<string, PosSaleVariantInfo>;
}

export interface CreatePosSaleLine {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  unitNet: Prisma.Decimal;
  lineGross: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
  syncToUnas: boolean;
  stockComponents: PosSaleStockComponent[];
}

export interface CreatePosSaleParams {
  orderNumber: string;
  warehouseId: string;
  actorUserId: string;
  paymentMethod: PosPaymentMethod;
  customerId: string | null;
  discountPercent: Prisma.Decimal | null;
  lines: CreatePosSaleLine[];
  totals: {
    totalNet: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    totalGross: Prisma.Decimal;
  };
}

export interface CreatePosSaleResult {
  detail: PosSaleDetail;
  /** Computed from postInventoryMovement's real, under-lock resulting onHand
   * for each line - never from a pre-transaction read (which two concurrent
   * checkouts could race past each other on). See
   * PosSaleService.createSale for why this must never block the sale. */
  stockWarnings: PosSaleStockWarning[];
}

interface PosSaleTransaction extends InventoryMovementDatabase {
  salesOrder: {
    create(args: unknown): Promise<SalesOrderWithRelations>;
  };
}

export interface PosSaleDatabase extends WarehouseLookupDatabase {
  productVariant: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        sku: string;
        name: string | null;
        unit: string;
        vatRate: Prisma.Decimal | null;
        unasReportedStock: Prisma.Decimal | null;
        product: {
          name: string;
          catalogAuthority: "UNAS" | "ACROPORA" | null;
          unasSnapshot: {
            vatRate: Prisma.Decimal | null;
            reportedStock: Prisma.Decimal | null;
            isPackageProduct: boolean;
            packageComponents: Prisma.JsonValue;
          } | null;
        };
      }>
    >;
  };
  stockItem: {
    findMany(
      args: unknown,
    ): Promise<Array<{ variantId: string; onHand: Prisma.Decimal }>>;
  };
  salesOrder: {
    findMany(args: unknown): Promise<SalesOrderListWithRelations[]>;
    findUnique(args: unknown): Promise<SalesOrderWithRelations | null>;
    count(args: unknown): Promise<number>;
  };
  $transaction<T>(
    operation: (transaction: PosSaleTransaction) => Promise<T>,
  ): Promise<T>;
}

export const POS_SALE_DATABASE = Symbol("POS_SALE_DATABASE");

@Injectable()
export class PosSaleRepository extends Repository {
  private readonly saleDatabase: PosSaleDatabase;

  constructor(
    @Optional()
    @Inject(POS_SALE_DATABASE)
    saleDatabase?: PosSaleDatabase,
  ) {
    super(prisma);
    this.saleDatabase = saleDatabase ?? (prisma as unknown as PosSaleDatabase);
  }

  async currentStock(variantIds: string[]): Promise<PosSaleCurrentStock> {
    const warehouse = await ensureMainWarehouse(this.saleDatabase);
    if (variantIds.length === 0) {
      return { warehouseId: warehouse.id, variants: new Map() };
    }

    const variants = await this.saleDatabase.productVariant.findMany({
      where: {
        id: { in: variantIds },
        product: { catalogAuthority: "UNAS" },
      },
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        vatRate: true,
        unasReportedStock: true,
        product: {
          select: {
            name: true,
            catalogAuthority: true,
            unasSnapshot: {
              select: {
                vatRate: true,
                reportedStock: true,
                isPackageProduct: true,
                packageComponents: true,
              },
            },
          },
        },
      },
    });
    const packageComponentSkus = [
      ...new Set(
        variants.flatMap((variant) =>
          variant.product.unasSnapshot?.isPackageProduct
            ? parseUnasPackageComponents(
                variant.product.unasSnapshot.packageComponents,
              ).map((component) => component.sku)
            : [],
        ),
      ),
    ];
    const componentVariants =
      packageComponentSkus.length > 0
        ? await this.saleDatabase.productVariant.findMany({
            where: { sku: { in: packageComponentSkus }, isActive: true },
            select: {
              id: true,
              sku: true,
              unit: true,
              vatRate: true,
              product: {
                select: {
                  name: true,
                  catalogAuthority: true,
                  unasSnapshot: {
                    select: {
                      vatRate: true,
                      reportedStock: true,
                      isPackageProduct: true,
                      packageComponents: true,
                    },
                  },
                },
              },
            },
          })
        : [];
    const componentVariantBySku = new Map(
      componentVariants.map((variant) => [variant.sku, variant]),
    );
    const stockItems = await this.saleDatabase.stockItem.findMany({
      where: {
        warehouseId: warehouse.id,
        locationId: null,
        lotId: null,
        variantId: { in: variantIds },
      },
      select: { variantId: true, onHand: true },
    });
    const onHandByVariant = new Map(
      stockItems.map((item) => [item.variantId, item.onHand]),
    );

    const result = new Map<string, PosSaleVariantInfo>();
    for (const variant of variants) {
      const snapshot = variant.product.unasSnapshot;
      const packageComponents = snapshot?.isPackageProduct
        ? parseUnasPackageComponents(snapshot.packageComponents)
        : [];
      const stockComponents = snapshot?.isPackageProduct
        ? packageComponents.flatMap((component) => {
            const resolved = componentVariantBySku.get(component.sku);
            if (
              !resolved ||
              !isUnasMasteredVariant(resolved) ||
              resolved.product.unasSnapshot?.isPackageProduct
            )
              return [];
            return [
              {
                variantId: resolved.id,
                sku: resolved.sku,
                productName: resolved.product.name,
                unit: resolved.unit,
                quantityPerSale: component.qty,
                syncToUnas: true,
              },
            ];
          })
        : [
            {
              variantId: variant.id,
              sku: variant.sku,
              productName: variant.name ?? variant.product.name,
              unit: variant.unit,
              quantityPerSale: new Prisma.Decimal(1),
              syncToUnas: isUnasMasteredVariant(variant),
            },
          ];
      result.set(variant.id, {
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.name ?? variant.product.name,
        unit: variant.unit,
        vatRate: variant.vatRate ?? snapshot?.vatRate ?? null,
        currentQty:
          onHandByVariant.get(variant.id) ??
          variant.unasReportedStock ??
          snapshot?.reportedStock ??
          new Prisma.Decimal(0),
        syncToUnas: isUnasMasteredVariant(variant),
        stockComponents:
          snapshot?.isPackageProduct &&
          stockComponents.length !== packageComponents.length
            ? []
            : stockComponents,
      });
    }
    return { warehouseId: warehouse.id, variants: result };
  }

  /// Stabil, üzleti azonosítóból (nem véletlenszerűen) származó
  /// idempotenciakulcs a postInventoryMovement számára. KORLÁT: az
  /// orderNumber-t a service minden hívásnál újra generálja
  /// (generateCode("POS")), és a jelenlegi CreatePosSaleInput/kliens nem
  /// küld semmilyen stabil checkout/fizetési/nyugta-azonosítót, amire
  /// támaszkodni lehetne (l. PosSaleService.createSale megjegyzése) - így
  /// ez a kulcs UGYANAZT a feldolgozási kísérletet (pl. egy belső retry,
  /// ami ugyanazt az orderNumber-t újra látja) védi ki, de egy tényleges
  /// kliensoldali dupla-submitot (két különböző orderNumber-rel) NEM.
  /// Új kötelező mezőt a kérésbe emiatt szándékosan NEM vezetünk be - ez
  /// dokumentált, ismert korlát, amíg a POS UI nem küld stabil kulcsot.
  private buildIdempotencyKey(orderNumber: string): string {
    return `POS_SALE:${orderNumber}`;
  }

  /// A KESZLET-MOZGAS SZAMA IDEBENT KESZUL, es a POS a legnagyobb forgalmu
  /// csalad: itt a legvalószinubb, hogy ket bizonylat ugyanabba a masodpercbe
  /// esik es ugyanazt a negyjegyu veget huzza. Ma az eladas ilyenkor hibaval
  /// vegzodik, es az eladonak kell ujraprobalnia, a vevo elott.
  ///
  /// A BURKOLAT AZ EGESZ TRANZAKCIOT FUTTATJA UJRA, es nem kap kodot kivulrol:
  /// a `generateCode("ELAD")` a lezaron belul all, tehat a masodik kiserlet mas
  /// veget huz. Ez az `orderNumber`-re NEM vonatkozik -- azt ma a szolgaltatas
  /// allitja elo es adja at, tehat egy ujrafuttatas ugyanazt latja.
  ///
  /// AMIT SZANDEKOSAN ATENGED: az idempotencia-kulcs egyedisegi hibaja. Az nem
  /// kodutkozes, hanem ugyanaz a keres masodszor, es a mai valasz a helyes. A
  /// burkolat csak a `movementNumber` oszlopra van felirva, minden mas egyedisegi
  /// hiba az elso kiserletben, valtozatlanul megy tovabb a hivo fele.
  async createSale(params: CreatePosSaleParams): Promise<CreatePosSaleResult> {
    const now = new Date();

    const created = await retryOnTakenCode({ field: "movementNumber" }, () =>
      this.saleDatabase.$transaction(async (transaction) => {
        // A figyelmeztetesek listaja a lezaron BELUL szuletik, es onnan jon ki.
        // Kivul allva egy ujrafuttatas az elbukott kiserlet sorait is
        // megtartana, es a vevo ket ugyanolyan figyelmeztetest latna egy
        // eladasrol. A tranzakcio maga visszagorgetheto, egy metoduson kivuli
        // tomb nem.
        const stockWarnings: PosSaleStockWarning[] = [];
        const order = await transaction.salesOrder.create({
          data: {
            orderNumber: params.orderNumber,
            channel: "POS",
            status: "COMPLETED",
            customerId: params.customerId,
            warehouseId: params.warehouseId,
            soldById: params.actorUserId,
            paymentMethod: params.paymentMethod,
            currency: "HUF",
            totalNet: params.totals.totalNet,
            totalTax: params.totals.totalTax,
            totalGross: params.totals.totalGross,
            discountPercent: params.discountPercent,
            orderedAt: now,
            confirmedAt: now,
            completedAt: now,
            lines: {
              create: params.lines.map((line) => ({
                variantId: line.variantId,
                sku: line.sku,
                description: line.productName,
                quantity: line.quantity,
                unit: line.unit,
                unitNet: line.unitNet,
                taxRate: line.taxRate,
                lineGross: line.lineGross,
                discountPercent: line.discountPercent,
                // "PENDING": a helyi könyvelés és a
                // UnasStockSyncOutbox-publikálás a postInventoryMovement
                // hívással egy tranzakcióban történik lejjebb; a tényleges
                // UNAS-push a háttér-workeré, ez a sor sosem állíthat
                // szinkron OK-t.
                syncStatus: "PENDING",
                syncError: null,
              })),
            },
          },
          include: detailInclude,
        });

        // Egyetlen postInventoryMovement hívás könyveli az összes sort:
        // negatív quantityDelta minden esetben (ELADÁS mindig csökkenti a
        // készletet), és a negatív készlet EZEN a flow-n szándékosan
        // megengedett (l. docs/INVENTORY-CONSISTENCY.md, "Negatív
        // készlet") - a writer sosem dobja el/blokkolja emiatt a
        // könyvelést, csak jelzi a `wentNegative` flaget soronként.
        const movementLinesByVariant = new Map<
          string,
          {
            variantId: string;
            sku: string;
            productName: string;
            quantityDelta: Prisma.Decimal;
            unit: string;
            syncToUnas: boolean;
          }
        >();
        for (const line of params.lines) {
          for (const component of line.stockComponents) {
            const delta = line.quantity
              .times(component.quantityPerSale)
              .negated();
            const existing = movementLinesByVariant.get(component.variantId);
            if (existing) {
              existing.quantityDelta = existing.quantityDelta.plus(delta);
            } else
              movementLinesByVariant.set(component.variantId, {
                variantId: component.variantId,
                sku: component.sku,
                productName: component.productName,
                quantityDelta: delta,
                unit: component.unit,
                syncToUnas: component.syncToUnas,
              });
          }
        }
        const posted = await postInventoryMovement(transaction, {
          idempotencyKey: this.buildIdempotencyKey(params.orderNumber),
          movementNumber: generateCode("ELAD"),
          type: "SALE",
          warehouseId: params.warehouseId,
          referenceType: "SalesOrder",
          referenceId: order.id,
          performedById: params.actorUserId,
          occurredAt: now,
          sourceProcess: "POS_SALE",
          lines: [...movementLinesByVariant.values()].map((line) => ({
            variantId: line.variantId,
            sku: line.sku,
            quantityDelta: line.quantityDelta,
            unit: line.unit,
            syncToUnas: line.syncToUnas,
          })),
        });

        // A figyelmeztetés a writer VALÓS, zár alatt számított eredményéből
        // épül, nem egy tranzakció-előtti (ezért versenyhelyzetben elavulttá
        // válható) becslésből - két egyidejű eladás így sem tud egymás
        // negatív-készlet jelzését elnyomni vagy hamisan kihagyni.
        const productNameByVariant = new Map(
          [...movementLinesByVariant.values()].map((line) => [
            line.variantId,
            line.productName,
          ]),
        );
        for (const line of posted.lines) {
          if (!line.wentNegative) continue;
          stockWarnings.push({
            sku: line.sku,
            productName: productNameByVariant.get(line.variantId) ?? line.sku,
            resultingQty: line.resultingOnHand.toString(),
          });
        }

        return { order, stockWarnings };
      }),
    );

    return {
      detail: toPosSaleDetail(created.order),
      stockWarnings: created.stockWarnings,
    };
  }

  async list(query: PosSaleListQueryDto): Promise<PosSaleListResponse> {
    const where = {
      channel: "POS" as const,
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom
                ? { gte: new Date(query.createdFrom) }
                : {}),
              ...(query.createdTo ? { lt: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [items, totalItems] = await Promise.all([
      this.saleDatabase.salesOrder.findMany({
        where,
        include: listInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.pageSize,
      }),
      this.saleDatabase.salesOrder.count({ where }),
    ]);
    return {
      items: items.map(toPosSaleListItem),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async findById(id: string): Promise<PosSaleDetail | null> {
    const order = await this.saleDatabase.salesOrder.findUnique({
      where: { id },
      include: detailInclude,
    });
    return order ? toPosSaleDetail(order) : null;
  }
}
