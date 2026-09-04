export { personDisplayName, personLegalName } from "./person-name.js";
export { serviceJobTimeline } from "./service-job-management.js";
export type {
  ServiceJobAssetLink,
  ServiceJobDetail,
  ServiceJobListItem,
  ServiceJobListResponse,
  ServiceJobPartnerStatus,
  ServiceJobStatusEvent,
  ServiceJobStatusValue,
  ServiceJobTimelineEntry,
  ServiceJobWorksheetLink,
} from "./service-job-management.js";
export type { NamedPerson } from "./person-name.js";

export type HealthStatus = "ok" | "unavailable";

export interface DependencyHealth {
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
}

export interface HealthResponse {
  /**
   * A FUTO KIADAS AZONOSSAGA.
   *
   * A `version` egy kezzel irt karakterlanc, ami minden kiadasnal ugyanaz marad
   * (`0.1.0`), tehat arra a kerdesre, hogy MELYIK kod fut a szerveren, nem
   * valaszol. A `commit` igen: a kepbe beegetett kiadas-azonosito.
   *
   * `null`, ha nincs beallitva vagy nem ep a formaja -- es ez SZANDEKOS: a
   * hianyzo adat ne latszon adatnak. Aki ezt olvassa, a `null`-t ugy kell
   * ertelmezze, hogy a kiadas azonossaga NEM ellenorizheto, nem ugy, hogy
   * barmelyik kiadas megfelel.
   */
  application: DependencyHealth & { version: string; commit: string | null };
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
  HUMAN_ROLES,
  isMachineRole,
  MACHINE_ROLES,
  partnerMembership,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
} from "./auth.js";
export {
  isNavigationEntryVisible,
  navigationEntry,
  navigationIdsFor,
  NAVIGATION_ENTRIES,
  visibleNavigationFor,
} from "./navigation.js";
export type {
  NavigationEntry,
  NavigationEntryView,
  NavigationSurface,
  NavigationVisibility,
} from "./navigation.js";
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
  CurrentUserResponse,
  MachineRole,
  PartnerMembership,
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
  AssetDeletionBlockers,
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
export type { AssetLabel, AssetLabelIssueResult } from "./asset-label.js";
export type { AssetLabelBatchSummary } from "./asset-label-batch.js";
export {
  ASSET_LABEL_BATCH_MAX,
  ASSET_LABEL_BATCH_MIN,
  assetLabelCsv,
  randomAssetLabelCode,
} from "./asset-label-batch.js";
export {
  ASSET_LABEL_CODE_STORED_PATTERN,
  ASSET_LABEL_REQUIRED_ON_CREATE,
  assetLabelCreateProblem,
  normalizeAssetLabelCode,
} from "./asset-label.js";
export type {
  ContentChannel,
  ContentComment,
  ContentDetail,
  ContentListItem,
  ContentListResponse,
  ContentMoveOption,
  ContentState,
  ContentViewerRole,
  ContentWaitingOnMeResponse,
} from "./content-management.js";
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
  PartnerDeletionPlan,
  PartnerReferenceSummary,
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
  StockItemReconciliationPage,
  StockItemReconciliationRow,
  StockItemReconciliationStatus,
  StockItemReconciliationSummary,
} from "./inventory/stock-item-reconciliation.js";
export type {
  StockReconciliationMismatch,
  StockReconciliationReport,
  UnasOrderDeletionReconciliationStatus,
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
  MedusaConnectionCredentialInput,
  MedusaConnectionStateView,
  MedusaConnectionVerificationStatus,
  MedusaConnectionView,
  MedusaCredentialSource,
  MedusaIntegrationStateKind,
} from "./integrations/medusa-connection.js";
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
export {
  AI_ACCURACY_RATINGS,
  AI_LANGUAGE_RATINGS,
  AI_RATING_AXES,
  AI_RATINGS_BY_AXIS,
} from "./integrations/ai-chat.js";
export type {
  AiAccuracyRating,
  AiAnswerRating,
  AiAnswerRatingResult,
  AiLanguageRating,
  AiRatingAxis,
} from "./integrations/ai-chat.js";
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
  ProductUpdateInput,
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
  UpdateWorksheetDepartmentInput,
  CreateWorksheetInput,
  SetWorksheetAssigneesInput,
  SignWorksheetVersionInput,
  UpdateWorksheetDraftInput,
  WorksheetAssignableUser,
  WorksheetAssignableUserListResponse,
  WorksheetAssignee,
  WorksheetContentInput,
  WorksheetCustomerSummary,
  WorksheetDepartmentListResponse,
  WorksheetDepartmentSummary,
  WorksheetAttachableItem,
  WorksheetAttachableListResponse,
  WorksheetDetail,
  WorksheetEntryDetail,
  WorksheetEntryListResponse,
  WorksheetFieldChange,
  WorksheetLineDetail,
  WorksheetLineInput,
  WorksheetListItem,
  WorksheetListResponse,
  WorksheetChainLink,
  WorksheetSelectablePartner,
  WorksheetSelectablePartnerListResponse,
  WorksheetNumberParts,
  WorksheetSignatureDecision,
  WorksheetSignatureDetail,
  WorksheetVersionDetail,
  WorksheetVersionDiff,
  WorksheetVersionStatus,
  WorksheetVersionSummary,
} from "./worksheet-management.js";
