export type UnasOrderSyncRunStatus =
  "PENDING" | "RUNNING" | "APPLIED" | "FAILED";

export interface UnasOrderSyncRun {
  id: string;
  status: UnasOrderSyncRunStatus;
  windowStart: string | null;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  ordersSeen: number;
  createdCount: number;
  updatedCount: number;
  reversedCount: number;
  stockMismatchCount: number;
  errorCode: string | null;
}

export interface UnasOrderSyncSummary {
  runId: string;
  status: "APPLIED";
  ordersSeen: number;
  createdCount: number;
  updatedCount: number;
  reversedCount: number;
  stockMismatchCount: number;
  windowStart: string | null;
  windowEnd: string;
}

export interface UnasOrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  /** UNAS's own status text (e.g. "Kiszállítás", "Megrendelés lezárva"), for display; null for orders synced before this field existed. */
  unasStatusLabel: string | null;
  buyerName: string | null;
  paymentName: string | null;
  shippingName: string | null;
  totalGross: string;
  currency: string;
  lineCount: number;
  createdAt: string;
  orderedAt: string | null;
  /** Physical UNAS deletion marker. Takes display/filter precedence over the last mirrored UNAS status label. */
  unasDeletedAt: string | null;
}

export interface UnasOrderListResponse {
  items: UnasOrderListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface UnasOrderLineDetail {
  id: string;
  variantId: string | null;
  sku: string;
  description: string;
  quantity: string;
  unit: string;
  unitNet: string;
  taxRate: string;
  lineGross: string;
  syncStatus: "PENDING" | "OK" | "FAILED";
  syncError: string | null;
  /** Non-null when this historical line disappeared from a later UNAS order payload. */
  unasRemovedAt: string | null;
}

/**
 * One read-only UNAS invoice-mirror row for a SalesOrder - see the
 * `Invoice` Prisma model (source=UNAS) and
 * `UnasOrderSyncRepository.syncInvoiceMirror()`. Only the fields the
 * order-detail view needs, not a full Invoice representation - deliberately
 * excludes amounts/dates, which the UNAS getOrder API never provides for
 * its Invoice sub-object (see the Invoice.netAmount/vatAmount/grossAmount/
 * issueDate doc-comments in schema.prisma) and would otherwise have to be
 * faked as null everywhere they're rendered.
 */
export interface UnasOrderInvoiceSummary {
  id: string;
  /** Invoice.invoiceNumber - the human-readable number UNAS/Számlázz.hu assigned. */
  invoiceNumber: string;
  /** Invoice.externalUrl - UNAS/Számlázz.hu-hosted PDF link, if UNAS reported one. Null if UNAS gave a number but no URL (yet). */
  externalUrl: string | null;
  /** Invoice.syncStatus - whether this mirrored row was received/stored cleanly by our own sync, independent of anything UNAS-side. */
  syncStatus: "PENDING" | "RECEIVED" | "ERROR";
  createdAt: string;
}

export interface UnasOrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  /** UNAS's own status text (e.g. "Kiszállítás", "Megrendelés lezárva"), for display; null for orders synced before this field existed. */
  unasStatusLabel: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  paymentName: string | null;
  paymentStatus: string | null;
  shippingName: string | null;
  currency: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  orderedAt: string | null;
  createdAt: string;
  /**
   * SalesOrder.unasDeletedAt - non-null ONLY when this order was confirmed
   * PHYSICALLY DELETED from UNAS (via a targeted, single-order lookup that
   * returned NOT_FOUND - never inferred from a mere absence in an
   * incremental list/window response). Null for a normal, still-live order
   * AND for one that was properly sztornózott (cancelled) in UNAS itself -
   * `status === "CANCELLED"` alone does not distinguish the two; this
   * field is what does. The order row and its full history are never
   * deleted locally - see docs/INVENTORY-CONSISTENCY.md "UNAS-ból
   * fizikailag törölt rendelések".
   */
  unasDeletedAt: string | null;
  lines: UnasOrderLineDetail[];
  /**
   * SalesOrder.unasInvoiceStatus - the UNAS-side Invoice.Status (getOrder
   * API) last synced, read-only. Null = not yet synced, or the order has
   * no UNAS billing info at all (e.g. synced before this field existed).
   */
  unasInvoiceStatus: "NOT_BILLABLE" | "BILLABLE" | "BILLED" | null;
  /**
   * Read-only UNAS invoice-mirror rows for this order (see
   * UnasOrderInvoiceSummary). Empty array if UNAS hasn't reported a billed
   * invoice for this order yet - never null, so callers don't need a
   * separate "missing vs. empty" check.
   */
  invoices: UnasOrderInvoiceSummary[];
}

export interface UnasOrderStockPublishSummary {
  claimed: number;
  succeeded: number;
  superseded: number;
  retried: number;
  deadLettered: number;
}

/** Result of the explicit single-order refresh. The order shape remains
 * directly usable by existing detail consumers, while stockPublish reports
 * the exact-order outbox drain performed after the local transaction. */
export interface UnasOrderRefreshResult extends UnasOrderDetail {
  stockPublish: UnasOrderStockPublishSummary;
}

/// Egy SKU-szintű eltérés a helyi StockItem és a UNAS-on utoljára jelentett
/// reportedStock között. Nem hív külön UNAS API-t: a termék-szinkron job
/// által már úgyis frissen tartott UnasProductSnapshot.reportedStock-ot
/// veti össze a helyi készlettel.
export interface StockReconciliationMismatch {
  variantId: string;
  sku: string;
  productName: string;
  localOnHand: string;
  unasReportedStock: string;
  difference: string;
  reportedStockSyncedAt: string | null;
}

export interface StockReconciliationReport {
  checkedAt: string;
  checkedCount: number;
  mismatches: StockReconciliationMismatch[];
}
