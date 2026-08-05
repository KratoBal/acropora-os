export interface UnasApiProduct {
  externalId: string;
  sku: string;
  name: string;
  state: "live" | "deleted";
  externalStatus: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  descriptionShort: string | null;
  descriptionLong: string | null;
  descriptionShortIsHtml: boolean | null;
  descriptionLongIsHtml: boolean | null;
  unit: string | null;
  secondaryUnit: string | null;
  secondaryUnitFactor: string | null;
  manufacturerPartNumber: string | null;
  brandName: string | null;
  vatRate: string | null;
  netPrice: string | null;
  grossPrice: string | null;
  saleNetPrice: string | null;
  saleGrossPrice: string | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  priceDisplay: string | null;
  minimumOrderQuantity: string | null;
  maximumOrderQuantity: string | null;
  lowStockThreshold: string | null;
  orderQuantityStep: string | null;
  backorderAllowed: boolean | null;
  variantStockEnabled: boolean | null;
  reportedStock: string | null;
  /** Main-warehouse stock rows for every UNAS variant combination. Empty
   * for products without variant-level stock management. The order of
   * values is the order UNAS requires in setStock. */
  variantStocks: UnasApiVariantStock[];
  isPackageProduct: boolean;
  packageComponents: UnasPackageComponent[];
  productUrl: string | null;
  sefUrl: string | null;
  manufacturerUrl: string | null;
  primaryCategoryExternalId: string | null;
  alternativeCategoryExternalIds: string[];
  images: Array<{
    type: "base" | "alt";
    id: string | null;
    sefUrl: string | null;
    filename: string | null;
    alt: string | null;
  }>;
  parameters: Array<{
    id: string;
    type: string | null;
    name: string;
    value: string;
  }>;
  seo: {
    title: string | null;
    description: string | null;
    keywords: string | null;
    robots: string | null;
  };
  rawPayload: Record<string, unknown>;
}

export interface UnasVariantValue {
  name: string;
  value: string;
}

export interface UnasApiVariantStock {
  values: UnasVariantValue[];
  reportedStock: string;
}

export interface UnasPackageComponent {
  sku: string;
  qty: string;
}

/** One product-level base-stock snapshot returned by UNAS getStock. */
export interface UnasApiStock {
  externalId: string;
  sku: string;
  reportedStock: string;
  /** Empty for ordinary product-level stock, ordered values for a variant
   * combination. Axis names are unavailable in getStock and are therefore
   * intentionally blank there. */
  variantValues: UnasVariantValue[];
}

export interface UnasApiOrderItem {
  /** Special line ids (e.g. "shipping-cost", "discount-amount") have no SKU and aren't stock-relevant. */
  id: string;
  sku: string | null;
  name: string;
  unit: string | null;
  quantity: string;
  priceNet: string | null;
  priceGross: string | null;
  /** e.g. "27" (percent, "%" suffix already stripped). Null for non-stock lines without VAT. */
  vatRate: string | null;
  /** UNAS selectable properties in their numeric Id order. Optional only
   * for backwards-compatible test/fixture callers; the XML parser always
   * supplies it. */
  variants?: Array<{ id: string | null; name: string; value: string }>;
}

export interface UnasApiOrder {
  /** UNAS's own order handle (Key) - reassignable: per UNAS's own
   * "Adatszerkezet" docs, a previously deleted order's Key CAN be reissued
   * to a brand-new order later. Used for identification/lookup
   * (getOrderByKey, setOrder), and mirrored onto ExternalReference.externalKey -
   * never as the sole uniqueness anchor once an order may be deleted-but-
   * preserved locally (see `id` below). */
  key: string;
  /** UNAS's own genuinely stable, never-reassigned order identifier (GET
   * only - the docs explicitly say it can't be used for identification in
   * setOrder, only `key` can). This is what ExternalReference.externalId
   * stores from this checkpoint onward, specifically so a reused `key`
   * (see above) can never collide with - or silently overwrite - a
   * previously deleted order's preserved local record. Null only if a
   * response is missing the node entirely (not expected per the docs, but
   * parsed defensively). */
  id: string | null;
  internalKey: string | null;
  status: string | null;
  /** open_normal | open_prepare | close_ok | close_fault, when present. */
  statusType: string | null;
  statusId: string | null;
  /** Best-effort parse of the Date field; null if the format couldn't be recognized. */
  orderedAt: string | null;
  customerName: string | null;
  customerEmail: string | null;
  /**
   * UNAS Customer.Addresses.Invoice - the billing address, mirrored
   * read-only onto SalesOrder for display/reporting. taxNumber null for
   * consumers without one.
   */
  /** Customer.Addresses.Invoice.Name - the billing name. NOT the same as customerName (Customer.Contact.Name), which can be a different person. */
  buyerInvoiceName: string | null;
  buyerTaxNumber: string | null;
  /** Customer.Addresses.Invoice.EUTaxNumber - EU VAT number, when present. */
  buyerEuTaxNumber: string | null;
  /** Customer.Addresses.Invoice.CustomerType, raw UNAS enum value. */
  buyerCustomerType:
    "private" | "company" | "other_customer_without_tax_number" | null;
  buyerCountryCode: string | null;
  buyerZip: string | null;
  buyerCity: string | null;
  buyerAddress: string | null;
  currency: string | null;
  sumPriceGross: string | null;
  /** e.g. "Bankkártya", "Utánvét" - UNAS's own payment method name, for display only. */
  paymentName: string | null;
  /** e.g. bankcard | cod | transfer | ... - UNAS's own payment type code. */
  paymentType: string | null;
  /** e.g. "paid" | "unpaid" | "partly paid" | "overpaid" - free-text per UNAS docs, not a closed enum. */
  paymentStatus: string | null;
  /** e.g. "GLS", "FoxPost" - UNAS's own shipping/courier name, for display only. */
  shippingName: string | null;
  /** Coupon per the "Adatszerkezet" docs - the coupon code the buyer used, if any. Display/reporting only; the discount's financial effect is already captured via the order's discount-amount/discount-percent item lines. */
  couponCode: string | null;
  /**
   * UNAS's own Invoice.Status (0/1/2 per the "Adatszerkezet" docs), mapped
   * to a named tri-state - a dedicated field independent of Status/
   * StatusType above. The actual outgoing invoice is issued by UNAS's own
   * built-in Számlázz.hu module, never by Acropora OS; this is read-only
   * mirrored data only. Null if the Invoice node was absent from the
   * response (shouldn't normally happen, but treated as "unknown" rather
   * than assumed).
   */
  invoiceStatus: "NOT_BILLABLE" | "BILLABLE" | "BILLED" | null;
  /**
   * Invoice.Number per the "Adatszerkezet" docs - the human-readable
   * invoice number UNAS/Számlázz.hu assigned. Null until invoiceStatus
   * reaches BILLED (and even then only if UNAS actually reported one).
   */
  invoiceNumber: string | null;
  /**
   * Invoice.Url per the "Adatszerkezet" docs - a direct link to the PDF,
   * hosted by Számlázz.hu/UNAS, not Acropora OS. Never fabricated when
   * absent; a blank/missing value here must stay null, not become "".
   */
  invoiceUrl: string | null;
  items: UnasApiOrderItem[];
}

export interface UnasApiCategory {
  externalId: string;
  name: string;
  state: "live" | "deleted";
  parentExternalId: string | null;
  sortOrder: number | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  rawPayload: Record<string, unknown>;
}

/** Mirrors one of UNAS's Addresses.Invoice / Addresses.Shipping nodes. */
export interface UnasApiCustomerAddress {
  name: string | null;
  zip: string | null;
  city: string | null;
  street: string | null;
  country: string | null;
  countryCode: string | null;
  taxNumber: string | null;
  customerType:
    "private" | "company" | "other_customer_without_tax_number" | null;
}

export interface UnasApiCustomer {
  /** UNAS's own vásárló identifier, used for idempotency (ExternalReference.externalId). */
  externalId: string;
  email: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactMobile: string | null;
  invoiceAddress: UnasApiCustomerAddress | null;
  shippingAddress: UnasApiCustomerAddress | null;
  /** Dates.Registration, best-effort parsed. */
  sourceCreatedAt: string | null;
  /** Dates.Modification, best-effort parsed. */
  sourceUpdatedAt: string | null;
}

export interface CanonicalUnasProduct extends UnasApiProduct {
  canonicalHash: string;
}

export interface UnasProductIdentitySnapshot {
  productId: string;
  externalId: string;
  sku: string;
  canonicalHash: string | null;
  mirrorState?: "ACTIVE" | "MISSING" | "CONFLICT" | null;
}

export type UnasProductSyncAction =
  "CREATE" | "UPDATE" | "UNCHANGED" | "CONFLICT";

export interface UnasProductSyncDiff {
  product: CanonicalUnasProduct;
  action: UnasProductSyncAction;
  productId: string | null;
  reason:
    "NEW" | "HASH_CHANGED" | "SAME_HASH" | "IDENTITY_CONFLICT" | "RESTORE";
}
