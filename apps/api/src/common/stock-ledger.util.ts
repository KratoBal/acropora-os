import { Prisma } from "@acropora/database";

/// Single source of truth for "what does this StockMovementType mean for
/// onHand, in which direction" - shared by the UNAS order-sync delta engine
/// (unas-order-sync.repository.ts's computeBookedOutAndGeneration, which is
/// scoped to SALE/RETURN_IN only) and the new stock-reconciliation module
/// (which has to reason about every movement type). Do NOT duplicate this
/// mapping anywhere else - if a new movement-producing flow is added, this
/// is the one place its sign needs registering.
///
/// IMPORTANT, and the central fact the whole reconciliation design rests on:
/// `StockMovementLine.quantity` is ALWAYS stored as an absolute value -
/// `postInventoryMovement` (inventory-movement-writer.ts) writes
/// `quantity: line.quantityDelta.abs()`. The actual signed effect on
/// `StockItem.onHand` therefore is NOT recoverable from the stored row
/// alone - it must be inferred from `StockMovement.type`, and that only
/// works for a movement type whose real-world sign is FIXED regardless of
/// the specific event (a SALE always removes stock, a PURCHASE_RECEIPT
/// always adds it, ...).
///
/// `ADJUSTMENT` is the one exception in active use: a leltár correction's
/// delta (`countedQty - expectedQty`, see inventory-count.repository.ts) can
/// legitimately be positive OR negative depending on whether the physical
/// count came in over or under the system's expectation, and BOTH cases are
/// stored identically - same `type: "ADJUSTMENT"`, same absolute `quantity`.
/// There is no way to tell them apart after the fact from the ledger alone.
/// This is a genuine, structural limitation of the current schema (not a
/// bug introduced by this checkpoint), and the reconciliation engine must
/// never pretend otherwise: any (variantId, warehouseId) pair with at least
/// one ADJUSTMENT movement is NOT ledger-provable by summation and must be
/// reported as such (see stock-reconciliation.service.ts's
/// INVALID_LEDGER_DATA status), not silently assigned a guessed sign.
///
/// TRANSFER, RESERVATION, RESERVATION_RELEASE, DAMAGE, SCRAP and
/// OPENING_BALANCE exist in the Prisma enum but - confirmed by a full-repo
/// search - have no producer anywhere in the current codebase (only
/// PURCHASE_RECEIPT, SALE, ADJUSTMENT and RETURN_IN are ever actually
/// created, by purchase-invoice.repository.ts, pos-sale.repository.ts /
/// unas-order-sync.repository.ts, inventory-count.repository.ts, and
/// pos-sale.repository.ts / unas-order-sync.repository.ts respectively).
/// DAMAGE/SCRAP/OPENING_BALANCE have an intuitively fixed sign and are
/// listed below for forward-compatibility (so wiring up a future producer
/// for them doesn't ALSO require touching the reconciliation engine), but
/// since nothing produces them yet there is no way to verify that
/// assumption against real data - RESERVATION/RESERVATION_RELEASE affect
/// `StockItem.reserved`, never `onHand`, so they are deliberately absent
/// (a movement of either type, if one ever existed, would be a data
/// integrity anomaly for onHand purposes, not a sign question). TRANSFER is
/// omitted entirely: `postInventoryMovement` only ever sets
/// `sourceWarehouseId` (never `targetWarehouseId`), so there is currently no
/// way to express "which warehouse gained the stock" even if a producer
/// existed - a TRANSFER row found in the ledger is unexplainable under the
/// current single-warehouse-per-movement model and must be flagged, not
/// guessed at.
export const LEDGER_PROVABLE_MOVEMENT_SIGN: Readonly<
  Partial<Record<string, 1 | -1>>
> = Object.freeze({
  PURCHASE_RECEIPT: 1,
  SALE: -1,
  RETURN_IN: 1,
  RETURN_OUT: -1,
  DAMAGE: -1,
  SCRAP: -1,
  OPENING_BALANCE: 1,
});

/// Movement types whose sign is NOT recoverable from the ledger alone (see
/// the module doc comment above) - currently just ADJUSTMENT. Kept as an
/// explicit set (rather than "anything not in LEDGER_PROVABLE_MOVEMENT_SIGN")
/// so an unrecognized future `StockMovementType` value is treated the same
/// (unprovable, flagged) without needing this file edited first - see
/// `classifyLedgerMovements` below.
export const SIGN_AMBIGUOUS_MOVEMENT_TYPES: ReadonlySet<string> = new Set([
  "ADJUSTMENT",
]);

export interface LedgerMovementLine {
  variantId: string;
  quantity: Prisma.Decimal;
}

export interface LedgerMovement {
  type: string;
  lines: readonly LedgerMovementLine[];
}

export interface LedgerClassification {
  /** Net signed quantity per variantId, summed only from movements whose
   * sign is provable (see LEDGER_PROVABLE_MOVEMENT_SIGN). Positive = more
   * on hand, matching StockItem.onHand's own convention - NOT bookedOut's
   * "positive = taken out" convention used by the UNAS order-delta engine,
   * since this function serves general reconciliation, not one order's
   * sales ledger. */
  provableNetByVariant: Map<string, Prisma.Decimal>;
  /** variantIds that had at least one sign-ambiguous (ADJUSTMENT) or
   * otherwise unrecognized-type movement - ledgerExpectedOnHand can never
   * be asserted for these, regardless of what provableNetByVariant says. */
  unprovableVariantIds: Set<string>;
}

/// Classifies a flat list of movements (across however many warehouses the
/// caller already filtered to - callers scope the query by warehouseId
/// themselves, e.g. via StockMovement.sourceWarehouseId) into a provable net
/// signed quantity per variant, plus the set of variants for which that net
/// can never be trusted as the WHOLE story because at least one movement's
/// direction can't be recovered. Pure and side-effect-free - no DB access -
/// so it's usable both by a live Prisma-backed repository and by a plain
/// unit test with hand-built fixtures.
export function classifyLedgerMovements(
  movements: readonly LedgerMovement[],
): LedgerClassification {
  const provableNetByVariant = new Map<string, Prisma.Decimal>();
  const unprovableVariantIds = new Set<string>();

  for (const movement of movements) {
    const sign = LEDGER_PROVABLE_MOVEMENT_SIGN[movement.type];
    const ambiguous =
      sign === undefined || SIGN_AMBIGUOUS_MOVEMENT_TYPES.has(movement.type);
    for (const line of movement.lines) {
      if (ambiguous) {
        unprovableVariantIds.add(line.variantId);
        continue;
      }
      const running =
        provableNetByVariant.get(line.variantId) ?? new Prisma.Decimal(0);
      provableNetByVariant.set(
        line.variantId,
        running.plus(line.quantity.times(sign)),
      );
    }
  }

  return { provableNetByVariant, unprovableVariantIds };
}

/// Shared per-(SalesOrder) booked-quantity summation - identical sign
/// convention to unas-order-sync.repository.ts's own
/// computeBookedOutAndGeneration (SALE = +1 "taken out", RETURN_IN = -1
/// "given back"), factored out here so the UNAS historical-order audit
/// (unas-order-stock-audit.service.ts) computes bookedOut with the EXACT
/// same rule the live delta engine uses, rather than a second,
/// independently-maintained copy of the same two-line switch.
export const ORDER_STOCK_MOVEMENT_SIGN: Readonly<
  Record<"SALE" | "RETURN_IN", 1 | -1>
> = Object.freeze({ SALE: 1, RETURN_IN: -1 });

export function sumOrderBookedOut(
  movements: readonly LedgerMovement[],
): Map<string, Prisma.Decimal> {
  const bookedOut = new Map<string, Prisma.Decimal>();
  for (const movement of movements) {
    const sign =
      ORDER_STOCK_MOVEMENT_SIGN[
        movement.type as keyof typeof ORDER_STOCK_MOVEMENT_SIGN
      ];
    if (sign === undefined) continue; // Defensive: this query is always pre-filtered to SALE/RETURN_IN.
    for (const line of movement.lines) {
      const running = bookedOut.get(line.variantId) ?? new Prisma.Decimal(0);
      bookedOut.set(line.variantId, running.plus(line.quantity.times(sign)));
    }
  }
  return bookedOut;
}
