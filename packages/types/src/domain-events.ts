export interface DomainEventEnvelope<
  TEventType extends string,
  TAggregateType extends string,
  TPayload,
> {
  eventId: string;
  eventType: TEventType;
  aggregateType: TAggregateType;
  aggregateId: string;
  occurredAt: string;
  actorUserId?: string;
  correlationId?: string;
  payload: TPayload;
  schemaVersion: number;
}

export type ProductCreated = DomainEventEnvelope<
  "product.created",
  "Product",
  { name: string; productType: "PHYSICAL" | "SERVICE" | "LIVESTOCK" }
>;

export type ProductUpdated = DomainEventEnvelope<
  "product.updated",
  "Product",
  { name: string; sku: string; source: "UNAS"; batchId: string }
>;

export type BrandCreated = DomainEventEnvelope<
  "brand.created",
  "Brand",
  { name: string }
>;
export type BrandUpdated = DomainEventEnvelope<
  "brand.updated",
  "Brand",
  { name: string; previousName: string }
>;
export type BrandArchived = DomainEventEnvelope<
  "brand.archived",
  "Brand",
  { name: string }
>;
export type BrandRestored = DomainEventEnvelope<
  "brand.restored",
  "Brand",
  { name: string }
>;
export type BrandAliasAdded = DomainEventEnvelope<
  "brand.alias-added",
  "Brand",
  { alias: string; source: string }
>;
export type BrandAliasRemoved = DomainEventEnvelope<
  "brand.alias-removed",
  "Brand",
  { alias: string }
>;

export type CatalogImportApplied = DomainEventEnvelope<
  "catalog-import.applied",
  "CatalogImportBatch",
  { provider: "UNAS"; productCount: number; categoryCount: number }
>;

export type StockMovementPosted = DomainEventEnvelope<
  "stock-movement.posted",
  "StockMovement",
  {
    movementNumber: string;
    movementType: string;
    lineCount: number;
  }
>;

export type PurchaseOrderApproved = DomainEventEnvelope<
  "purchase-order.approved",
  "PurchaseOrder",
  { orderNumber: string; supplierId: string }
>;

export type GoodsReceived = DomainEventEnvelope<
  "goods-receipt.posted",
  "GoodsReceipt",
  { receiptNumber: string; purchaseOrderId: string; stockMovementId: string }
>;

export type SalesOrderConfirmed = DomainEventEnvelope<
  "sales-order.confirmed",
  "SalesOrder",
  { orderNumber: string; channel: string }
>;

export type SalesOrderShipped = DomainEventEnvelope<
  "sales-order.shipped",
  "SalesOrder",
  { orderNumber: string; shipmentId: string }
>;

export type CustomerCreated = DomainEventEnvelope<
  "customer.created",
  "Customer",
  { customerNumber: string; customerType: "PERSON" | "COMPANY" }
>;

export type ServiceJobCompleted = DomainEventEnvelope<
  "service-job.completed",
  "ServiceJob",
  { jobNumber: string; completedAt: string }
>;

export type AquariumMeasurementRecorded = DomainEventEnvelope<
  "aquarium-measurement.recorded",
  "Aquarium",
  { measurementId: string; parameterCode: string; value: string; unit: string }
>;

export type IcpReportImported = DomainEventEnvelope<
  "icp-report.imported",
  "IcpReport",
  { reportNumber: string; laboratoryCode: string; resultCount: number }
>;

export type AcroporaDomainEvent =
  | ProductCreated
  | ProductUpdated
  | BrandCreated
  | BrandUpdated
  | BrandArchived
  | BrandRestored
  | BrandAliasAdded
  | BrandAliasRemoved
  | CatalogImportApplied
  | StockMovementPosted
  | PurchaseOrderApproved
  | GoodsReceived
  | SalesOrderConfirmed
  | SalesOrderShipped
  | CustomerCreated
  | ServiceJobCompleted
  | AquariumMeasurementRecorded
  | IcpReportImported;
