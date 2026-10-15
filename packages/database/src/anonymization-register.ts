/**
 * ANONYMIZATION REGISTER: what happens to every text, JSON and binary column
 * when production data is copied to the stage database.
 *
 * Source: the stage protection and anonymization plan of 2026-10-12, section
 * 3.1 point 4 ("the rule lives with the schema, not in the script") and the
 * categories of section 3.2. This file is that register; nothing reads it at
 * runtime yet. The anonymization pipeline itself is a separate, later step.
 *
 * Every String, String[], Json, Bytes and Unsupported(...) field of
 * `prisma/schema.prisma` has exactly one decision, from one of two sources:
 *
 * - a STRUCTURAL rule, applied by `anonymization-register-check.ts`: an `@id`
 *   with `@default(cuid())` or `@default(uuid())` is kept, and a foreign key
 *   inherits the decision of the field it references. These fields have NO
 *   row here; a row for one of them is reported as a double decision.
 * - a ROW in `ANONYMIZATION_REGISTER` below, for every other field.
 *
 * `anonymization-register.test.ts` fails when a field has no decision, when a
 * row points to a field that does not exist, or when a field is decided twice.
 * A new column therefore cannot reach the stage copy unclassified.
 *
 * Name patterns are NOT a rule here. They drafted the first version of the
 * rows, but a pattern that decides silently would also classify a future
 * column nobody has looked at.
 */

export type AnonymizationAction =
  /** The value is copied unchanged. */
  | "keep"
  /** Replaced by a deterministic, format-valid fake: the same input gives the same output everywhere. */
  | "pseudonymize"
  /** Replaced by a value that does not depend on the original. */
  | "replace"
  /** Removed (NULL, or the row is deleted when the column is required). */
  | "delete";

export interface AnonymizationKind {
  readonly action: AnonymizationAction;
  readonly description: string;
  /**
   * The action for rows that describe a natural person, when it differs from
   * `action` (a customer or supplier can be a private person or a sole
   * trader). The row is recognised by the customer type field or by the shape
   * of its tax number (plan 3.2, "Cég" row).
   */
  readonly naturalPersonRows?: AnonymizationAction;
  /** Set while the owner's decision on this kind is open. */
  readonly pendingDecision?: string;
}

/**
 * Company names and tax numbers: the plan PROPOSES to keep them, and the
 * owner has not decided yet (plan section 4, point 3). Changing this one line
 * changes both kinds that depend on the decision.
 */
const COMPANY_DATA_ACTION: AnonymizationAction = "keep";

const COMPANY_DATA_DECISION =
  "Plan 2026-10-12 section 4 point 3: may the names and tax numbers of legal persons stay on stage? Sole traders are pseudonymized either way.";

export const ANONYMIZATION_KINDS = {
  generatedIdentifier: {
    action: "keep",
    description:
      "A database-generated row id (structural rule only, never a register row).",
  },
  identifier: {
    action: "keep",
    description:
      "An internal or external identifier, document number, code or content digest: references between rows and to external systems (UNAS, Számlázz, Gmail, NAV) must keep matching.",
  },
  business: {
    action: "keep",
    description:
      "Business or technical data: product, price, unit, currency, status, configuration, run diagnostics.",
  },
  ownCompany: {
    action: "keep",
    description:
      "Our own company's data: own bank accounts, warehouses, cash registers, mailboxes, mail template images.",
  },
  location: {
    action: "keep",
    description:
      "Postal code, city and country: shipping zones and parcel lockers depend on them.",
  },
  storageReference: {
    action: "keep",
    description:
      "A key or URL pointing into the document store. The stored file itself is outside this register.",
  },
  derived: {
    action: "keep",
    description:
      "A database-generated column; it is recomputed from the anonymized source columns.",
  },
  partyName: {
    action: COMPANY_DATA_ACTION,
    naturalPersonRows: "pseudonymize",
    pendingDecision: COMPANY_DATA_DECISION,
    description:
      "The name of a counterparty that can be a company or a natural person (customer, supplier, invoice partner, bank counterparty).",
  },
  partyTaxNumber: {
    action: COMPANY_DATA_ACTION,
    naturalPersonRows: "pseudonymize",
    pendingDecision: COMPANY_DATA_DECISION,
    description:
      "The tax number or EU VAT number of a counterparty, or a key derived from it.",
  },
  personName: {
    action: "pseudonymize",
    description:
      "The name of a natural person: user, contact person, reporter, signer, issuer, recipient.",
  },
  email: {
    action: "pseudonymize",
    description:
      "An e-mail address; the fake one ends in an undeliverable domain (teszt.acropora.invalid).",
  },
  phone: {
    action: "pseudonymize",
    description: "A phone number, format-valid.",
  },
  streetAddress: {
    action: "pseudonymize",
    description:
      "Street and house number. Postal code, city and country stay (see location).",
  },
  bankAccount: {
    action: "pseudonymize",
    description:
      "A counterparty's IBAN or bank account number, with a valid checksum.",
  },
  parcelNumber: {
    action: "pseudonymize",
    description:
      "A carrier parcel number: with a real one the recipient can be looked up at the carrier.",
  },
  freeText: {
    action: "pseudonymize",
    description:
      "Human-written text: e-mail, phone, IBAN and tax number patterns are replaced, and so are the known real person names, with the same pseudonyms as in the fields.",
  },
  json: {
    action: "pseudonymize",
    description:
      "JSON that can carry personal data: walked recursively, values replaced by key name (name, e-mail, phone, address, tax number) and by the same dictionary as free text.",
  },
  passwordHash: {
    action: "replace",
    description:
      "A password or signature-code hash: replaced by the hash of the stage-only password.",
  },
  rawMessage: {
    action: "replace",
    description:
      "An incoming message body (customer mail, Számlázz feed): fully replaced, the structured data parsed from it stays in its own columns.",
  },
  fileContent: {
    action: "replace",
    description:
      "A stored file (attachment, scan, report, thumbnail): replaced by a neutral placeholder of the same type.",
  },
  secret: {
    action: "delete",
    description:
      "A credential, token, session, share link or encryption material: removed, the stage gets its own.",
  },
  ipAddress: {
    action: "delete",
    description: "An IP address in a log.",
  },
} as const satisfies Record<string, AnonymizationKind>;

export type AnonymizationKindName = keyof typeof ANONYMIZATION_KINDS;

/** Kinds that only a structural rule may assign, never a register row. */
type StructuralKindName = "generatedIdentifier";

export type RegisterKindName = Exclude<
  AnonymizationKindName,
  StructuralKindName
>;

/**
 * One row per field that no structural rule decides, in schema order.
 */
export const ANONYMIZATION_REGISTER: Readonly<
  Record<string, Readonly<Record<string, RegisterKindName>>>
> = {
  SlugHistory: {
    entityId: "identifier",
    slug: "business",
  },
  UrlRedirect: {
    sourcePath: "business",
    sourcePathLower: "business",
    destinationPath: "business",
    destinationPathLower: "business",
    entityId: "identifier",
  },
  User: {
    email: "email",
    displayName: "personName",
    nickname: "personName",
    firstName: "personName",
    lastName: "personName",
    passwordHash: "passwordHash",
    signatureCodeHash: "passwordHash",
    avatarUrl: "storageReference",
  },
  DeviceToken: {
    token: "secret",
    bundleId: "business",
  },
  Session: {
    tokenHash: "secret",
  },
  Product: {
    name: "business",
    description: "business",
    descriptionLong: "business",
    rawSourceHash: "business",
    medusaImageBlockDetails: "business",
  },
  ProductDescriptionImageReference: {
    descriptionPart: "business",
    url: "business",
    host: "business",
  },
  ProductVariant: {
    sku: "business",
    name: "business",
    unit: "business",
    sellingPriceCurrency: "business",
    manufacturerPartNumber: "business",
    secondaryUnit: "business",
    unasBaseSku: "business",
    unasVariantKey: "business",
    unasVariantValues: "business",
  },
  Brand: {
    name: "business",
    normalizedName: "business",
    slug: "business",
    description: "business",
    websiteUrl: "business",
    logoUrl: "business",
    metadata: "business",
    seoTitle: "business",
    metaDescription: "business",
    intro: "business",
    merchantBrandName: "business",
  },
  BrandSourceDomain: {
    domain: "business",
  },
  BrandAlias: {
    alias: "business",
    normalizedAlias: "business",
    source: "business",
    sourceExternalId: "business",
  },
  Category: {
    name: "business",
    slug: "business",
  },
  StoreCategory: {
    name: "business",
    slug: "business",
    seoTitle: "business",
    metaDescription: "business",
    intro: "business",
    imageUrl: "business",
  },
  SeoLandingPage: {
    slug: "business",
    title: "business",
    seoTitle: "business",
    metaDescription: "business",
    intro: "business",
    filterDefinition: "business",
  },
  UnasCategoryMapping: {
    note: "freeText",
  },
  ProductCategory: {
    source: "business",
  },
  ChannelListing: {
    externalStatus: "business",
    slug: "business",
    productUrl: "business",
    seoTitle: "business",
    seoDescription: "business",
    seoKeywords: "business",
    seoRobots: "business",
    metadata: "business",
  },
  ProductImage: {
    url: "business",
    storageKey: "storageReference",
    altText: "business",
    title: "business",
    fileName: "business",
    source: "business",
  },
  ProductRelation: {
    source: "business",
  },
  ProductBarcode: {
    code: "business",
  },
  CatalogImportBatch: {
    sourceFileName: "freeText",
    fileSha256: "identifier",
    analysisVersion: "business",
    report: "business",
    applyReport: "business",
    approvedBy: "identifier",
    appliedBy: "identifier",
  },
  CatalogImportRow: {
    externalId: "business",
    sku: "business",
    rawPayload: "business",
    parsedPayload: "business",
    issues: "business",
  },
  BrandResolutionReview: {
    sku: "business",
    productName: "business",
    proposedBrandKey: "business",
    resolvedBrandKey: "business",
    reviewedBy: "identifier",
    reviewReasons: "business",
    resolution: "business",
    resolverVersion: "business",
    configVersion: "business",
    schemaVersion: "business",
  },
  Supplier: {
    code: "identifier",
    name: "partyName",
    taxNumber: "partyTaxNumber",
    country: "location",
    email: "email",
    websiteUrl: "business",
    phone: "phone",
    worksheetPartnerCode: "identifier",
    iban: "bankAccount",
    swiftCode: "business",
    bankAccountNumber: "bankAccount",
    contactPersonName: "personName",
    contactPersonPhone: "phone",
    contactPersonEmail: "email",
    postalCode: "location",
    city: "location",
    addressLine1: "streetAddress",
    addressLine2: "streetAddress",
  },
  SupplierProduct: {
    supplierSku: "business",
    supplierName: "business",
    currency: "business",
  },
  Warehouse: {
    code: "ownCompany",
    name: "ownCompany",
  },
  WarehouseLocation: {
    code: "ownCompany",
    name: "ownCompany",
  },
  AiProductSearchDocument: {
    title: "business",
    skus: "business",
    facets: "business",
    descriptionShort: "business",
    descriptionLong: "business",
    parameters: "business",
    searchVector: "derived",
  },
  ProductPriceHistory: {
    currency: "business",
  },
  UnasProductSnapshot: {
    currency: "business",
    priceDisplay: "business",
    descriptionShort: "business",
    descriptionLong: "business",
    productUrl: "business",
    sefUrl: "business",
    manufacturerUrl: "business",
    packageComponents: "business",
    primaryCategoryExternalId: "business",
    alternativeCategoryExternalIds: "business",
    images: "business",
    parameters: "business",
    seo: "business",
    rawPayload: "business",
  },
  ProductExtension: {
    defaultPurchaseCurrency: "business",
    internalNote: "freeText",
  },
  StockItem: {
    lotId: "identifier",
  },
  StockReconciliationRepair: {
    reason: "freeText",
    idempotencyKey: "identifier",
    movementId: "identifier",
    outboxId: "identifier",
    requestDetail: "business",
    resultDetail: "business",
  },
  ReleaseEvidence: {
    commitSha: "business",
    workflowRunId: "business",
    repository: "business",
    workflowName: "business",
    jobName: "business",
    triggerEvent: "business",
    environment: "business",
    databaseEngine: "business",
    databaseEngineVersion: "business",
    testSuite: "business",
    resultDetail: "business",
  },
  StockMovement: {
    movementNumber: "identifier",
    referenceType: "business",
    referenceId: "identifier",
    idempotencyKey: "identifier",
    note: "freeText",
  },
  StockMovementLine: {
    unit: "business",
    lotId: "identifier",
    serialNumberId: "identifier",
  },
  UnasStockSyncOutbox: {
    sku: "business",
    idempotencyKey: "identifier",
    sourceRecordId: "identifier",
    lastError: "freeText",
    resolutionNote: "freeText",
    claimedBy: "business",
  },
  InventoryCount: {
    countNumber: "identifier",
  },
  InventoryCountLine: {
    syncError: "freeText",
  },
  Customer: {
    customerNumber: "identifier",
    displayName: "partyName",
    companyName: "partyName",
    worksheetPartnerCode: "identifier",
    taxNumber: "partyTaxNumber",
    euTaxNumber: "partyTaxNumber",
    email: "email",
    phone: "phone",
  },
  CustomerAddress: {
    name: "partyName",
    country: "location",
    postalCode: "location",
    city: "location",
    line1: "streetAddress",
    line2: "streetAddress",
  },
  SalesOrder: {
    orderNumber: "identifier",
    currency: "business",
    unasExistenceCheckClaimedBy: "business",
    buyerName: "partyName",
    buyerEmail: "email",
    buyerTaxNumber: "partyTaxNumber",
    buyerEuTaxNumber: "partyTaxNumber",
    buyerCustomerType: "business",
    buyerCountryCode: "location",
    buyerZip: "location",
    buyerCity: "location",
    buyerAddress: "streetAddress",
  },
  CarrierShipment: {
    carrier: "business",
    orderReference: "identifier",
    parcelNumber: "parcelNumber",
    status: "business",
  },
  OrderBusinessStatusEvent: {
    note: "freeText",
  },
  SalesOrderLine: {
    sku: "business",
    description: "freeText",
    unit: "business",
    syncError: "freeText",
  },
  PurchaseOrder: {
    orderNumber: "identifier",
    currency: "business",
  },
  PurchaseOrderLine: {
    supplierSku: "business",
    description: "freeText",
    unit: "business",
  },
  GoodsReceipt: {
    receiptNumber: "identifier",
  },
  PurchaseInvoice: {
    documentNumber: "identifier",
    supplierInvoiceNumber: "identifier",
    currency: "business",
    note: "freeText",
    cancelledById: "identifier",
    cancelReason: "freeText",
  },
  PurchaseInvoiceLine: {
    sourceDescription: "freeText",
    navLineDescription: "freeText",
    unit: "business",
    syncStatus: "business",
    syncError: "freeText",
  },
  Project: {
    projectNumber: "identifier",
    name: "freeText",
  },
  NavIncomingInvoice: {
    navInvoiceNumber: "identifier",
    supplierTaxNumber: "partyTaxNumber",
    supplierName: "partyName",
    currency: "business",
    originalInvoiceNumber: "identifier",
    parsedData: "json",
    errorCode: "business",
  },
  NavInvoiceSyncRun: {
    activeKey: "business",
    errorCode: "business",
  },
  Invoice: {
    szamlazzInvoiceId: "identifier",
    invoiceNumber: "identifier",
    partnerName: "partyName",
    partnerTaxNumber: "partyTaxNumber",
    currency: "business",
    syncError: "freeText",
    rawPayloadStorageKey: "storageReference",
    pdfStorageKey: "storageReference",
    externalUrl: "secret",
    bookkeepingStatus: "business",
    tags: "business",
    note: "freeText",
    sourceId: "identifier",
    paymentMethod: "business",
    language: "business",
    reference: "identifier",
    buyerSnapshot: "json",
  },
  InvoiceLine: {
    description: "freeText",
    unit: "business",
    comment: "freeText",
    stockOutcome: "business",
  },
  BillingDocumentMailDelivery: {
    recipients: "json",
    subject: "freeText",
    templateId: "identifier",
    outcome: "business",
    error: "freeText",
    requestId: "identifier",
  },
  ServiceJob: {
    jobNumber: "identifier",
    clientOperationId: "identifier",
    title: "freeText",
    description: "freeText",
    reporterPersonName: "personName",
    assignedUserId: "identifier",
    openedById: "identifier",
    hiddenById: "identifier",
  },
  Contract: {
    number: "identifier",
    title: "freeText",
    notes: "freeText",
    organizationalUnitName: "partyName",
    contactPersonName: "personName",
  },
  ContractItem: {
    description: "freeText",
  },
  ContractDocument: {
    fileName: "freeText",
    contentType: "business",
    content: "fileContent",
    storageKey: "storageReference",
  },
  MaintenanceOrder: {
    number: "identifier",
    issuedByName: "personName",
    revokedByName: "personName",
    revokeReason: "freeText",
  },
  MaintenanceOrderItem: {
    description: "freeText",
  },
  MaintenanceOrderDocument: {
    fileName: "freeText",
    contentType: "business",
    content: "fileContent",
    storageKey: "storageReference",
  },
  CompletionCertificate: {
    number: "identifier",
    issuedByName: "personName",
  },
  CompletionCertificateLineItem: {
    description: "freeText",
  },
  CompletionCertificateDocument: {
    fileName: "freeText",
    contentType: "business",
    content: "fileContent",
    storageKey: "storageReference",
  },
  MaintenanceMailDelivery: {
    serviceJobId: "identifier",
    jobNumber: "identifier",
    initiatedByUserId: "identifier",
    subject: "freeText",
    recipients: "json",
    outcome: "business",
    error: "freeText",
  },
  Aquarium: {
    aquariumNumber: "identifier",
    clientOperationId: "identifier",
    name: "freeText",
    notes: "freeText",
    responsibleUserId: "identifier",
  },
  AquariumMeasurementTarget: {
    parameterCode: "business",
  },
  AquariumEquipment: {
    manufacturer: "business",
    model: "business",
    notes: "freeText",
  },
  Asset: {
    assetNumber: "identifier",
    clientOperationId: "identifier",
    qrToken: "identifier",
    name: "business",
    category: "business",
    manufacturer: "business",
    model: "business",
    serialNumber: "business",
    partnerInternalCode: "identifier",
    inventoryNumber: "identifier",
    powerConsumptionRaw: "business",
    electricalCode: "business",
    description: "freeText",
    notes: "freeText",
  },
  AssetCategory: {
    name: "business",
    code: "business",
  },
  AssetFunction: {
    name: "business",
  },
  UnitOfMeasure: {
    code: "business",
    name: "business",
  },
  AssetLabel: {
    code: "business",
  },
  AssetDocument: {
    fileName: "freeText",
    contentType: "business",
    sha256: "identifier",
    content: "fileContent",
    storageKey: "storageReference",
    thumbnail: "fileContent",
    caption: "freeText",
  },
  WorksheetDocument: {
    fileName: "freeText",
    contentType: "business",
    sha256: "identifier",
    content: "fileContent",
    storageKey: "storageReference",
    thumbnail: "fileContent",
    caption: "freeText",
  },
  ServiceJobDocument: {
    fileName: "freeText",
    contentType: "business",
    sha256: "identifier",
    content: "fileContent",
    storageKey: "storageReference",
    thumbnail: "fileContent",
    caption: "freeText",
  },
  AssetEvent: {
    payload: "json",
  },
  ServiceJobEvent: {
    note: "freeText",
  },
  ServiceJobAsset: {
    notes: "freeText",
  },
  WorksheetDepartment: {
    code: "business",
    name: "business",
  },
  UserPermissionOverride: {
    permission: "business",
  },
  WorksheetNumberSequence: {
    partnerCode: "business",
    departmentCode: "business",
  },
  Worksheet: {
    clientOperationId: "identifier",
    number: "identifier",
  },
  WorksheetVersion: {
    subject: "freeText",
    unitName: "business",
    description: "freeText",
    currency: "business",
    changeReason: "freeText",
  },
  WorksheetLine: {
    description: "freeText",
    detail: "freeText",
    unit: "business",
  },
  WorksheetEntry: {
    body: "freeText",
  },
  MaterialRequest: {
    note: "freeText",
  },
  MaterialRequestItem: {
    name: "business",
    quantity: "business",
    unit: "business",
  },
  MaterialRequestEvent: {
    payload: "json",
  },
  MaterialRequestComment: {
    body: "freeText",
  },
  WorksheetVersionSignature: {
    signerName: "personName",
    note: "freeText",
  },
  AquariumMeasurement: {
    parameterCode: "business",
    unit: "business",
    measuredById: "identifier",
    source: "business",
    notes: "freeText",
    clientOperationId: "identifier",
  },
  AquariumMeasurementRecommendation: {
    input: "business",
    candidates: "business",
    examples: "business",
    aiDraft: "freeText",
    aiModel: "business",
    draftText: "freeText",
    approvedText: "freeText",
    productIds: "identifier",
  },
  IcpReport: {
    reportNumber: "identifier",
    aquariumId: "identifier",
    laboratoryCode: "identifier",
    sourceFileUrl: "storageReference",
    sourceFileHash: "identifier",
  },
  IcpResult: {
    elementCode: "business",
    unit: "business",
    trend: "business",
  },
  ExternalReference: {
    entityType: "business",
    entityId: "identifier",
    externalId: "identifier",
    externalKey: "identifier",
    metadata: "json",
  },
  IntegrationSyncState: {
    provider: "business",
    operation: "business",
    aggregateType: "business",
    aggregateId: "identifier",
    idempotencyKey: "identifier",
    lastError: "freeText",
    payload: "json",
  },
  IntegrationCursor: {
    provider: "business",
    stream: "business",
  },
  UnasConnectionSetting: {
    id: "identifier",
    encryptedApiKey: "secret",
    encryptionIv: "secret",
    authenticationTag: "secret",
    keyVersion: "business",
    lastVerificationCode: "business",
  },
  NavConnectionSetting: {
    id: "identifier",
    encryptedCredentials: "secret",
    encryptionIv: "secret",
    authenticationTag: "secret",
    keyVersion: "business",
    lastVerificationCode: "business",
  },
  SzamlazzConnectionSetting: {
    id: "identifier",
    encryptedAgentKey: "secret",
    agentKeyEncryptionIv: "secret",
    agentKeyAuthenticationTag: "secret",
    agentKeyVersion: "business",
    encryptedFinancialApiKey: "secret",
    financialApiKeyEncryptionIv: "secret",
    financialApiKeyAuthenticationTag: "secret",
    financialApiKeyVersion: "business",
    lastVerificationCode: "business",
  },
  MedusaConnectionSetting: {
    id: "identifier",
    encryptedApiKey: "secret",
    encryptionIv: "secret",
    authenticationTag: "secret",
    keyVersion: "business",
    lastVerificationCode: "business",
  },
  UnasProductSyncRun: {
    activeKey: "business",
    errorCode: "business",
  },
  UnasRelationRebuildRun: {
    errorCode: "business",
  },
  UnasOrderSyncRun: {
    activeKey: "business",
    errorCode: "business",
  },
  UnasCustomerSyncRun: {
    activeKey: "business",
    errorCode: "business",
  },
  FoxpostSettlement: {
    gmailMessageId: "identifier",
    gmailThreadId: "identifier",
    gmailSubject: "freeText",
    gmailFrom: "email",
    xlsxAttachmentId: "identifier",
    xlsxFileName: "freeText",
    xlsxContent: "fileContent",
    xlsxSha256: "identifier",
    pdfAttachmentId: "identifier",
    pdfFileName: "freeText",
    pdfContent: "fileContent",
    pdfSha256: "identifier",
    partnerCode: "ownCompany",
    settlementCode: "identifier",
    invoiceNumber: "identifier",
    currency: "business",
    errorCode: "business",
  },
  FoxpostSettlementLine: {
    referenceCode: "identifier",
    recipientName: "personName",
    parcelBarcode: "parcelNumber",
    invoiceNumber: "identifier",
    errorCode: "business",
  },
  FoxpostMonthlyReport: {
    filename: "freeText",
    content: "fileContent",
  },
  FoxpostSyncRun: {
    activeKey: "business",
    errorCode: "business",
  },
  SimplePayReport: {
    fileName: "freeText",
    sha256: "identifier",
    content: "fileContent",
    contentKey: "identifier",
    currency: "business",
    warnings: "business",
    gmailMessageId: "identifier",
    uploadedByUserId: "identifier",
  },
  SimplePayTransactionLine: {
    transactionStatus: "business",
    simplePayTransactionId: "identifier",
    merchantTransactionId: "identifier",
    orderKeySuffix: "business",
    transactionAt: "business",
    currency: "business",
    orderNumber: "identifier",
    invoiceNumbers: "identifier",
    errorCode: "business",
  },
  SimplePayGmailMessage: {
    gmailMessageId: "identifier",
    subject: "freeText",
    errorCode: "business",
  },
  SimplePaySyncRun: {
    activeKey: "business",
    errorCode: "business",
  },
  GlsCodReport: {
    fileName: "freeText",
    sha256: "identifier",
    content: "fileContent",
    contentKey: "identifier",
    currency: "business",
    uploadedByUserId: "identifier",
  },
  GlsCodReportLine: {
    reportNumber: "identifier",
    parcelNumber: "parcelNumber",
    codReference: "identifier",
    invoiceNumbers: "identifier",
    errorCode: "business",
    suggestedInvoiceNumber: "identifier",
  },
  GlsInvoice: {
    invoiceNumber: "identifier",
    currency: "business",
    fileName: "freeText",
    sha256: "identifier",
    content: "fileContent",
    uploadedByUserId: "identifier",
  },
  GlsInvoiceParcel: {
    parcelNumber: "parcelNumber",
    clientReference: "identifier",
    codReference: "identifier",
  },
  PaidMarkRun: {
    summary: "json",
    attention: "json",
    errorCode: "business",
  },
  OutgoingPaymentMark: {
    invoiceNumber: "identifier",
    sourceRef: "identifier",
    requestSha256: "identifier",
    responseCode: "business",
    responseMessage: "freeText",
  },
  GlsCompensationLetter: {
    clientNumber: "ownCompany",
    currency: "business",
    references: "identifier",
    fileName: "freeText",
    sha256: "identifier",
    content: "fileContent",
    uploadedByUserId: "identifier",
  },
  GlsGmailMessage: {
    gmailMessageId: "identifier",
    subject: "freeText",
    errorCode: "business",
  },
  GlsSyncRun: {
    activeKey: "business",
    errorCode: "business",
  },
  AuditLog: {
    action: "business",
    entityType: "business",
    entityId: "identifier",
    metadata: "json",
    ipAddress: "ipAddress",
  },
  DomainEvent: {
    id: "identifier",
    eventType: "business",
    aggregateType: "business",
    aggregateId: "identifier",
    correlationId: "identifier",
    payload: "json",
  },
  Task: {
    title: "freeText",
    description: "freeText",
    linkUrl: "business",
    sourceRef: "identifier",
  },
  ServiceToken: {
    name: "business",
    slug: "business",
    tokenHash: "secret",
  },
  ProductDatasheet: {
    magyarNev: "business",
    angolNev: "business",
    csaladTaxon: "business",
    elohelySzoveg: "business",
    akvariumMeretSzoveg: "business",
    maxMeretSzoveg: "business",
    kulleme: "business",
    tartasa: "business",
    viselkedese: "business",
    ajanlottEleseg: "business",
    erzekenyseg: "business",
    tarsithatosag: "business",
    erdekesseg: "business",
    genus: "business",
    species: "business",
    kereskedelmiNev: "business",
    origin: "business",
    amitOVeszelyeztet: "business",
    amiOtVeszelyezteti: "business",
  },
  ProductDatasheetFieldRefusal: {
    indok: "freeText",
  },
  ContentItem: {
    title: "freeText",
    body: "freeText",
    authorId: "identifier",
    reviewerId: "identifier",
    externalPostId: "identifier",
    externalUrl: "business",
    discardReason: "freeText",
  },
  ContentComment: {
    authorId: "identifier",
    body: "freeText",
  },
  TicketMailDelivery: {
    serviceJobId: "identifier",
    jobNumber: "identifier",
    initiatedByUserId: "identifier",
    subject: "freeText",
    recipients: "json",
    outcome: "business",
    error: "freeText",
  },
  TicketMailTemplate: {
    id: "identifier",
    subject: "freeText",
    body: "freeText",
    bodyHtml: "freeText",
  },
  MailImage: {
    fileName: "business",
    contentType: "business",
    sha256: "identifier",
    content: "ownCompany",
  },
  DecisionRun: {
    policyKey: "identifier",
    projectionHash: "identifier",
    projectionPayload: "json",
    optionsHash: "identifier",
    requestedModel: "business",
    respondedModel: "business",
    selectedValue: "business",
    probabilities: "business",
    resolvedValue: "business",
    errorCode: "business",
    errorMessage: "freeText",
    entityType: "business",
    entityId: "identifier",
    clientOperationId: "identifier",
  },
  ExpectedArrival: {
    supplierKey: "partyTaxNumber",
    arrivalKey: "identifier",
    supplierName: "partyName",
    orderReference: "identifier",
    invoiceNumber: "identifier",
  },
  InvoiceCollectionItem: {
    source: "business",
    externalId: "identifier",
    fileName: "freeText",
    sha256: "identifier",
    verdict: "business",
    documentId: "identifier",
  },
  InvoiceCollectionRun: {
    activeKey: "business",
    errorCode: "business",
    rulesVersion: "business",
  },
  IncomingSupplierDocument: {
    gmailMessageId: "identifier",
    fileName: "freeText",
    sender: "email",
    subject: "freeText",
    sha256: "identifier",
    content: "fileContent",
    errorCode: "business",
    importResult: "json",
    textReading: "json",
    lineSuggestions: "json",
    payeeCheck: "business",
    payeeMarkedByUserId: "identifier",
    origin: "business",
    uploadKind: "business",
    uploadedByUserId: "identifier",
    reviewState: "business",
    suggestionDecisionRunId: "identifier",
    reviewedByUserId: "identifier",
  },
  SupplierInvoiceMailMessage: {
    gmailMessageId: "identifier",
    sender: "email",
    subject: "freeText",
    errorCode: "business",
  },
  SupplierInvoiceMailSyncRun: {
    activeKey: "business",
    errorCode: "business",
  },
  BankAccount: {
    accountNumber: "ownCompany",
    currency: "business",
    name: "ownCompany",
  },
  BankStatementImport: {
    fileName: "freeText",
    sha256: "identifier",
    importedByUserId: "identifier",
  },
  SzamlazzFeedMessage: {
    kind: "business",
    externalId: "identifier",
    sha256: "identifier",
    body: "rawMessage",
  },
  ExternalBillingDocument: {
    source: "business",
    externalId: "identifier",
    feedMessageId: "identifier",
    kindCode: "business",
    documentNumber: "identifier",
    paymentMethod: "business",
    paymentMethodUnified: "business",
    orderNumber: "identifier",
    currency: "business",
    customerName: "partyName",
    customerTaxNumber: "partyTaxNumber",
    customerAddress: "streetAddress",
    lines: "json",
    payments: "json",
    pdfStorageKey: "storageReference",
    pdfMissingReason: "business",
    externalPaymentStatus: "business",
    ebizExternalId: "identifier",
  },
  EbizSyncRun: {
    activeKey: "business",
    errorCode: "business",
  },
  IncomingBillingDocument: {
    source: "business",
    externalId: "identifier",
    feedMessageId: "identifier",
    kindCode: "business",
    documentNumber: "identifier",
    paymentMethod: "business",
    currency: "business",
    exchangeBank: "business",
    supplierName: "partyName",
    supplierTaxNumber: "partyTaxNumber",
    supplierEuTaxNumber: "partyTaxNumber",
    supplierAddress: "streetAddress",
    supplierBankAccount: "bankAccount",
    buyerName: "ownCompany",
    buyerTaxNumber: "ownCompany",
    lines: "json",
    vatSummary: "json",
    payments: "json",
    note: "freeText",
    orderNumber: "identifier",
    referencedInvoiceNumber: "identifier",
    referencedProformaNumber: "identifier",
    sourceDocumentId: "identifier",
  },
  BankTransactionSourceKey: {
    key: "identifier",
  },
  BankTransaction: {
    currency: "business",
    counterpartyAccount: "bankAccount",
    counterpartyName: "partyName",
    narrative: "freeText",
    transactionType: "business",
    transactionKey: "identifier",
    comment: "freeText",
    categoryOverride: "business",
    paperOriginalByUserId: "identifier",
  },
  BankTransactionMatch: {
    documentSource: "business",
    documentId: "identifier",
    pairedByUserId: "identifier",
  },
  UserDashboardLayout: {
    widgets: "business",
  },
  ProductEnrichmentRun: {
    errorCode: "business",
  },
  ProductEnrichmentRunProduct: {
    errorCode: "business",
  },
  ProductEnrichmentSourceFetch: {
    sourceKind: "business",
    url: "business",
    reason: "business",
  },
  ProductEnrichmentFieldResult: {
    field: "business",
    tier: "business",
    status: "business",
    value: "business",
    sourceType: "business",
    sourceRef: "business",
    currentValue: "business",
    evidence: "business",
    conflicts: "business",
  },
  ProductKnowledgeFact: {
    scopeKey: "business",
    field: "business",
    value: "business",
    unit: "business",
    status: "business",
  },
  ProductCopy: {
    body: "business",
    basedOn: "business",
    usedFields: "business",
  },
  ServiceDraftMail: {
    source: "business",
    mailbox: "ownCompany",
    messageId: "identifier",
    subject: "freeText",
    originalText: "rawMessage",
  },
  ServiceTicketDraft: {
    source: "business",
    mailbox: "ownCompany",
    fingerprint: "identifier",
    repeatKey: "identifier",
    originalProblem: "freeText",
    reporterPersonName: "personName",
    title: "freeText",
    proposedDepartmentId: "identifier",
    decidedById: "identifier",
    acceptedServiceJobId: "identifier",
    repeatedFromId: "identifier",
    jevClass: "business",
    decisionRunId: "identifier",
  },
  ServiceDraftAttachment: {
    fileName: "freeText",
    contentType: "business",
    content: "fileContent",
    sha256: "identifier",
  },
  Conversation: {
    title: "freeText",
    description: "freeText",
    directKey: "identifier",
    contextType: "business",
    contextId: "identifier",
    lastMessageId: "identifier",
  },
  AssistantConversationThread: {
    threadId: "identifier",
  },
  ConversationMember: {
    lastReadMessageId: "identifier",
  },
  Message: {
    text: "freeText",
    clientMessageId: "identifier",
    assistantSource: "business",
    assistantThreadId: "identifier",
  },
  CashRegister: {
    apNumber: "ownCompany",
  },
  CashRegisterFile: {
    fileName: "freeText",
    validationCode: "business",
    payloadGzip: "fileContent",
    payloadSha256: "identifier",
  },
  CashRegisterReceipt: {
    apNumber: "ownCompany",
    receiptNumber: "identifier",
    paymentMeans: "business",
    payments: "business",
    navCheckCode: "business",
  },
  CashRegisterReceiptLine: {
    name: "business",
    vatCode: "business",
  },
  CashRegisterGap: {
    reason: "freeText",
  },
  CashRegisterSyncRun: {
    activeKey: "business",
    trigger: "business",
    errorCode: "business",
  },
  MessageAttachment: {
    fileName: "freeText",
    contentType: "business",
    sha256: "identifier",
    storageKey: "storageReference",
    thumbnailKey: "storageReference",
  },
  MessageReaction: {
    reaction: "business",
  },
  WebshopOrderStaleThreshold: {
    status: "business",
    updatedByUserId: "identifier",
  },
  WebshopOrderNote: {
    orderId: "identifier",
    text: "freeText",
    updatedByUserId: "identifier",
  },
  WebshopTransferReceipt: {
    orderId: "identifier",
    proformaId: "identifier",
    bankTransactionId: "identifier",
    reference: "freeText",
    currency: "business",
    recordedByUserId: "identifier",
  },
  WebshopParcel: {
    commerceOrderId: "identifier",
    carrier: "business",
    reference: "identifier",
    parcelNumber: "parcelNumber",
    carrierParcelId: "parcelNumber",
    size: "business",
    createdByUserId: "identifier",
  },
  MortalityRecord: {
    recordNumber: "identifier",
    productName: "business",
    sourceNote: "freeText",
    note: "freeText",
  },
  MortalityLocation: {
    name: "business",
  },
  MortalityRecordDocument: {
    fileName: "freeText",
    contentType: "business",
    sha256: "identifier",
    content: "fileContent",
    storageKey: "storageReference",
    thumbnail: "fileContent",
    caption: "freeText",
  },
  Quote: {
    quoteNumber: "identifier",
    title: "freeText",
    closeNote: "freeText",
  },
  QuoteVersion: {
    currency: "business",
    priceDisplay: "business",
    customerSnapshot: "json",
    pdfStorageKey: "storageReference",
    pdfSha256: "identifier",
  },
  QuoteBlock: {
    title: "freeText",
    content: "json",
  },
  QuoteItem: {
    name: "business",
    description: "json",
    unit: "business",
  },
  QuoteBomItem: {
    customName: "business",
    unit: "business",
    costCurrency: "business",
    supplierSku: "business",
    internalNote: "freeText",
  },
  QuotePaymentMilestone: {
    label: "business",
  },
  QuoteTemplate: {
    name: "business",
    blocks: "business",
    milestones: "business",
    priceDisplay: "business",
  },
  QuoteSnippet: {
    name: "business",
    content: "business",
    milestones: "business",
  },
  QuoteAcceptance: {
    acceptedByName: "personName",
    acceptedByEmail: "email",
    selectedOptionalItemIds: "identifier",
    note: "freeText",
    requestId: "identifier",
    revokeReason: "freeText",
  },
  QuoteAcceptanceLink: {
    tokenHash: "secret",
  },
  QuoteProjectHandoff: {
    planHash: "identifier",
    plan: "json",
  },
  QuoteMailDelivery: {
    recipients: "json",
    subject: "freeText",
    outcome: "business",
    error: "freeText",
    requestId: "identifier",
    redirectedTo: "ownCompany",
  },
  QuoteEvent: {
    payload: "json",
  },
  IncomingDocumentReading: {
    supplierName: "partyName",
    supplierTaxNumber: "partyTaxNumber",
    supplierEuTaxNumber: "partyTaxNumber",
    documentNumber: "identifier",
    currency: "business",
    sources: "json",
    warnings: "json",
    incomingBillingDocumentId: "identifier",
  },
  AttributeDefinition: {
    key: "business",
    label: "business",
    canonicalUnit: "business",
    validation: "business",
  },
  AttributeEnumValue: {
    value: "business",
    label: "business",
  },
  AttributeSet: {
    key: "business",
    name: "business",
  },
  AttributeSetAttribute: {
    group: "business",
  },
};
