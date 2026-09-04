export interface UnasApiProduct {
  externalId: string;
  sku: string;
  name: string;
  state: "live" | "deleted";
  externalStatus: string | null;
  /** UNAS `Inquire`: listed, but only requestable for quotation. */
  inquireOnly?: boolean | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  descriptionShort: string | null;
  descriptionLong: string | null;
  /**
   * WHAT UNAS CLAIMS ABOUT ITS OWN TEXT, AND WHY THAT IS NOT THE TEST.
   *
   * These two are copied from `Description.ShortIsHtml` / `LongIsHtml` exactly
   * as the source sends them. They are not a measurement of the content, and a
   * cleaner that trusts them is wrong in one direction, silently.
   *
   * Measured 2026-08-28 over the 1893 product export:
   *
   * | field | flag says HTML | flag says plain, text holds tags |
   * |-------|----------------|----------------------------------|
   * | short | 505, all true  | 774 of 884 (87.6%)               |
   * | long  | 242, all true  | 47 of 106 (44.3%)                |
   *
   * The error is ONE-DIRECTIONAL: there is not a single case, on either field,
   * where the flag claims HTML over text that holds no tags. So a TRUE value
   * can be trusted; a FALSE value on the short description carries almost no
   * information.
   *
   * `null` means the response carried no description block at all - never that
   * the source was undecided.
   *
   * The date is part of the claim: these are counts over one export, not a
   * property of the source. If somebody measures again and gets something else,
   * the catalogue changed - re-measure, and move the date with the numbers.
   *
   * To find out whether a text holds markup, look at the text: `plainText` in
   * `ai-product-search.text.ts` does exactly that, and its own header records
   * why.
   */
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
  /**
   * The shop's claim, renamed on the way in.
   *
   * It arrives as `StockStatus.Empty` - a STATE - and is carried under a name
   * that reads as a RULE. Same family as the two HTML flags: the field name
   * sounds like something we measured, and it is something the source said.
   * `null` means the source said nothing, which is not the same as "no".
   */
  backorderAllowed: boolean | null;
  /**
   * The shop's claim, from `StockStatus.Variant`. Nothing reads it today.
   * "Enabled" sounds like a setting of ours; it is not.
   */
  variantStockEnabled: boolean | null;
  reportedStock: string | null;
  /** Main-warehouse stock rows for every UNAS variant combination. Empty
   * for products without variant-level stock management. The order of
   * values is the order UNAS requires in setStock. */
  variantStocks: UnasApiVariantStock[];
  isPackageProduct: boolean;
  packageComponents: UnasPackageComponent[];
  /** A "hasonlo termekek" hivatkozasai, a forras sorrendjeben. */
  similarProducts: UnasSimilarProduct[];
  /**
   * HANY HIVATKOZAST HAGYTUNK KI, mert nem volt azonosithato (`Id` nelkul).
   *
   * KULON SZAM, ES NEM CSAK ELOVIGYAZATOSSAG. Egy nemán eldobott hivatkozas
   * pontosan ugy nez ki, mint egy termek, aminek nincs is kapcsolata -- es
   * senki nem keresne. A szam teszi megszamolhatova, hogy a lanc vegen a
   * "hany kapcsolat veszett el" kerdesre valasz legyen, ne becsles.
   *
   * MERVE: a mai exporton NULLA ilyen van (18 499 / 18 499 visel `Id`-t),
   * tehat ez a szamlalo ma minden termeken 0. Azert all itt megis, mert a
   * nulla a FORRAS mai allapota, nem a kod garanciaja.
   */
  similarProductsSkipped: number;
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
  /**
   * A KOMBINACIO FELARA, BRUTTO, VAGY `null`, HA NINCS.
   *
   * A UNAS a felarat nem a keszlet-soron kuldi, hanem a TENGELY-DEFINICIOBAN:
   * `Variants.Variant.Values.Value` alatt, `ExtraPrice` neven, ertekenkent. Ez
   * a mezo az a szam, ami EBBEN a kombinacioban osszeadodik -- tobb tengely
   * eseten a valasztott ertekek felarainak osszege.
   *
   * MERVE (nautilus, 2026-09-04, a 2026-09-03-i exporton, 1893 termek): kilenc
   * terméknek van tengely-blokkja, mind EGY tengelyes, tizennyolc
   * kombinacioval, es EGYETLEN ertek visel felarat (a `5902026731119cs`
   * "Flakon" erteke, 150). A tobbtengelyes osszeadas tehat MA nem all elo --
   * azert igy van megirva, mert a forras szerkezete ezt engedi, es egy
   * "csak az elso tengely szamit" alak csendben veszitene el a masodikat.
   *
   * AMIERT KULON MEZO, ES NEM A `values` ELEMEIN: a `UnasVariantValue` a
   * getStock valaszaban is szerepel, ahol se tengely-nev, se felar nem letezik.
   * Egy ott ertelmezhetetlen mezo azt sugallna, hogy a hianya adat -- pedig
   * csak az a felulet nem hordozza.
   *
   * A `null` NEM nulla: azt jelenti, hogy ehhez a kombinaciohoz a forras nem
   * rendelt felarat. A ketto azert nem ugyanaz, mert egy kesobbi olvaso a
   * nullat MERT ertekként olvasna.
   */
  extraGrossPrice: string | null;
}

export interface UnasPackageComponent {
  sku: string;
  qty: string;
}

/**
 * A HASONLO TERMEKEK EGY HIVATKOZASA.
 *
 * HAROM MEZO, ES AZ ELSO A LENYEG. A UNAS az `Id` mezoben a CELPONT sajat
 * azonositojat kuldi -- nem cikkszamot --, tehat a feloldas nem fugg attol,
 * hogy a cikkszam irasmodja egyezik-e.
 *
 * MERVE (nautilus, 2026-09-04, a 2026-09-03-i API-exporton, 1893 termek):
 * 18 499 hivatkozas, es MIND A 18 499 visel `Id`-t ES `Sku`-t is. A cikkszam
 * alapu feloldas ugyanezen a halmazon 336 esetben csak kis-nagybetuben egyezne
 * -- vagyis az Id-alapu ut ezt a 336-ot eleve nem is latja problemanak.
 *
 * A `sku` es a `name` megis benne marad: a cikkszam az EMBERNEK szolo
 * azonosito a jelentesekben, a nev pedig az egyetlen dolog, amibol egy
 * gazdatlan hivatkozas utolag felismerheto.
 */
export interface UnasSimilarProduct {
  /** A CELPONT UNAS-azonositoja. Ez a feloldas kulcsa. */
  externalId: string;
  sku: string;
  name: string | null;
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
