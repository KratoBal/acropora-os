export { personDisplayName, personLegalName } from "./person-name.js";
export type { NamedPerson } from "./person-name.js";

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
  BrandImportAssistantResponse,
  BrandImportBatchOption,
  BrandImportAssistantRow,
  BrandImportAssistantSummary,
  BrandImportClassification,
  BrandImportExample,
  BrandImportMutationResult,
  BulkCreateBrandsInput,
  BulkBrandCreateResponse,
  BulkBrandCreateResult,
  BulkBrandCreateStatus,
  CreateBrandFromImportInput,
  MapBrandAliasInput,
  MapBrandExternalInput,
} from "./brand-import-assistant.js";
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
  AssetAddressSummary,
  AssetAquariumSummary,
  AssetCriticality,
  AssetCustomerSummary,
  AssetDetail,
  AssetDocumentSummary,
  AssetDocumentType,
  AssetEventSummary,
  AssetEventType,
  AssetHierarchyItem,
  AssetKind,
  AssetListItem,
  AssetListResponse,
  AssetOwnerListResponse,
  AssetOwnerOption,
  AssetOwnerSummary,
  AssetOwnerType,
  AssetProductSummary,
  AssetQrCode,
  AssetStatus,
  CreateAssetInput,
  UpdateAssetInput,
} from "./asset-management.js";
export type {
  CreateCustomerAddressInput,
  CreateCustomerInput,
  CustomerAddress,
  CustomerAddressType,
  CustomerDetail,
  CustomerListResponse,
  CustomerSource,
  CustomerStatusFilter,
  CustomerSummary,
  CustomerType,
  UpdateCustomerInput,
} from "./customer-management.js";
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
export type {
  ProductExtensionDetail,
  ProductExtensionUpdateInput,
} from "./product-extension.js";
export type {
  CreateSupplierInput,
  SupplierListResponse,
  SupplierSummary,
  UpdateSupplierInput,
} from "./supplier-management.js";
export type {
  CreatePurchaseInvoiceInput,
  CreatePurchaseInvoiceLineInput,
  CreateProjectInput,
  ExchangeRateLookupResult,
  ProjectOption,
  ProjectStatus,
  PurchaseInvoiceDetail,
  PurchaseInvoiceLineDetail,
  PurchaseInvoiceLineProjectAllocation,
  PurchaseInvoiceLineSyncStatus,
  PurchaseInvoiceListResponse,
  PurchaseInvoiceResult,
  PurchaseInvoiceSource,
  PurchaseInvoiceStatus,
  PurchaseInvoiceSummary,
  PurchaseProductSearchResult,
} from "./purchasing.js";
export type {
  CreatePosSaleInput,
  CreatePosSaleLineInput,
  PosPaymentMethod,
  PosProductSearchResult,
  PosSaleDetail,
  PosSaleLineDetail,
  PosSaleListItem,
  PosSaleListResponse,
  PosSaleResult,
  PosSaleStockWarning,
  SalesOrderLineSyncStatus,
} from "./pos.js";
export type {
  InventoryCountApplyResult,
  InventoryCountDetail,
  InventoryCountLineDetail,
  InventoryCountLineSyncStatus,
  InventoryCountListItem,
  InventoryCountListResponse,
  InventoryCountStatus,
  InventoryCountUploadResult,
} from "./inventory-count.js";
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
  CanonicalUnasProduct,
  UnasApiCategory,
  UnasApiCustomer,
  UnasApiCustomerAddress,
  UnasApiOrder,
  UnasApiOrderItem,
  UnasApiProduct,
  UnasApiStock,
  UnasApiVariantStock,
  UnasPackageComponent,
  UnasVariantValue,
  UnasProductIdentitySnapshot,
  UnasProductSyncAction,
  UnasProductSyncDiff,
} from "./integrations/unas-api.js";
export type {
  UnasCustomerSyncRun,
  UnasCustomerSyncRunStatus,
  UnasCustomerSyncSummary,
} from "./integrations/unas-customer-sync.js";
export type {
  StockReconciliationMismatch,
  StockReconciliationReport,
  UnasOrderDetail,
  UnasOrderInvoiceSummary,
  UnasOrderLineDetail,
  UnasOrderListItem,
  UnasOrderListResponse,
  UnasOrderRefreshResult,
  UnasOrderStockPublishSummary,
  UnasOrderSyncRun,
  UnasOrderSyncRunStatus,
  UnasOrderSyncSummary,
} from "./integrations/unas-order-sync.js";
export type {
  UnasProductSyncKind,
  UnasProductSyncRun,
  UnasProductSyncRunStatus,
  UnasProductSyncSummary,
} from "./integrations/unas-product-sync.js";
export type {
  UnasConnectionVerificationStatus,
  UnasConnectionView,
} from "./integrations/unas-connection.js";
export type {
  NavTaxpayerAddress,
  NavTaxpayerLookupResult,
} from "./integrations/nav-taxpayer.js";
export type {
  NavConnectionCredentialInput,
  NavConnectionVerificationStatus,
  NavConnectionView,
} from "./integrations/nav-connection.js";
export type {
  NavIncomingInvoiceAddress,
  NavIncomingInvoiceDetail,
  NavIncomingInvoiceLine,
  NavIncomingInvoiceListResponse,
  NavIncomingInvoiceStatus,
  NavIncomingInvoiceSummary,
  NavInvoiceSyncRun,
  NavInvoiceSyncRunStatus,
  NavInvoiceSyncSummary,
} from "./integrations/nav-incoming-invoice.js";
export type {
  FoxpostManualApprovalInput,
  FoxpostManualApprovalResult,
  FoxpostMonthlyReportSummary,
  FoxpostReprocessResult,
  FoxpostResolutionSource,
  FoxpostSettlementDetail,
  FoxpostSettlementLine,
  FoxpostSettlementLineStatus,
  FoxpostSettlementListResponse,
  FoxpostSettlementStatus,
  FoxpostSettlementSummary,
  FoxpostSyncSummary,
} from "./integrations/foxpost-settlement.js";
export type { PostalCodeLookupResult } from "./integrations/postal-code.js";
export type { ViesVatLookupResult } from "./integrations/vies-vat.js";
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
  AddProductBarcodeInput,
  CatalogOption,
  ProductBarcodeListResponse,
  ProductBarcodeSummary,
  ProductBrandSummary,
  ProductCategorySummary,
  ProductChannelListingSummary,
  ProductDetail,
  ProductImageSummary,
  ProductListApiQuery,
  ProductListItem,
  ProductOrigin,
  ProductCatalogAuthority,
  UnasProductMirrorDetail,
  ProductListResponse,
  ProductType,
  ProductVariantSummary,
} from "./product-catalog.js";
export type {
  CreateTaskInput,
  TaskAssigneeOptionsResponse,
  TaskIngestInput,
  TaskIngestResult,
  TaskListResponse,
  TaskPersonSummary,
  TaskSource,
  TaskStatus,
  TaskStatusFilter,
  TaskSummary,
} from "./task-management.js";
export type {
  CreateUserInput,
  SetUserPasswordInput,
  UpdateUserInput,
  UserDetail,
  UserListResponse,
  UserStatusFilter,
  UserSummary,
} from "./user-management.js";
export {
  formatWorksheetNumber,
  formatWorksheetSequence,
  formatWorksheetVersionLabel,
  WORKSHEET_DEPARTMENT_CODE_PATTERN,
  WORKSHEET_PARTNER_CODE_PATTERN,
  WORKSHEET_SEQUENCE_MIN_DIGITS,
} from "./worksheet-management.js";
export type {
  AmendWorksheetInput,
  CreateWorksheetDepartmentInput,
  CreateWorksheetInput,
  SignWorksheetVersionInput,
  UpdateWorksheetDraftInput,
  WorksheetContentInput,
  WorksheetCustomerSummary,
  WorksheetDepartmentListResponse,
  WorksheetDepartmentSummary,
  WorksheetDetail,
  WorksheetFieldChange,
  WorksheetLineDetail,
  WorksheetLineInput,
  WorksheetListItem,
  WorksheetListResponse,
  WorksheetNumberParts,
  WorksheetSignatureDecision,
  WorksheetSignatureDetail,
  WorksheetVersionDetail,
  WorksheetVersionDiff,
  WorksheetVersionStatus,
  WorksheetVersionSummary,
} from "./worksheet-management.js";
