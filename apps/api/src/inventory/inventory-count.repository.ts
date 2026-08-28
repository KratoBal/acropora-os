import {
  ConflictException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  InventoryCountDetail,
  InventoryCountListResponse,
} from "@acropora/types";

import { withUniqueCode } from "../common/unique-code.util.js";
import {
  isDuplicateMovementIdempotencyKeyError,
  lockVariantWarehouse,
  postInventoryMovement,
  type InventoryMovementDatabase,
} from "../common/inventory-movement-writer.js";
import { setStockItemQuantity } from "../common/stock-item-writer.js";
import {
  ensureMainWarehouse,
  type WarehouseLookupDatabase,
} from "../common/warehouse.util.js";
import type { InventoryCountListQueryDto } from "./dto/inventory-count-list-query.dto.js";
import {
  toInventoryCountDetail,
  toInventoryCountListItem,
  type InventoryCountListWithRelations,
  type InventoryCountWithRelations,
} from "./inventory-count.types.js";

const detailInclude = {
  warehouse: true,
  startedBy: true,
  lines: {
    include: { variant: { include: { product: true } } },
  },
} as const;

const listInclude = {
  warehouse: true,
  startedBy: true,
  _count: { select: { lines: true } },
} as const;

export interface InventoryCountApplyResultRow {
  detail: InventoryCountDetail;
  movementNumber: string;
  /** Tétel, aminek a helyi könyvelése rendben lezajlott (megváltozott
   * mennyiség -> ADJUSTMENT + outbox a közös writeren át; változatlan vagy
   * csak most alapkészletet kapó tétel -> nincs is mit könyvelni). A tényleges
   * UNAS-publikálás ETTŐL FÜGGETLENÜL, később, a háttér-workeren keresztül
   * történik - ez a szám NEM azt jelenti, hogy a UNAS már megkapta a
   * frissítést, csak hogy a helyi tranzakció sikeres volt. Lásd
   * docs/INVENTORY-CONSISTENCY.md. */
  successCount: number;
  /** A jelenlegi tranzakciós modell mellett gyakorlatilag mindig 0: egy
   * valódi hiba a teljes korrekciós tranzakciót visszagörgeti (nincs
   * részleges, "néhány tétel sikertelen" állapot) - a mező a válasz
   * visszafelé-kompatibilitása miatt maradt meg. */
  failedCount: number;
}

interface InventoryCountApplyTransaction extends InventoryMovementDatabase {
  inventoryCountLine: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        variantId: string;
        expectedQty: Prisma.Decimal;
        countedQty: Prisma.Decimal | null;
        variant: {
          sku: string;
          unit: string;
          product: {
            catalogAuthority: "UNAS" | "ACROPORA" | null;
            unasSnapshot: { isPackageProduct: boolean } | null;
          };
        };
      }>
    >;
    update(args: unknown): Promise<unknown>;
  };
  // Widened beyond InventoryMovementDatabase's stockItem (which only needs
  // findFirst/update/create): the "needsBaseline" scan below has to see
  // which variants already have a StockItem row *before* touching any of
  // them, hence the extra findMany.
  stockItem: InventoryMovementDatabase["stockItem"] & {
    findMany(args: unknown): Promise<Array<{ variantId: string }>>;
  };
  inventoryCount: {
    update(args: unknown): Promise<InventoryCountWithRelations>;
  };
}

export interface InventoryCountDatabase {
  warehouse: WarehouseLookupDatabase["warehouse"];
  productVariant: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        sku: string;
        unit: string;
        unasReportedStock: Prisma.Decimal | null;
        product: {
          name: string;
          unasSnapshot: { reportedStock: Prisma.Decimal | null } | null;
        };
      }>
    >;
  };
  stockItem: {
    findMany(
      args: unknown,
    ): Promise<Array<{ variantId: string; onHand: Prisma.Decimal }>>;
  };
  inventoryCount: {
    create(args: unknown): Promise<InventoryCountWithRelations>;
    findMany(args: unknown): Promise<InventoryCountListWithRelations[]>;
    findUnique(args: unknown): Promise<InventoryCountWithRelations | null>;
    count(args: unknown): Promise<number>;
  };
  inventoryCountLine: {
    updateMany(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  $transaction<T>(
    operation: (transaction: InventoryCountApplyTransaction) => Promise<T>,
    options?: { isolationLevel: "Serializable"; timeout?: number },
  ): Promise<T>;
}

export const INVENTORY_COUNT_DATABASE = Symbol("INVENTORY_COUNT_DATABASE");

@Injectable()
export class InventoryCountRepository extends Repository {
  private readonly countDatabase: InventoryCountDatabase;

  constructor(
    @Optional()
    @Inject(INVENTORY_COUNT_DATABASE)
    countDatabase?: InventoryCountDatabase,
  ) {
    super(prisma);
    this.countDatabase =
      countDatabase ?? (prisma as unknown as InventoryCountDatabase);
  }

  async list(
    query: InventoryCountListQueryDto,
  ): Promise<InventoryCountListResponse> {
    const where: { status?: string } = {
      ...(query.status ? { status: query.status } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [items, totalItems] = await Promise.all([
      this.countDatabase.inventoryCount.findMany({
        where,
        include: listInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.pageSize,
      }),
      this.countDatabase.inventoryCount.count({ where }),
    ]);
    return {
      items: items.map(toInventoryCountListItem),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async findById(id: string): Promise<InventoryCountDetail | null> {
    const count = await this.countDatabase.inventoryCount.findUnique({
      where: { id },
      include: detailInclude,
    });
    return count ? toInventoryCountDetail(count) : null;
  }

  async create(actorUserId: string): Promise<InventoryCountDetail> {
    const warehouse = await ensureMainWarehouse(this.countDatabase);
    const variants = await this.countDatabase.productVariant.findMany({
      where: {
        isActive: true,
        product: {
          isActive: true,
          OR: [
            { catalogAuthority: "ACROPORA" },
            { unasSnapshot: { isPackageProduct: false } },
          ],
        },
      },
      select: {
        id: true,
        sku: true,
        unasReportedStock: true,
        unit: true,
        product: {
          select: {
            name: true,
            unasSnapshot: { select: { reportedStock: true } },
          },
        },
      },
      orderBy: { sku: "asc" },
    });
    // v1 scope: a single warehouse-wide stock pool (no per-location tracking
    // yet in the UI), so only the location/lot-less StockItem row is read.
    const stockItems = await this.countDatabase.stockItem.findMany({
      where: { warehouseId: warehouse.id, locationId: null, lotId: null },
      select: { variantId: true, onHand: true },
    });
    const onHandByVariant = new Map(
      stockItems.map((item) => [item.variantId, item.onHand]),
    );

    // The internal StockItem ledger only gets rows once a leltár correction
    // (or a future goods-receipt flow) has run for a variant. Until then,
    // the only "current quantity" this system actually knows is the UNAS
    // reported stock snapshot, so that's the fallback source here.
    const expectedQtyFor = (variant: (typeof variants)[number]) =>
      onHandByVariant.get(variant.id) ??
      variant.unasReportedStock ??
      variant.product.unasSnapshot?.reportedStock ??
      new Prisma.Decimal(0);

    /**
     * A LELTARSZAM UTKOZESE UJRAPROBALKOZAST KAP. Ket leltar akkor kap azonos
     * szamot, ha ugyanabban a masodpercben indul es a generator ugyanazt a
     * negyjegyu veget huzza. A burkolat CSAK ezt az egy irast ismetli meg, uj
     * kodddal; az elotte allo olvasas es szamitas kivul marad.
     */
    const created = await withUniqueCode(
      { prefix: "LELTAR", field: "countNumber" },
      (countNumber) =>
        this.countDatabase.inventoryCount.create({
          data: {
            countNumber,
            warehouseId: warehouse.id,
            startedById: actorUserId,
            lines: {
              create: variants.map((variant) => ({
                variantId: variant.id,
                expectedQty: expectedQtyFor(variant),
              })),
            },
          },
          include: detailInclude,
        }),
    );
    return toInventoryCountDetail(created);
  }

  async markUploaded(
    id: string,
    rows: { sku: string; countedQty: string }[],
  ): Promise<{ detail: InventoryCountDetail; unmatchedSkus: string[] }> {
    const current = await this.countDatabase.inventoryCount.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!current) throw new Error("A leltár nem található.");

    const lineBySku = new Map(
      current.lines.map((line) => [line.variant.sku.toLowerCase(), line]),
    );
    const unmatchedSkus: string[] = [];
    const updates: { lineId: string; countedQty: string }[] = [];
    for (const row of rows) {
      const line = lineBySku.get(row.sku.toLowerCase());
      if (!line) {
        unmatchedSkus.push(row.sku);
        continue;
      }
      updates.push({ lineId: line.id, countedQty: row.countedQty });
    }

    await this.countDatabase.$transaction(async (transaction) => {
      for (const update of updates) {
        await transaction.inventoryCountLine.update({
          where: { id: update.lineId },
          data: { countedQty: update.countedQty },
        });
      }
      await transaction.inventoryCount.update({
        where: { id },
        data: { status: "UPLOADED", uploadedAt: new Date() },
      });
    });

    const updated = await this.countDatabase.inventoryCount.findUnique({
      where: { id },
      include: detailInclude,
    });
    return { detail: toInventoryCountDetail(updated!), unmatchedSkus };
  }

  async updateLineCount(
    inventoryCountId: string,
    lineId: string,
    countedQty: string,
  ): Promise<InventoryCountDetail> {
    await this.countDatabase.inventoryCountLine.update({
      where: { id: lineId },
      data: { countedQty },
    });
    const updated = await this.countDatabase.inventoryCount.findUnique({
      where: { id: inventoryCountId },
      include: detailInclude,
    });
    return toInventoryCountDetail(updated!);
  }

  /// Egyetlen tranzakció: leltárállapot ellenőrzés, ADJUSTMENT-mozgás a
  /// közös postInventoryMovement-en át (StockMovement+StockMovementLine+
  /// StockItem+UnasStockSyncOutbox mind ugyanabban a DB tranzakcióban),
  /// baseline-only sorok, majd a leltár lezárása. A UNAS-push innentől nem
  /// itt, hanem a háttér-workerben történik (lásd
  /// unas-stock-sync-outbox.service.ts) - ez a metódus commit után visszatér,
  /// mielőtt a UNAS egyáltalán tudna a változásról.
  async applyCorrection(
    id: string,
    actorUserId: string,
  ): Promise<InventoryCountApplyResultRow> {
    const countBeforeApply = await this.countDatabase.inventoryCount.findUnique(
      {
        where: { id },
        include: detailInclude,
      },
    );
    if (!countBeforeApply) throw new Error("A leltár nem található.");
    const warehouseId = countBeforeApply.warehouseId;
    let successCount = 0;
    /**
     * A KORREKCIO SZAMA VISSZATERESI ERTEK, ezert nem eleg a tranzakciot
     * korbezarni: a kodot KI is kell vezetni a lezarbol. A lezar ezert a kodot
     * adja vissza, es a metodus onnan veszi.
     *
     * Ez a hely EZERT mas, mint a tobbi bekotes, es ezert kapott sajat commitot:
     * nem kifejezes-csere, hanem a metodus szerzodesenek erintese.
     */
    let movementNumber: string;

    try {
      movementNumber = await withUniqueCode(
        { prefix: "KORR", field: "movementNumber" },
        async (code) => {
          await this.countDatabase.$transaction(
            async (transaction) => {
              const lines = await transaction.inventoryCountLine.findMany({
                where: { inventoryCountId: id },
                include: {
                  variant: {
                    select: {
                      sku: true,
                      unit: true,
                      product: {
                        select: {
                          catalogAuthority: true,
                          unasSnapshot: {
                            select: { isPackageProduct: true },
                          },
                        },
                      },
                    },
                  },
                },
              });
              const inventoryLines = lines.filter(
                (line) => !line.variant.product.unasSnapshot?.isPackageProduct,
              );

              // A variant with no StockItem row yet had its expectedQty fall back
              // to the UNAS reported-stock snapshot at leltár-creation time (see
              // create() above), not a real local baseline. If the count happens
              // to match that fallback, the "difference" below is zero even
              // though this is the variant's very first real local count - so
              // "no numeric difference" must not be confused with "already
              // tracked locally", or the leltár would leave it permanently
              // showing as untracked (—) even after being physically counted.
              const existingStockItems = await transaction.stockItem.findMany({
                where: {
                  variantId: {
                    in: inventoryLines.map((line) => line.variantId),
                  },
                  warehouseId,
                  locationId: null,
                  lotId: null,
                },
                select: { variantId: true },
              });
              const trackedVariantIds = new Set(
                existingStockItems.map((item) => item.variantId),
              );

              const changedLines = inventoryLines.filter((line) => {
                if (line.countedQty === null) return false;
                return !line.countedQty.minus(line.expectedQty).isZero();
              });
              const baselineOnlyLines = inventoryLines.filter((line) => {
                if (line.countedQty === null) return false;
                if (trackedVariantIds.has(line.variantId)) return false;
                // Already covered as a real change above - avoid double-setting.
                return line.countedQty.minus(line.expectedQty).isZero();
              });

              // A changed line whose variant has no local StockItem row yet has
              // the exact same "expectedQty is only a UNAS-fallback snapshot,
              // never a real local baseline" problem as baselineOnlyLines above
              // (see that block's own comment) - postInventoryMovement always
              // computes the resulting onHand from the ACTUAL current StockItem
              // row (0 for a brand-new one, by its own documented contract,
              // correctly so for every other caller like a first purchase
              // receipt), never from this leltár's expectedQty snapshot. Without
              // this, a first-ever count of a previously-untracked variant would
              // silently compute onHand as `0 + (countedQty - expectedQty)`
              // instead of the true counted value - e.g. UNAS reports 10,
              // nothing tracked locally yet, physical count is 8, and onHand
              // would land on -2 instead of 8. Establishing the StockItem at the
              // assumed baseline first (same value, same lock, same
              // create-if-missing primitive as baselineOnlyLines) makes
              // postInventoryMovement's delta apply on top of that baseline
              // instead of on top of a phantom zero, while the movement's own
              // audit line still correctly reports the physical adjustment size
              // (abs(countedQty - expectedQty)), not the absolute counted value.
              for (const line of changedLines) {
                if (trackedVariantIds.has(line.variantId)) continue;
                await lockVariantWarehouse(
                  transaction,
                  line.variantId,
                  warehouseId,
                );
                await setStockItemQuantity(transaction, {
                  variantId: line.variantId,
                  warehouseId,
                  onHand: line.expectedQty,
                });
              }

              if (changedLines.length > 0) {
                const posted = await postInventoryMovement(transaction, {
                  idempotencyKey: `INVENTORY_COUNT:${id}`,
                  movementNumber,
                  type: "ADJUSTMENT",
                  warehouseId,
                  referenceType: "InventoryCount",
                  referenceId: id,
                  performedById: actorUserId,
                  sourceProcess: "INVENTORY_COUNT",
                  lines: changedLines.map((line) => ({
                    variantId: line.variantId,
                    sku: line.variant.sku,
                    unit: line.variant.unit,
                    quantityDelta: line.countedQty!.minus(line.expectedQty),
                    syncToUnas:
                      line.variant.product.catalogAuthority === "UNAS" &&
                      !line.variant.product.unasSnapshot?.isPackageProduct,
                  })),
                });
                // Should be rare (the service layer already guards against
                // re-applying a CORRECTED count), but two concurrent
                // applyCorrection calls for the same count - e.g. a double
                // click, or two admins closing it at once - could both pass
                // that check before either commits. postInventoryMovement's own
                // idempotency check (backed by StockMovement's unique
                // idempotencyKey) is what actually decides the race, and this
                // makes the loser's outcome an explicit, honest error instead of
                // silently reporting success with nothing actually re-posted.
                if (posted.alreadyPosted) {
                  throw new ConflictException(
                    "A leltár korrekciója közben egy másik feldolgozás már lekönyvelte ezt a leltárt.",
                  );
                }
              } else {
                // Nothing to adjust, but a movement record is still created for
                // this leltár-closing event (preserves the existing, exposed
                // "movementNumber is always returned" API contract) - there is
                // nothing to post to the shared writer (it requires >=1 line by
                // design, see inventory-movement-writer.ts), so this bypasses it
                // deliberately for this one, real "nothing changed" case.
                await transaction.stockMovement.create({
                  data: {
                    movementNumber,
                    type: "ADJUSTMENT",
                    status: "POSTED",
                    referenceType: "InventoryCount",
                    referenceId: id,
                    performedById: actorUserId,
                    occurredAt: new Date(),
                    postedAt: new Date(),
                  },
                });
              }

              for (const line of baselineOnlyLines) {
                // Establishing a first-ever StockItem baseline is not a real
                // stock movement (nothing to adjust, no outbox needed - UNAS
                // already reports this same value), but it still touches the
                // exact same (variantId, warehouseId) contention point the
                // writer protects, so it takes the same advisory lock before
                // writing, directly via setStockItemQuantity rather than through
                // postInventoryMovement (which would require treating a
                // zero-quantity "change" as a postable line).
                await lockVariantWarehouse(
                  transaction,
                  line.variantId,
                  warehouseId,
                );
                await setStockItemQuantity(transaction, {
                  variantId: line.variantId,
                  warehouseId,
                  onHand: line.countedQty!,
                });
              }

              const changedLineIds = new Set(
                changedLines.map((line) => line.id),
              );
              for (const line of lines) {
                const hasCount = line.countedQty !== null;
                const changed = changedLineIds.has(line.id);
                // "PENDING" for a real change - the local movement is
                // committed, but actual UNAS publication is now the outbox
                // worker's job and hasn't necessarily happened yet by the time
                // this transaction commits. syncStatus therefore no longer
                // claims a (possibly false) synchronous OK/FAILED outcome - see
                // docs/INVENTORY-CONSISTENCY.md.
                const syncStatus = !hasCount
                  ? "OK"
                  : changed
                    ? "PENDING"
                    : "OK";
                // Always "successful" at this synchronous layer - a real
                // failure throws and aborts the whole transaction instead of
                // producing a per-line FAILED status (see failedCount's doc
                // comment on InventoryCountApplyResultRow above).
                successCount += 1;
                await transaction.inventoryCountLine.update({
                  where: { id: line.id },
                  data: { syncStatus, syncError: null },
                });
              }

              await transaction.inventoryCount.update({
                where: { id },
                data: { status: "CORRECTED", correctedAt: new Date() },
              });
            },
            // Large leltárs can have thousands of lines, each needing its own
            // sequential read/write inside this transaction; Prisma's 5s default
            // interactive-transaction timeout is easily too short for that, so
            // it's raised here to give big corrections enough room to finish.
            // This also means the whole correction is all-or-nothing: either
            // every changed line is posted, baseline is established, and the
            // count is marked CORRECTED together, or (on any error, including a
            // timeout) none of it is - there is no partially-corrected leltár.
            { isolationLevel: "Serializable", timeout: 120_000 },
          );
          return code;
        },
      );
    } catch (error) {
      if (isDuplicateMovementIdempotencyKeyError(error)) {
        throw new ConflictException(
          "A leltár korrekciója közben egy másik feldolgozás már lekönyvelte ezt a leltárt.",
        );
      }
      throw error;
    }

    const updated = await this.countDatabase.inventoryCount.findUnique({
      where: { id },
      include: detailInclude,
    });
    return {
      detail: toInventoryCountDetail(updated!),
      movementNumber,
      successCount,
      failedCount: 0,
    };
  }
}
