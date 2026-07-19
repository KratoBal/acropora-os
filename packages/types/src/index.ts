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
  BrandAlias,
  BrandAliasInput,
  BrandDetail,
  BrandExternalMapping,
  BrandListResponse,
  BrandMutationResponse,
  BrandStatusFilter,
  BrandSummary,
  BrandUsage,
  CreateBrandInput,
  UpdateBrandInput,
} from "./brand-management.js";
export type {
  AuthenticatedUser,
  Permission,
  Session,
  UserRole,
} from "./auth.js";
export type {
  AcroporaDomainEvent,
  CatalogImportApplied,
  AquariumMeasurementRecorded,
  BrandAliasAdded,
  BrandAliasRemoved,
  BrandArchived,
  BrandCreated,
  BrandRestored,
  BrandUpdated,
  CustomerCreated,
  DomainEventEnvelope,
  GoodsReceived,
  IcpReportImported,
  ProductCreated,
  ProductUpdated,
  PurchaseOrderApproved,
  SalesOrderConfirmed,
  SalesOrderShipped,
  ServiceJobCompleted,
  StockMovementPosted,
} from "./domain-events.js";
export { IMPORT_ISSUE_SEVERITIES } from "./integrations/import-staging.js";
export type {
  BrandResolutionCandidate,
  BrandResolutionEvidence,
  BrandResolutionResult,
  BrandResolutionReviewItem,
  BrandResolutionSource,
  BrandResolutionStatus,
  BrandResolutionSummary,
  BrandReviewBulkDecisionInput,
  BrandReviewConfidence,
  BrandReviewDecision,
  BrandReviewDecisionInput,
  BrandReviewDecisionStatus,
  BrandReviewListItem,
  BrandReviewListResponse,
  BrandReviewReason,
  BrandReviewSourceFacts,
  BrandReviewSummary,
} from "./integrations/brand-resolution.js";
export type {
  UnasApplySummary,
  UnasApprovalResult,
} from "./integrations/unas-apply.js";
export type {
  ImportIssue,
  ImportIssueSeverity,
  ImportRowResult,
} from "./integrations/import-staging.js";
export { stageUnasProductRow } from "./integrations/unas.js";
export type {
  CatalogDiffField,
  CatalogFieldDiff,
  UnasImportReport,
  UnasImportSummary,
  UnasParsedWorkbook,
  UnasProductDryRunRow,
} from "./integrations/unas-import-report.js";
export type {
  UnasBrandImportRow,
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
