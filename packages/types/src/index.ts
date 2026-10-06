export { magyarSzamErteke } from "./magyar-szam.js";
export { SEARCH_GROUPS } from "./search.js";
export type {
  SearchGroup,
  SearchResponse,
  SearchResultItem,
} from "./search.js";
export { munkaoraEgysegFigyelmeztetes } from "./munkaora-egyseg.js";
export {
  personDisplayName,
  personGivenName,
  personLegalName,
} from "./person-name.js";
export {
  DOCUMENT_THUMBNAIL_VARIANT,
  DOCUMENT_VARIANT_PARAM,
} from "./document-variant.js";
export {
  ALL_SERVICE_JOB_STATUS_VALUES,
  SERVICE_JOB_FINISHED_STATUSES,
  isFinishedServiceJob,
  PARTNER_STATUS_LABELS,
  partnerStatusLabel,
  partnerStatusTone,
  isPartnerServiceJobDetail,
  partnerServiceJobDetail,
  partnerServiceJobListItem,
  partnerVisibleStatus,
  serviceJobTimeline,
  serviceJobWorksheetLabel,
} from "./service-job-management.js";
export {
  BILLING_DOCUMENT_STATUSES,
  BILLING_DOCUMENT_TYPES,
  BILLING_EMAIL_STATUSES,
  BILLING_SOURCE_TYPES,
  INVOICE_FORMATS,
  INVOICE_FORMAT_LABELS,
  billingDrawerCta,
  billingEmailDelivery,
  billingIssueCta,
  canTransitionBillingDocument,
  getDocumentCapabilities,
  resolveInvoiceFormat,
} from "./billing-document.js";
export type {
  BillingDocumentCapabilities,
  BillingDocumentStatus,
  BillingDocumentType,
  BillingEmailDelivery,
  BillingEmailStatus,
  BillingFormatError,
  BillingSourceType,
  InvoiceFormat,
} from "./billing-document.js";
export { computeBillingDocumentAmounts } from "./billing-document-amounts.js";
export type {
  BillingAmountError,
  BillingAmounts,
  BillingAmountsResult,
  BillingDocumentAmounts,
  BillingLineAmounts,
  BillingLineInput,
  BillingVatRateTotal,
  DecimalText,
} from "./billing-document-amounts.js";
export type {
  BillingDocumentCustomer,
  BillingDocumentDetail,
  BillingDocumentDraftInput,
  BillingDocumentLine,
  BillingDocumentLineInput,
} from "./billing-document-draft.js";
export {
  BILLING_CUSTOMER_SOURCES,
  BILLING_DELIVERY_OUTCOMES,
  BILLING_DOCUMENT_LIST_PAGE_SIZE,
  BILLING_DOCUMENT_ORIGINS,
  BILLING_EMAIL_MODES,
  BILLING_LINE_STOCK_OUTCOMES,
  billingEmailModeFor,
} from "./billing-document-read.js";
export type {
  BillingCustomerSource,
  BillingDeliveryOutcome,
  BillingDocumentDeliveryInfo,
  BillingDocumentEmailInput,
  BillingDocumentListItem,
  BillingDocumentListQuery,
  BillingDocumentListResponse,
  BillingDocumentListTarget,
  BillingDocumentOrigin,
  BillingDocumentPdfInfo,
  BillingOwnPaymentMark,
  BillingPaymentSource,
  BillingExternalDocumentDetail,
  BillingExternalDocumentLine,
  ExternalBillingSource,
  BillingDocumentSzamlazzInfo,
  BillingEmailMode,
  BillingEmailRecipients,
  BillingLineStockOutcome,
} from "./billing-document-read.js";
export { billingProductPrice } from "./billing-product-price.js";
export {
  outgoingMissingPayments,
  FIZMODUNIFIED_MISSING_PAYMENTS,
  paymentStateOf,
} from "./billing-payment-state.js";
export type {
  BillingPaymentState,
  OutgoingMissingPayments,
} from "./billing-payment-state.js";
export type { BillingProductPrice } from "./billing-product-price.js";
export {
  BILLING_DOCUMENT_STATUS_LABELS,
  BILLING_EMAIL_STATUS_LABELS,
} from "./billing-document-labels.js";
export {
  SZAMLAZZ_AMOUNT_RULE,
  szamlazzDocumentTotals,
  szamlazzLineAmounts,
  szamlazzMoneyDecimals,
  szamlazzUnitNetFromGross,
} from "./billing-szamlazz-amounts.js";
export type {
  SzamlazzAmountRule,
  SzamlazzDocumentTotals,
  SzamlazzLineAmounts,
  SzamlazzLineAmountsInput,
  SzamlazzUnitNetFromGross,
  SzamlazzUnitNetFromGrossInput,
} from "./billing-szamlazz-amounts.js";
export {
  MAIL_TEMPLATE_EVENTS,
  MAIL_TEMPLATE_GROUPS,
  MAIL_TEMPLATE_VARIABLES,
  isMailTemplateEvent,
  renderMailTemplate,
  renderMailTemplateHtml,
  splitTemplateVariables,
  unknownTemplateVariables,
  mailTemplateEventVariables,
} from "./mail-template.js";
export type {
  MailTemplateRender,
  MailTemplateValues,
  MailTemplateEvent,
  MailTemplateGroup,
  MailTemplateVariable,
} from "./mail-template.js";
export {
  misplacedBlockVariables,
  renderMailTemplateWithBlocks,
} from "./mail-blocks.js";
export type {
  MailBlock,
  MailBlockRender,
  MailBlocks,
  MailRenderSteps,
} from "./mail-blocks.js";
export {
  SHOP_CONTACT,
  SHOP_NAME,
  WEBSHOP_MAIL_KEYS,
  WEBSHOP_MAIL_SAMPLE_FACTS,
  WEBSHOP_SPLIT_PAYMENTS,
  WEBSHOP_STATUS_TEMPLATES,
  mailForint,
  hungarianDay,
  isWebshopMailTemplate,
  parseWebshopMailFacts,
  webshopMailContent,
  webshopMailTemplateOf,
} from "./webshop-mail.js";
export {
  renderWebshopMail,
  webshopMailDocument,
} from "./webshop-mail-render.js";
export type {
  WebshopMailRender,
  WebshopRenderSteps,
  WebshopTemplateText,
} from "./webshop-mail-render.js";
export type {
  WebshopFactsParse,
  WebshopMailCommonFacts,
  WebshopMailContent,
  WebshopMailFacts,
  WebshopMailLine,
  WebshopMailOrder,
  WebshopMailTemplate,
  WebshopPaymentRole,
  WebshopPlacedOrder,
  WebshopRefundFacts,
  WebshopShippedFacts,
  WebshopSplitPayment,
  WebshopStuckMail,
  WebshopStuckMailList,
} from "./webshop-mail.js";
export {
  worksheetStatusLabel,
  worksheetStatusTone,
  worksheetDisplayStatus,
  worksheetDisplayStatusLabel,
  worksheetDisplayStatusTone,
} from "./worksheet-management.js";
export type {
  MaintenancePackageMailPreview,
  MaintenancePackageMailRecipient,
  MaintenancePackageMailResult,
  MaintenancePackageMailSendSkipReason,
  MaintenancePackageMailSkipReason,
  ServiceJobAssetLink,
  ServiceJobAssignee,
  ServiceJobDetail,
  ServiceJobDocumentRemoval,
  ServiceJobDocumentSummary,
  ServiceJobDocumentType,
  ServiceJobHandoverMailPreview,
  ServiceJobHandoverMailRecipient,
  ServiceJobHandoverMailResult,
  ServiceJobHandoverMailSendSkipReason,
  ServiceJobHandoverMailSkipReason,
  ServiceJobKind,
  ServiceJobListItem,
  ServiceJobListResponse,
  ServiceJobStatusCounts,
  ServiceJobPartnerDetail,
  ServiceJobPartnerStatus,
  ServiceJobPartnerStatusEvent,
  ServiceJobPartnerTimelineEntry,
  ServiceJobPartnerWorksheetLink,
  ServiceJobStatusEvent,
  ServiceJobStatusValue,
  ServiceJobTimelineEntry,
  ServiceJobWorksheetLink,
} from "./service-job-management.js";
export type { NamedPerson } from "./person-name.js";
export type {
  DashboardActivity,
  DashboardActivityItem,
  DashboardAquariumAlert,
  DashboardAquariumAlerts,
  DashboardAssigneeLoad,
  DashboardDeadline,
  DashboardDeadlines,
  DashboardInventoryDiscrepancies,
  DashboardInventoryDiscrepancy,
  DashboardManagerTiles,
  DashboardMaterialRequest,
  DashboardMaterialRequests,
  DashboardMyWorksheets,
  DashboardOpenTickets,
  DashboardPurchaseOrder,
  DashboardPurchasing,
  DashboardSummary,
  DashboardTeamLoad,
  DashboardTicket,
  DashboardUpcomingMaintenance,
  DashboardUpcomingMaintenanceItem,
  DashboardWorksheet,
} from "./dashboard.js";

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
  application: DependencyHealth & {
    version: string;
    /** Backwards-compatible runtime commit field. */
    commit: string | null;
    imageCommit: string | null;
    runtimeCommit: string | null;
    commitSourceState:
      | "match"
      | "mismatch"
      | "image-missing"
      | "runtime-missing"
      | "both-missing";
  };
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
  INTERNAL_ROLES,
  isMachineRole,
  MACHINE_ROLES,
  PARTNER_ROLES,
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
  servedNavigationFeatures,
  NAVIGATION_FEATURES,
} from "./navigation.js";
export type {
  NavigationEntry,
  NavigationEntryView,
  NavigationFeature,
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
  AssetLabelScanResult,
  AssetListItem,
  AssetListNeighbors,
  AssetListResponse,
  AssetOwnerListResponse,
  AssetOwnerOption,
  AssetOwnerSummary,
  AssetOwnerType,
  AssetProductSummary,
  AssetQrCode,
  AssetStatus,
  AssetUnitSummary,
  CreateAssetInput,
  UpdateAssetInput,
} from "./asset-management.js";
export {
  assetKindLabel,
  assetStatusLabel,
  assetStatusTone,
  assetCriticalityLabel,
  assetEventLabel,
} from "./asset-management.js";
export type { AssetLabel, AssetLabelIssueResult } from "./asset-label.js";
export type {
  UnitOfMeasure,
  UnitOfMeasureKind,
  UnitOfMeasureListResponse,
} from "./unit-of-measure.js";
export {
  normalizePerformanceValue,
  performanceValueProblem,
  UNIT_OF_MEASURE_KINDS,
  unitOfMeasureKindLabel,
} from "./unit-of-measure.js";
export type { AssetLabelBatchSummary } from "./asset-label-batch.js";
export {
  ASSET_LABEL_BATCH_MAX,
  ASSET_LABEL_BATCH_MIN,
  assetLabelCsv,
  randomAssetLabelCode,
} from "./asset-label-batch.js";
export {
  ASSET_LABEL_CODE_SHAPE_MESSAGE,
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
  AquariumDetail,
  AquariumEquipment,
  AquariumEquipmentKind,
  AquariumListResponse,
  AquariumMaintainer,
  AquariumMeasurementListResponse,
  AquariumMeasurementOccasion,
  AquariumMeasurementParameterCode,
  AquariumMeasurementParameterDefinition,
  AquariumMeasurementTarget,
  AquariumMeasurementValue,
  AquariumOwnershipType,
  AquariumSelectableCustomer,
  AquariumSelectableCustomerListResponse,
  AquariumSummary,
  CreateAquariumEquipmentInput,
  CreateAquariumInput,
  CreateAquariumMeasurementInput,
  UpdateAquariumInput,
  WaterBodyType,
  WaterType,
} from "./aquarium-management.js";
export {
  AQUARIUM_MEASUREMENT_PARAMETER_COLOR,
  AQUARIUM_MEASUREMENT_PARAMETERS,
  AQUARIUM_MEASUREMENT_TARGET_RANGE,
  aquariumEffectiveMeasurementTargetRange,
  aquariumMeasurementParameter,
  aquariumMeasurementParametersFor,
  aquariumMeasurementTargetRange,
} from "./aquarium-management.js";
export type {
  MaintenanceOrderDocumentContentType,
  MaintenanceOrderDocumentSummary,
  MaintenanceOrderPartnerDetail,
  MaintenanceOrderPartnerItem,
  MaintenanceOrderPartnerListResponse,
  MaintenanceOrderPartnerSummary,
  MaintenanceOrderStatusTone,
  MaintenanceOrderStatusValue,
} from "./maintenance-order-management.js";
export {
  maintenanceOrderStatusLabel,
  maintenanceOrderStatusTone,
} from "./maintenance-order-management.js";
export type {
  CompletionCertificateDocumentContentType,
  CompletionCertificateDocumentSummary,
  CompletionCertificatePartnerDetail,
  CompletionCertificatePartnerItem,
  CompletionCertificatePartnerListResponse,
  CompletionCertificatePartnerSummary,
} from "./completion-certificate-management.js";
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
export { CUSTOMER_LIST_PAGE_SIZE } from "./customer-management.js";
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
  PurchaseProductConflictLookup,
  PurchaseProductConflictOwner,
  PurchaseProductSearchResult,
  SupplierInvoiceImportFormat,
  SupplierLineSuggestionRequest,
  SupplierLineSuggestionResult,
  SupplierLineSuggestionSource,
  SupplierInvoiceImportLine,
  SupplierCodeConflict,
  SupplierInvoiceImportResult,
  SupplierInvoiceMailSyncRunSummary,
  SupplierInvoiceMailSyncState,
  SupplierInvoiceMailSyncStatus,
  ExpectedArrivalDetail,
  ExpectedArrivalListItem,
  ExpectedArrivalListResponse,
  ExpectedArrivalSource,
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
  UnasSimilarProduct,
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
  SzamlazzConnectionCredentialInput,
  SzamlazzConnectionView,
} from "./integrations/szamlazz-connection.js";
export type { MaintenanceInvoiceSummary } from "./maintenance-invoice.js";
export type {
  NavIncomingInvoiceAddress,
  NavIncomingInvoiceDetail,
  NavIncomingInvoiceLine,
  NavIncomingInvoiceListResponse,
  NavIncomingInvoiceOperation,
  NavIncomingInvoiceProductCode,
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
  FoxpostSyncRunSummary,
  FoxpostSyncState,
  FoxpostSyncStatus,
  FoxpostSyncSummary,
} from "./integrations/foxpost-settlement.js";
export type {
  GlsCodLineError,
  GlsCodLineStatus,
  GlsCodReportDetail,
  GlsCodReportLine,
  GlsCodReportListResponse,
  GlsCodReportStatus,
  GlsCodReportSummary,
  GlsCodResolutionSource,
  GlsDocumentUploadResult,
  GlsInvoiceSummary,
  GlsManualApprovalInput,
  GlsSyncRunSummary,
  GlsSyncState,
  GlsSyncStatus,
} from "./integrations/gls-settlement.js";
export type {
  SimplePayLineError,
  SimplePayLineStatus,
  SimplePayManualApprovalInput,
  SimplePayReportDetail,
  SimplePayReportListResponse,
  SimplePayReportStatus,
  SimplePayReportSummary,
  SimplePayReportUploadResult,
  SimplePayResolutionSource,
  SimplePaySyncRunSummary,
  SimplePaySyncState,
  SimplePaySyncStatus,
  SimplePayTransactionLine,
} from "./integrations/simplepay-settlement.js";
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
  ProductAdvisorKind,
  ElhelyezesiIgeny,
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
  isWorksheetIssuedSheet,
  preferSignedSheet,
  WORKSHEET_DEPARTMENT_CODE_PATTERN,
  WORKSHEET_ISSUED_SHEET_TYPES,
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
  WorksheetAssetLink,
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
  WorksheetLineKindValue,
  WorksheetListItem,
  WorksheetListResponse,
  WorksheetChainLink,
  WorksheetSelectablePartner,
  WorksheetSelectablePartnerListResponse,
  WorksheetSignerCandidate,
  WorksheetSignerListResponse,
  WorksheetNumberParts,
  WorksheetSignatureDecision,
  WorksheetSignatureDetail,
  WorksheetVersionDetail,
  WorksheetVersionDiff,
  WorksheetVersionStatus,
  WorksheetDisplayStatus,
  WorksheetVersionSummary,
  WorksheetDocumentListResponse,
  WorksheetDocumentSummary,
  WorksheetDocumentType,
} from "./worksheet-management.js";

export {
  NOTIFICATION_ROLES,
  NOTIFICATION_ROLE_VALUES,
} from "./notification-roles.js";
export type {
  NotificationRoleInfo,
  NotificationRoleValue,
} from "./notification-roles.js";
export {
  SERVICE_CAPABILITIES,
  SERVICE_CAPABILITY_VALUES,
} from "./service-capabilities.js";
export type {
  ServiceCapabilityInfo,
  ServiceCapabilityValue,
} from "./service-capabilities.js";
export {
  normalizeAssetCategoryName,
  normalizeAssetCategoryCode,
} from "./asset-category.js";
export type {
  AssetCategory,
  AssetCategoryListResponse,
} from "./asset-category.js";
export { normalizeAssetFunctionName } from "./asset-function.js";
export type {
  AssetFunction,
  AssetFunctionListResponse,
} from "./asset-function.js";
export type {
  CreateMaterialRequestInput,
  MaterialRequestDetail,
  MaterialRequestHistoryEntry,
  MaterialRequestHistoryListResponse,
  MaterialRequestItem,
  MaterialRequestItemInput,
  MaterialRequestListResponse,
  MaterialRequestStatusValue,
  PendingMaterialRequest,
  PendingMaterialRequestListResponse,
  MaterialRequestActions,
  MaterialRequestCommentEntry,
  MaterialRequestCommentInput,
  MaterialRequestConflictBody,
  MaterialRequestEventEntry,
  MaterialRequestEventKindValue,
  MaterialRequestFullDetail,
  MaterialRequestHandlerOption,
  MaterialRequestPage,
  MaterialRequestPriorityValue,
  MaterialRequestReassignInput,
  MaterialRequestReceiveItemsInput,
  MaterialRequestStatusCounts,
  MaterialRequestSummary,
  MaterialRequestView,
} from "./material-request-management.js";
export {
  MATERIAL_REQUEST_ACTIVE_STATUSES,
  MATERIAL_REQUEST_LEADER_ROLES,
  MATERIAL_REQUEST_PRIORITIES,
  MATERIAL_REQUEST_VIEWS,
} from "./material-request-management.js";
export { ACROPORA_COMPANY } from "./company.js";
export {
  MISSING_INVOICE_ACTIONS,
  MISSING_INVOICE_CATEGORIES,
  MISSING_INVOICE_CATEGORY_LABELS,
  MISSING_INVOICE_ITEM_STATES,
  MISSING_INVOICE_STATE_LABELS,
  MISSING_INVOICE_MONTH_STATUSES,
  MISSING_INVOICE_TABS,
} from "./missing-invoices.js";
export type {
  BankStatementImportResult,
  InvoiceCollectionSuggestion,
  InvoiceCollectionSuggestionDecision,
  InvoiceCollectionSuggestionsResponse,
  MissingInvoiceAction,
  MissingInvoiceCandidate,
  MissingInvoiceCategory,
  MissingInvoiceCategoryInput,
  MissingInvoiceCommentInput,
  MissingInvoiceDocumentSource,
  MissingInvoiceItem,
  MissingInvoiceItemDetail,
  MissingInvoiceJevSuggestion,
  MissingInvoiceMatchInput,
  MissingInvoicePaperOriginalInput,
  MissingInvoicePayeeDocument,
  MissingInvoicePayeeInput,
  MissingInvoiceItemState,
  MissingInvoiceMonth,
  MissingInvoiceMonthDetail,
  MissingInvoiceMonthQuery,
  MissingInvoiceMonthStatus,
  MissingInvoiceMonthsResponse,
  MissingInvoiceTab,
} from "./missing-invoices.js";
export {
  INCOMING_BANK_MATCH_LABELS,
  INCOMING_BANK_MATCH_STATES,
  INCOMING_NOT_TO_PAIR_REASON_LABELS,
  INCOMING_PAYMENT_STATE_LABELS,
  INCOMING_PAYMENT_STATES,
} from "./billing-incoming.js";
export type {
  IncomingBankMatch,
  IncomingBankMatchState,
  IncomingDateBasis,
  IncomingDocumentDetail,
  IncomingDocumentLine,
  IncomingDocumentListItem,
  IncomingDocumentListQuery,
  IncomingDocumentListResponse,
  IncomingPaymentState,
  ReceiptsResponse,
} from "./billing-incoming.js";
export {
  DASHBOARD_LAYOUT_VERSION,
  DASHBOARD_ROLE_PRESETS,
  DASHBOARD_STARTER_LAYOUTS,
  DASHBOARD_SYSTEM_SOURCES,
  DASHBOARD_WIDGETS,
  DASHBOARD_WIDGET_IDS,
  DASHBOARD_WIDGET_SIZES,
  availableDashboardWidgets,
  availableStarterLayouts,
  dashboardWidget,
  dashboardWidgetInfo,
  isDashboardWidgetAvailable,
  isDashboardWidgetId,
  presetDashboardLayout,
  resolveDashboardLayout,
  sanitizeDashboardLayoutInput,
  starterDashboardLayout,
} from "./dashboard-widgets.js";
export type {
  DashboardAquariumAlertsWidgetData,
  DashboardAquariumEquipmentWidgetData,
  DashboardAttentionItem,
  DashboardAttentionWidgetData,
  DashboardJevCounts,
  DashboardJevIntelligenceWidgetData,
  DashboardSystemSource,
  DashboardSystemState,
  DashboardSystemStatusWidgetData,
  DashboardExpectedArrivalsWidgetData,
  DashboardIncomingInvoicesWidgetData,
  DashboardLayoutEntry,
  DashboardMaintenanceCalendarWidgetData,
  DashboardMaterialRequestsWidgetData,
  DashboardMissingInvoicesWidgetData,
  DashboardOverdueInvoicesWidgetData,
  DashboardServiceTicketsWidgetData,
  DashboardSettlementsWidgetData,
  DashboardStockReconciliationWidgetData,
  DashboardStockSyncOutboxWidgetData,
  DashboardWaterValuesWidgetData,
  DashboardWorksheetsWidgetData,
  DashboardLayoutInputResult,
  DashboardLayoutResponse,
  DashboardLayoutUpdate,
  DashboardStarterLayoutId,
  DashboardTasksWidgetData,
  DashboardViewer,
  DashboardWidgetAvailability,
  DashboardWidgetCategory,
  DashboardWidgetDefinition,
  DashboardWidgetId,
  DashboardWidgetInfo,
  DashboardWidgetResult,
  DashboardWidgetSize,
  DashboardWidgetsResponse,
  ResolvedDashboardLayout,
} from "./dashboard-widgets.js";
export {
  PRODUCT_ENRICHMENT_FIELDS,
  PRODUCT_EVIDENCE_SOURCE_TYPES,
  PRODUCT_FIELD_STATUSES,
  PRODUCT_INTERNAL_SOURCE_TYPES,
  PRODUCT_QUALITY_QUEUE_FILTERS,
} from "./product-enrichment-review.js";
export type {
  ProductEnrichmentAvailability,
  ProductEnrichmentFieldKey,
  ProductEnrichmentReview,
  ProductEvidenceEntry,
  ProductEvidenceSourceType,
  ProductFieldReview,
  ProductFieldStatus,
  ProductFieldTier,
  ProductFieldValue,
  ProductQualityQueueRow,
  ProductQualityQueueFilter,
  ProductQualityQueuePage,
} from "./product-enrichment-review.js";
export {
  PRODUCT_COPY_BLOCKS,
  PRODUCT_COPY_STATUSES,
  PRODUCT_KNOWLEDGE_ACCEPTABLE_STATUSES,
  PRODUCT_MANUAL_EVIDENCE_SOURCE_TYPES,
} from "./product-knowledge.js";
export type {
  ProductCopyBlock,
  ProductCopyEntry,
  ProductCopyStatus,
  ProductKnowledge,
  ProductKnowledgeFact,
  ProductManualEvidenceInput,
  ProductManualEvidenceResult,
  ProductManualEvidenceSourceType,
} from "./product-knowledge.js";

export type {
  ServiceDraftItem,
  ServiceDraftListResponse,
  ServiceDraftFilterState,
  ServiceDraftFilteredItem,
  ServiceDraftJevClass,
  ServiceDraftStatus,
  ServiceDraftSyncStatus,
} from "./service-drafts.js";

export { serviceJobReporterName } from "./service-job-reporter.js";

export {
  MESSAGE_ATTACHMENTS_MAX,
  MESSAGE_REACTIONS,
  CONVERSATION_MAX_MEMBERS,
  MESSAGE_PAGE_DEFAULT,
  MESSAGE_PAGE_MAX,
  MESSAGE_TEXT_MAX_LENGTH,
  MESSAGE_SEARCH_MIN_LENGTH,
  MESSAGE_SEARCH_MAX_LENGTH,
  MESSAGE_SEARCH_LIMIT,
  MESSAGE_SEARCH_COUNT_CAP,
  CONVERSATION_NOTIFY_MODES,
  CONVERSATION_CONTEXT_TYPES,
} from "./messages.js";
export type {
  ConversationAudienceValue,
  ConversationDetail,
  ConversationListItem,
  ConversationContextCard,
  ConversationContextType,
  ConversationListResponse,
  ConversationNotificationState,
  ConversationNotifyMode,
  ConversationPerson,
  ConversationTypeValue,
  MessageAttachmentItem,
  MessageAttachmentKindValue,
  MessageItem,
  MessagePage,
  MessageSearchHit,
  MessageSearchResponse,
  PinnedItem,
  PinnedItemsResponse,
  MessageReactionSummary,
  MessageReactionValue,
  MessageReplyPreview,
  MessagePeopleResponse,
  MessageStreamEvent,
  MessageTypeValue,
  MessagesUnreadResponse,
  SharedAttachmentItem,
  SharedAttachmentPage,
} from "./messages.js";

export type { CashRegisterReceiptListResponse } from "./cash-registers.js";

export {
  WEBSHOP_ORDER_CLOSED_STATUSES,
  WEBSHOP_ORDER_PAYMENT_STATE_LABELS,
  WEBSHOP_ORDER_STAGES,
  WEBSHOP_ORDER_STAGE_LABELS,
  WEBSHOP_ORDER_STALE_DEFAULTS,
  WEBSHOP_ORDER_STATUSES,
  WEBSHOP_ORDER_STATUS_LABELS,
  WEBSHOP_PARCEL_SIZES,
  WEBSHOP_CARD_PAYMENT_STATES,
  WEBSHOP_CARD_PAYMENT_STATE_LABELS,
  WEBSHOP_STALE_STATUSES,
  WEBSHOP_STALE_THRESHOLD_DEFAULTS,
  staleHoursOf,
  pointKindOf,
  glsDeliveryLabel,
  WEBSHOP_CARRIER_NOTE_MAX,
  WEBSHOP_CUSTOMER_NOTE_MAX,
} from "./webshop-orders.js";
export type {
  WebshopOrderAddress,
  WebshopOrderDetail,
  WebshopOrderHistoryEntry,
  WebshopOrderLine,
  WebshopOrderStep,
  WebshopOrderListItem,
  WebshopOrderListQuery,
  WebshopOrderListResponse,
  WebshopOrderPaymentState,
  WebshopOrderSortField,
  WebshopOrderStage,
  WebshopOrderStatus,
  WebshopOrderView,
  WebshopOrderParcel,
  WebshopOrderParcelCreate,
  WebshopOrderParcelResult,
  WebshopOrderMailState,
  WebshopOrderLineEdit,
  WebshopCardPaymentState,
  WebshopHoldWarning,
  WebshopOrderCardPayment,
  WebshopStaleStatus,
  WebshopStaleThreshold,
  WebshopOrderAddressInput,
  WebshopOrderNotesInput,
  WebshopParcelTracking,
  WebshopPickupPointOption,
  WebshopPickupPointSearch,
  WebshopPointKind,
  WebshopStaleUnit,
  WebshopVariantOption,
  WebshopOrderStatusChangeResult,
  WebshopStatusMailOutcome,
  WebshopParcelSize,
  WebshopShippingNoticeOutcome,
} from "./webshop-orders.js";
export {
  NAVIGATION_COUNTER_IDS,
  isNavigationCounterId,
  navigationCounterLabel,
} from "./navigation-counters.js";
export type {
  NavigationCounterId,
  NavigationCounters,
} from "./navigation-counters.js";
