export type ProductType = "PHYSICAL" | "SERVICE" | "LIVESTOCK";
export type ProductOrigin = "UNAS" | "LOCAL";
export type ProductCatalogAuthority = "UNAS" | "ACROPORA";

export interface ProductBrandSummary {
  id: string;
  name: string;
}

export interface ProductCategorySummary {
  id: string;
  name: string;
  isPrimary: boolean;
  sortOrder: number | null;
}

/**
 * A barcode belonging to one variant. Codes are unique across the whole
 * catalogue, not merely within a variant, so a scan resolves to exactly one
 * variant with no further context.
 */
export interface ProductBarcodeSummary {
  id: string;
  code: string;
  isPrimary: boolean;
}

export interface ProductVariantSummary {
  id: string;
  sku: string;
  name: string | null;
  unit: string;
  isActive: boolean;
  vatRate: string | null;
  manufacturerPartNumber: string | null;
  secondaryUnit: string | null;
  secondaryUnitFactor: string | null;
  unasBaseSku: string | null;
  unasVariantValues: Array<{ name: string; value: string }> | null;
  unasReportedStock: string | null;
  unasReportedStockSyncedAt: string | null;
  extension: import("./product-extension.js").ProductExtensionDetail | null;
  barcodes: ProductBarcodeSummary[];
}

export interface AddProductBarcodeInput {
  code: string;
  /** Defaults to true for a variant's first barcode, false afterwards. */
  isPrimary?: boolean;
}

export interface ProductBarcodeListResponse {
  variantId: string;
  items: ProductBarcodeSummary[];
}

export interface UnasProductMirrorDetail {
  source: "UNAS";
  state: "ACTIVE" | "MISSING" | "CONFLICT" | null;
  externalId: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  lastSyncedAt: string | null;
  missingSince: string | null;
  currency: string | null;
  netPrice: string | null;
  grossPrice: string | null;
  saleNetPrice: string | null;
  saleGrossPrice: string | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  priceDisplay: string | null;
  productUrl: string | null;
  manufacturerUrl: string | null;
  minimumOrderQuantity: string | null;
  maximumOrderQuantity: string | null;
  orderQuantityStep: string | null;
  lowStockThreshold: string | null;
  backorderAllowed: boolean | null;
  variantStockEnabled: boolean | null;
  reportedStock: string | null;
  reportedStockSyncedAt: string | null;
  isPackageProduct: boolean;
  packageComponents: Array<{ sku: string; qty: string }>;
}

export interface ProductImageSummary {
  id: string;
  url: string;
  sortOrder: number;
  altText: string | null;
  title: string | null;
}

export interface ProductChannelListingSummary {
  channel: "UNAS";
  externalStatus: string | null;
  isPublished: boolean;
  slug: string | null;
  productUrl: string | null;
  seoTitle: string | null;
  backorderAllowed: boolean;
}

export interface ProductListItem {
  id: string;
  name: string;
  productType: ProductType;
  origin: ProductOrigin | null;
  catalogAuthority: ProductCatalogAuthority | null;
  isActive: boolean;
  archivedAt: string | null;
  brand: ProductBrandSummary | null;
  primaryCategory: ProductCategorySummary | null;
  primarySku: string | null;
  thumbnail: ProductImageSummary | null;
  unasListing: ProductChannelListingSummary | null;
  /**
   * UNAS-mirrored list gross price. Null for a purely local product, which has
   * no snapshot at all.
   *
   * IT IS ALSO NON-NULL FOR A PRODUCT WE HAVE TAKEN OVER, and there the mirror
   * is FROZEN: the import stopped writing it at the takeover. Read `priceSource`
   * before quoting this number.
   */
  grossPrice: string | null;
  /** UNAS-mirrored sale gross price; null when there's no active discount. */
  saleGrossPrice: string | null;
  /**
   * WHERE THE TWO PRICES ABOVE CAME FROM.
   *
   * "unas" -- the mirror, still maintained by the import.
   * "unas_frozen" -- the mirror, frozen since the authority takeover. The number
   *   is the last one the shop had, not one of ours.
   * "none" -- no snapshot at all, so both prices are null.
   *
   * The detail screen names the same value `unasMirror.grossPrice`; the list has
   * no such name, so it carries the source instead.
   */
  priceSource: "unas" | "unas_frozen" | "none";
  /** Summed StockItem.onHand across warehouses and all active variants; null
   *  means no StockItem row exists yet (never counted/sold), which is
   *  distinct from a confirmed 0 in stock - see the stock-reconciliation
   *  logic for the same distinction. */
  stockOnHand: string | null;
}

/**
 * A termék üzleti mezői, amiket az Acropora OS felől szerkeszteni lehet.
 *
 * Csak az a három mező szerepel benne, aminek a tulajdonjoga átkerült:
 * `name`, `description`, `primaryCategoryId`. A tükör-könyvelési mezők
 * szándékosan hiányoznak, mert azok a szinkron tulajdonában maradnak, és a
 * szerver ezen az úton nem is írná őket.
 */
export interface ProductUpdateInput {
  name?: string;
  description?: string | null;
  primaryCategoryId?: string | null;
  /**
   * A SAJÁT webshopunkban megvásárolható-e. A felületen "Vásárolható".
   *
   * NEM azonos az `isActive` mezővel: az az archiválásról szól (a kereshetőség
   * fele), ez a megvehetőségről. A kettő alapértelmezése is ellentétes --
   * `isActive` igaz, ez hamis --, ezért egy új terméknél az egyik igen, a másik
   * nem. Ha valaha egy nevet kapnak, az a két fogalmat mossa össze.
   */
  webshopSellable?: boolean;
}

export interface ProductListResponse {
  items: ProductListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface ProductDetail extends ProductListItem {
  description: string | null;
  /**
   * A SAJÁT webshopunkban megvásárolható-e; a felületen "Vásárolható".
   *
   * A RÉSZLETES nézeten áll, nem a listán, és ez döntés: a lista ma az
   * `isActive`-ot mutatja "Aktív / Archivált" néven, és a kettő ellentétes
   * alapértelmezésű (`isActive` igaz, ez hamis). Egy listaoszlop, ami egy új
   * terméknél azonnal "nem"-et mutat, ott is magyarázatot kívánna, ahol a
   * kérdést fel sem tették.
   */
  webshopSellable: boolean;
  categories: ProductCategorySummary[];
  variants: ProductVariantSummary[];
  images: ProductImageSummary[];
  channelListings: ProductChannelListingSummary[];
  unasMirror: UnasProductMirrorDetail | null;
}

export interface CatalogOption {
  id: string;
  label: string;
}

export interface ProductListApiQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  active?: boolean;
  categoryId?: string;
  brandId?: string;
  /**
   * Only products listed on this channel.
   *
   * Listed, not published: a `ChannelListing` row is written for every product
   * the sync carries over, while `isPublished` is nobody's to write yet and is
   * false on every row. Filtering on publication would return nothing at all,
   * which is why the screen shows the channel's own status instead.
   */
  listedOn?: "UNAS";
}
