import { Prisma } from "@acropora/database";

import { isPrismaUniqueConstraintViolation } from "./prisma-error.util.js";

/// True for a Prisma unique-constraint violation on `StockMovement`'s
/// idempotency key - i.e. two concurrent callers raced past this module's
/// own `stockMovement.findFirst` idempotency check (both saw "not posted
/// yet") and both tried to insert the same key; the database's unique
/// index is the actual, final guarantee, this check is only there so
/// callers can translate the resulting P2002 into a clear domain error
/// (e.g. a 409 Conflict) instead of an opaque 500. See each flow's
/// repository (inventory-count/purchase-invoice/pos-sale) for where this
/// is caught.
///
/// Uses the structural (non-`instanceof`) check from prisma-error.util.ts -
/// see that file's doc comment for why `instanceof
/// Prisma.PrismaClientKnownRequestError` can't be relied on to narrow
/// `error` in this environment.
export function isDuplicateMovementIdempotencyKeyError(
  error: unknown,
): boolean {
  return isPrismaUniqueConstraintViolation(error, "idempotencyKey");
}

/// Central, transaction-scoped inventory posting primitive.
///
/// Every stock-affecting flow (leltár korrekció, beszerzési bevételezés,
/// POS eladás, UNAS webshoprendelés import/módosítás/sztornó,
/// reconciliation-javítás) MUST post its stock changes through this single
/// function, called from *inside* the caller's own Prisma `$transaction`
/// callback (the caller is responsible for opening/committing that
/// transaction - this function never opens its own). In one call it:
///
///  1. checks `idempotencyKey` against `StockMovement` - a repeat call with
///     the same key (e.g. a retried HTTP request, or a UNAS poll that saw
///     the same order twice) is a no-op, never double-counted;
///  2. creates one `StockMovement` + one `StockMovementLine` per input line;
///  3. atomically applies each line's signed `quantityDelta` to the
///     relevant `StockItem.onHand`, serialized per (variantId, warehouseId)
///     via a Postgres transaction-scoped advisory lock - see
///     `lockVariantWarehouse` below for why this (rather than
///     `Serializable` isolation or `SELECT ... FOR UPDATE`) closes both the
///     classic lost-update race *and* the rarer duplicate-StockItem-row
///     bootstrap race;
///  4. for lines whose Product Master is UNAS (`syncToUnas=true`), creates
///     one `UnasStockSyncOutbox` row in the SAME transaction, carrying the
///     freshly-computed ABSOLUTE resulting onHand - never a delta - so a
///     background worker can publish it to UNAS later. Local
///     Acropora-catalog products MUST pass false and never enter the UNAS
///     outbox. Callers have to provide this flag explicitly, so adding a
///     new stock-writing flow cannot silently inherit the wrong behavior.
///
/// See docs/INVENTORY-CONSISTENCY.md for the full design
/// rationale and how each of the four (soon five) channels calls this.
export type InventoryMovementSourceProcess =
  | "INVENTORY_COUNT"
  | "PURCHASE_INVOICE"
  | "POS_SALE"
  | "UNAS_ORDER_IMPORT"
  | "UNAS_ORDER_UPDATE"
  | "UNAS_ORDER_CANCEL"
  | "RECONCILIATION";

export type InventoryMovementType =
  | "PURCHASE_RECEIPT"
  | "SALE"
  | "TRANSFER"
  | "ADJUSTMENT"
  | "RESERVATION"
  | "RESERVATION_RELEASE"
  | "RETURN_IN"
  | "RETURN_OUT"
  | "DAMAGE"
  | "SCRAP"
  | "OPENING_BALANCE";

const OUTBOX_SUPERSEDABLE_STATUSES = [
  "PENDING",
  "FAILED",
  "DEAD_LETTER",
] as const;

export interface InventoryMovementLineInput {
  variantId: string;
  /** UNAS SKU, denormalized here so the outbox worker never has to look
   * the variant back up just to publish stock (and keeps working even if
   * the variant is later renamed/deleted before the row drains). */
  sku: string;
  /** Signed quantity change: negative decreases onHand (SALE, ...),
   * positive increases it (PURCHASE_RECEIPT, RETURN_IN, ...). Never an
   * absolute "resulting quantity" - the resulting absolute onHand is
   * always computed inside this function, under lock, from the current
   * value at posting time. */
  quantityDelta: Prisma.Decimal;
  unit: string;
  /** True only when the variant's catalogAuthority is UNAS. */
  syncToUnas: boolean;
  sourceLocationId?: string | null;
  targetLocationId?: string | null;
  lotId?: string | null;
  serialNumberId?: string | null;
}

export interface PostInventoryMovementInput {
  /** Unique per business event (e.g. `POS_SALE:<orderNumber>`,
   * `UNAS_ORDER_IMPORT:<unasOrderKey>`). Required - callers must derive a
   * stable key from the source record, not generate a random one, or
   * idempotency is defeated. */
  idempotencyKey: string;
  movementNumber: string;
  type: InventoryMovementType;
  warehouseId: string;
  referenceType: string;
  referenceId: string;
  performedById?: string | null;
  occurredAt?: Date;
  note?: string | null;
  sourceProcess: InventoryMovementSourceProcess;
  lines: InventoryMovementLineInput[];
}

export interface PostedInventoryMovementLine {
  variantId: string;
  sku: string;
  /** Absolute on-hand quantity after this line was applied. */
  resultingOnHand: Prisma.Decimal;
  /** True when resultingOnHand < 0. Never blocks the posting (negative
   * stock is an allowed, warned-about business state for POS - see
   * docs/INVENTORY-CONSISTENCY.md, "Negatív készlet"). */
  wentNegative: boolean;
}

export interface PostInventoryMovementResult {
  movementId: string;
  /** True when idempotencyKey matched an already-posted StockMovement -
   * nothing new was written, `lines` is empty. Callers that need the
   * current quantities after a detected replay should re-read StockItem
   * themselves; a replay is defined as a pure no-op at the ledger level. */
  alreadyPosted: boolean;
  lines: PostedInventoryMovementLine[];
}

interface StockItemRow {
  id: string;
  onHand: Prisma.Decimal;
  reserved?: Prisma.Decimal;
}

export interface InventoryMovementDatabase {
  $executeRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
  stockMovement: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
  stockMovementLine: {
    create(args: unknown): Promise<unknown>;
  };
  stockItem: {
    findFirst(args: unknown): Promise<StockItemRow | null>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
  unasStockSyncOutbox: {
    updateMany(args: unknown): Promise<{ count: number }>;
    create(args: unknown): Promise<{ id: string }>;
  };
}

/// Serializes every posting that touches the same (variantId, warehouseId)
/// stock pool, whether or not a StockItem row exists for it yet, using a
/// Postgres transaction-scoped advisory lock keyed by a hash of the pair.
/// The lock is acquired for the remainder of the CURRENT transaction only
/// and is released automatically at commit or rollback - no explicit
/// unlock call, no risk of leaking it across requests.
///
/// Why this instead of `Serializable` isolation or `SELECT ... FOR
/// UPDATE`: `StockItem`'s uniqueness key is `(variantId, warehouseId,
/// locationId, lotId)`, and Postgres does not treat two NULL
/// locationId/lotId rows as conflicting (see stock-item-writer.ts) - so
/// `SELECT ... FOR UPDATE` can't lock a row that doesn't exist yet, and
/// two concurrent *first-ever* movements for the same variant could each
/// still create their own duplicate StockItem row even under
/// `Serializable`, unless every writer also takes out this same advisory
/// lock before its first `stockItem.findFirst`. Using the advisory lock as
/// the sole serialization point covers both the "row exists, don't lose an
/// update" case and the "row doesn't exist yet, don't create it twice"
/// case with one mechanism.
export async function lockVariantWarehouse(
  database: Pick<InventoryMovementDatabase, "$executeRaw">,
  variantId: string,
  warehouseId: string,
): Promise<void> {
  const key = `${variantId}:${warehouseId}`;
  await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export function buildOutboxIdempotencyKey(
  movementIdempotencyKey: string,
  variantId: string,
): string {
  return `${movementIdempotencyKey}:${variantId}`;
}

/// Shared "close out any still-open older publish target, then enqueue the
/// new one" step - extracted out of postInventoryMovement's own per-line
/// loop (below) so the checkpoint-6 reconciliation-repair service
/// (stock-reconciliation-repair.service.ts) can enqueue an outbox entry
/// through the EXACT same supersede contract without going through
/// postInventoryMovement itself. This matters because a repair's StockItem
/// correction (LOCAL_FROM_PROVEN_LEDGER) or UNAS republish
/// (REPUBLISH_LOCAL_TO_UNAS) must NEVER create a StockMovement - see each
/// repair type's own doc comment for why a data-integrity correction back
/// to what the ledger already says was true is not a new physical stock
/// event. Callers MUST already hold lockVariantWarehouse for
/// (variantId, warehouseId) before calling this, exactly like
/// postInventoryMovement's own loop does.
export async function enqueueStockSyncOutboxEntry(
  database: Pick<InventoryMovementDatabase, "unasStockSyncOutbox">,
  params: {
    variantId: string;
    warehouseId: string;
    sku: string;
    targetOnHand: Prisma.Decimal;
    idempotencyKey: string;
    sourceProcess: InventoryMovementSourceProcess;
    sourceRecordId: string;
  },
): Promise<{ id: string }> {
  await database.unasStockSyncOutbox.updateMany({
    where: {
      variantId: params.variantId,
      warehouseId: params.warehouseId,
      status: { in: [...OUTBOX_SUPERSEDABLE_STATUSES] },
    },
    data: {
      status: "SUCCEEDED",
      resolutionNote: `superseded_by:${params.idempotencyKey}`,
      processedAt: new Date(),
    },
  });
  return database.unasStockSyncOutbox.create({
    data: {
      variantId: params.variantId,
      warehouseId: params.warehouseId,
      sku: params.sku,
      targetOnHand: params.targetOnHand,
      idempotencyKey: params.idempotencyKey,
      sourceProcess: params.sourceProcess,
      sourceRecordId: params.sourceRecordId,
    },
  });
}

export async function postInventoryMovement(
  database: InventoryMovementDatabase,
  input: PostInventoryMovementInput,
): Promise<PostInventoryMovementResult> {
  if (input.lines.length === 0) {
    throw new Error(
      "postInventoryMovement requires at least one line to post.",
    );
  }

  const existingMovement = await database.stockMovement.findFirst({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existingMovement) {
    return { movementId: existingMovement.id, alreadyPosted: true, lines: [] };
  }

  const occurredAt = input.occurredAt ?? new Date();
  const movement = await database.stockMovement.create({
    data: {
      movementNumber: input.movementNumber,
      type: input.type,
      status: "POSTED",
      sourceWarehouseId: input.warehouseId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      note: input.note ?? null,
      performedById: input.performedById ?? null,
      occurredAt,
      postedAt: occurredAt,
    },
    select: { id: true },
  });

  const resultLines: PostedInventoryMovementLine[] = [];

  // Deterministic lock acquisition order: two concurrent multi-line
  // postings that touch an overlapping set of variants (e.g. two large
  // purchase invoices sharing a few SKUs) must always lock those SKUs in
  // the same relative order, or they can deadlock (A locks variant-1 then
  // waits on variant-2, while B locks variant-2 then waits on variant-1).
  // Sorting by variantId here - rather than trusting whatever order the
  // caller's cart/spreadsheet/invoice happened to list lines in - is a
  // stable sort (JS `Array.prototype.sort` is guaranteed stable), so
  // multiple lines for the *same* variant (e.g. two purchase-invoice lines
  // for one SKU at different prices) keep their original relative order,
  // which matters: each such line's delta is applied sequentially, so the
  // second line's resulting quantity correctly builds on the first's.
  const orderedLines = [...input.lines].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  );

  for (const line of orderedLines) {
    await lockVariantWarehouse(database, line.variantId, input.warehouseId);

    await database.stockMovementLine.create({
      data: {
        movementId: movement.id,
        variantId: line.variantId,
        quantity: line.quantityDelta.abs(),
        unit: line.unit,
        sourceLocationId: line.sourceLocationId ?? null,
        targetLocationId: line.targetLocationId ?? null,
        lotId: line.lotId ?? null,
        serialNumberId: line.serialNumberId ?? null,
      },
    });

    const existingStockItem = await database.stockItem.findFirst({
      where: {
        variantId: line.variantId,
        warehouseId: input.warehouseId,
        locationId: null,
        lotId: null,
      },
      select: { id: true, onHand: true, reserved: true },
    });
    const currentOnHand = existingStockItem?.onHand ?? new Prisma.Decimal(0);
    const currentReserved =
      existingStockItem?.reserved ?? new Prisma.Decimal(0);
    const resultingOnHand = currentOnHand.plus(line.quantityDelta);

    if (existingStockItem) {
      await database.stockItem.update({
        where: { id: existingStockItem.id },
        data: { onHand: resultingOnHand },
      });
    } else {
      await database.stockItem.create({
        data: {
          variantId: line.variantId,
          warehouseId: input.warehouseId,
          onHand: resultingOnHand,
        },
      });
    }

    resultLines.push({
      variantId: line.variantId,
      sku: line.sku,
      resultingOnHand,
      wentNegative: resultingOnHand.isNegative(),
    });

    if (line.syncToUnas) {
      // Close out any still-open earlier publish target for this exact
      // (variant, warehouse) before inserting the new one, so the worker
      // never sees two competing PENDING/FAILED/DEAD_LETTER rows for the
      // same key. Local catalog products deliberately skip this block.
      await enqueueStockSyncOutboxEntry(database, {
        variantId: line.variantId,
        warehouseId: input.warehouseId,
        sku: line.sku,
        // UNAS only receives stock that is free to sell. Project-reserved
        // quantity remains physically on hand but is excluded here.
        targetOnHand: resultingOnHand.minus(currentReserved),
        idempotencyKey: buildOutboxIdempotencyKey(
          input.idempotencyKey,
          line.variantId,
        ),
        sourceProcess: input.sourceProcess,
        sourceRecordId: input.referenceId,
      });
    }
  }

  return { movementId: movement.id, alreadyPosted: false, lines: resultLines };
}
