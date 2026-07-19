export type HealthStatus = "ok" | "unavailable";

export interface DependencyHealth {
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
}

export interface HealthResponse {
  application: DependencyHealth & { version: string };
  database: DependencyHealth;
  redis: DependencyHealth;
  uptime: number;
  timestamp: string;
}

export interface NavigationItem {
  label: string;
  description: string;
}

export {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
} from "./auth.js";
export type {
  AuthenticatedUser,
  Permission,
  Session,
  UserRole,
} from "./auth.js";
export type {
  AcroporaDomainEvent,
  AquariumMeasurementRecorded,
  CustomerCreated,
  DomainEventEnvelope,
  GoodsReceived,
  IcpReportImported,
  ProductCreated,
  PurchaseOrderApproved,
  SalesOrderConfirmed,
  SalesOrderShipped,
  ServiceJobCompleted,
  StockMovementPosted,
} from "./domain-events.js";
export { IMPORT_ISSUE_SEVERITIES } from "./integrations/import-staging.js";
export type {
  ImportIssue,
  ImportIssueSeverity,
  ImportRowResult,
} from "./integrations/import-staging.js";
export { stageUnasProductRow } from "./integrations/unas.js";
export type {
  UnasCategoryImportRow,
  UnasProductImportRow,
} from "./integrations/unas.js";
export type {
  CatalogOption,
  ProductBrandSummary,
  ProductCategorySummary,
  ProductChannelListingSummary,
  ProductDetail,
  ProductImageSummary,
  ProductListApiQuery,
  ProductListItem,
  ProductListResponse,
  ProductType,
  ProductVariantSummary,
} from "./product-catalog.js";
