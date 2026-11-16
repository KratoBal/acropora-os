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
  /**
   * The category's names from the root down to itself, as far as the list
   * loads them (the leaf and three ancestors). The list's image fallback
   * reads the group from it: the primary category is often a brand leaf
   * ("Fauna Marin" under "Nyomelemek"). Only on the list item.
   */
  path?: string[];
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
  /**
   * OUR OWN gross selling price (`ProductVariant.sellingGrossPrice`), with its
   * currency; both null or both set. It is the price once the catalogue
   * authority is ACROPORA; while UNAS owns the product it is normally empty and
   * the mirror's price holds. The billing editor reads it to pre-fill a line.
   */
  sellingGrossPrice: string | null;
  sellingPriceCurrency: string | null;
  /**
   * OUR OWN sale (T4.1-D3): the price and its half-open window `[startsAt,
   * endsAt)`, ISO timestamps; all three null or all three set. Only on an
   * ACROPORA product; while UNAS owns it, the mirror's sale holds.
   */
  sellingSaleGrossPrice: string | null;
  sellingSaleStartsAt: string | null;
  sellingSaleEndsAt: string | null;
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
  /** The VAT rate the shop states for the product, in percent. */
  vatRate: string | null;
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
  /** `WEBSHOP` (SEO P0 PR 5): a webshop saját sora, benne a termék slugja. */
  channel: "UNAS" | "WEBSHOP";
  externalStatus: string | null;
  isPublished: boolean;
  slug: string | null;
  productUrl: string | null;
  seoTitle: string | null;
  backorderAllowed: boolean;
}

/**
 * THE SHIPPING FLAGS OF A PRODUCT (card a82ed229): the four the UNAS sync fills, and the parcel-locker one that is
 * only set by hand. One list, so the product list's column, its filter and the API agree on the keys and the order.
 */
export const SHIPPING_FLAG_KEYS = [
  "pickupOnly",
  "foxpostForbidden",
  "isHeavy",
  "isFrozen",
  "lockerUnsuitable",
] as const;
export type ShippingFlagKey = (typeof SHIPPING_FLAG_KEYS)[number];

/** Short labels for a list cell and a filter option. */
export const SHIPPING_FLAG_SHORT_LABELS: Readonly<
  Record<ShippingFlagKey, string>
> = {
  pickupOnly: "Csak bolt",
  foxpostForbidden: "Foxpost tiltva",
  isHeavy: "Nehéz",
  isFrozen: "Fagyasztott",
  lockerUnsuitable: "Automatába nem fér",
};

/**
 * The list's shipping filter: one flag set; nobody has looked at the product yet; or a flag set by hand that differs
 * from what the product's UNAS data says (`unasDiff`, a82ed229 2d).
 */
export const SHIPPING_FILTER_VALUES = [
  ...SHIPPING_FLAG_KEYS,
  "none",
  "unasDiff",
] as const;
export type ShippingFilterValue = (typeof SHIPPING_FILTER_VALUES)[number];

export function isShippingFilterValue(
  value: string | null | undefined,
): value is ShippingFilterValue {
  return (SHIPPING_FILTER_VALUES as readonly string[]).includes(value ?? "");
}

/**
 * THE LIST'S HUSBANDRY FILTER (V2.2 S6, card d2fc06e7): of the LIVE ANIMALS, those whose husbandry block is verified, or those whose
 * block is not (no data at all, or entered and not verified). Either value restricts the list to live animals (the block has no
 * meaning on another product); the list says which are which through `ProductListItem.husbandry`.
 */
export const HUSBANDRY_FILTER_VALUES = ["verified", "unverified"] as const;
export type HusbandryFilterValue = (typeof HUSBANDRY_FILTER_VALUES)[number];

export function isHusbandryFilterValue(
  value: string | null | undefined,
): value is HusbandryFilterValue {
  return (HUSBANDRY_FILTER_VALUES as readonly string[]).includes(value ?? "");
}

/** What the list shows of a live animal's husbandry block: verified or not, and how many required fields are still missing. */
export interface ProductListHusbandry {
  verified: boolean;
  /** The required fields still missing, the verification itself and an undecidable kind included (as `missing` of the detail). */
  missing: number;
  /** True when the stored sting or venom fact says so: whoever works the list must not miss a hazard the product page shows. */
  hazard: boolean;
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
  /**
   * The shipping flags set on the product (a82ed229); `null` when nobody has looked at it yet (no profile), which is
   * not the same as an empty list (looked at, none applies). Optional: an older server does not send it.
   */
  shippingFlags?: ShippingFlagKey[] | null;
  /**
   * The husbandry block's state (V2.2 S6): `null` for a product that is not a live animal (the block has no meaning there);
   * optional: an older server does not send it. The kind comes from the PRIMARY category's root, so a product that sits under
   * several roots reads as the primary's here and as undecided on the detail screen (the detail is the exact one).
   */
  husbandry?: ProductListHusbandry | null;
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

/** The decision a product advisor helps a shopper make; null means no advisor. */
export type ProductAdvisorKind = "PLACEMENT" | "CAPACITY";

/** Katalogusadat az elhelyezesi szabalyhoz; NULL = nem szabad ajanlani. */
export type ElhelyezesiIgeny =
  "GYENGE" | "KOZEPES" | "EROS" | "NEM_ERTELMEZHETO";

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
  advisorKind?: ProductAdvisorKind | null;
  fenyIgeny?: ElhelyezesiIgeny | null;
  aramlasIgeny?: ElhelyezesiIgeny | null;
  /**
   * A NEVEK AZ ADATLAPON (kartya 20b0dd47, Balazs 2026-08-31): a magyar, az angol es a nemet nev, keresheto mezokent a
   * koralloknal es a gerinctelen allatoknal. Ures szoveg vagy `null`: a nev torlodik. Csak az OS-ben tarolodnak, a
   * webshop-vetitesbe nem mennek.
   */
  magyarNev?: string | null;
  angolNev?: string | null;
  nemetNev?: string | null;
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

/** Az elo allat fajtaja a kategoria-fabol (a harom gyoker egyike); a Nevek blokk a korallnal es a gerinctelennel jelenik meg. */
export type ProductLivestockKind = "FISH" | "INVERTEBRATE" | "CORAL";

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
  advisorKind: ProductAdvisorKind | null;
  fenyIgeny: ElhelyezesiIgeny | null;
  aramlasIgeny: ElhelyezesiIgeny | null;
  /** Az elo allat fajtaja a kategoria-fabol, vagy `null` (nem elo allat, vagy tobb gyoker alatt all). */
  livestockKind: ProductLivestockKind | null;
  /** A magyar, angol es nemet nev az adatlapon (`null`: nincs kitoltve). */
  magyarNev: string | null;
  angolNev: string | null;
  nemetNev: string | null;
  categories: ProductCategorySummary[];
  variants: ProductVariantSummary[];
  images: ProductImageSummary[];
  channelListings: ProductChannelListingSummary[];
  unasMirror: UnasProductMirrorDetail | null;
  /**
   * The image hosts the description may show (`RICH_TEXT_IMAGE_HOSTS`), the
   * SAME list the save cleans with, so the editor never offers and the preview
   * never shows an image the save would drop (as on the home page, #1877).
   * Only the detail endpoint sets it; absent reads as an empty list, which
   * passes no image: the safe direction.
   */
  descriptionImageHosts?: string[];
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
  /** one shipping flag set, or `none`: never looked at (a82ed229) */
  shipping?: ShippingFilterValue;
  /** Live animals with a verified (or an unverified) husbandry block (V2.2 S6). */
  husbandry?: HusbandryFilterValue;
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
