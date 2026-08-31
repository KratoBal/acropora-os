/**
 * WHO OWNS A PRODUCT'S MASTER DATA, AND WHY A VARIANT NEVER ANSWERS FOR ITSELF.
 *
 * `catalogAuthority` lives on the Product and only there. A ProductVariant has
 * no authority of its own: **its master is always its parent Product's
 * `catalogAuthority`.** The rule is written here so that it exists in one
 * place, rather than being re-derived by an equality check at every call site.
 *
 * THE MISTAKE THIS PREVENTS IS SPECIFIC, AND IT IS AVAILABLE TODAY. A variant
 * carries UNAS mirror columns - `unasBaseSku`, `unasVariantKey`,
 * `unasVariantValues`, `unasReportedStock` - which the UNAS import writes and
 * which SURVIVE an authority takeover on purpose, as migration history. They
 * are therefore present on variants of products we now own, and reading
 * ownership off their presence would answer "UNAS" for a product that is ours.
 * Nothing here looks at them, and nothing that decides ownership may.
 *
 * THE THIRD STATE IS REAL AND IS NOT A BUG. `catalogAuthority` is nullable: a
 * product may have no authority set at all. That is not "ours" and not
 * "theirs", and the two predicates below both answer false for it, so a null
 * can never be mistaken for a decision. Call sites that must act on the
 * unknown case have to say so themselves; what they may not do is let `!==
 * "UNAS"` quietly mean "ACROPORA".
 */

export type CatalogAuthority = "UNAS" | "ACROPORA";

/** Anything that carries the authority. Deliberately structural and narrow. */
export type AuthorityBearingProduct = {
  catalogAuthority?: CatalogAuthority | null;
};

/**
 * Anything that hangs off a product. Only the parent is read - a variant's own
 * columns are never consulted, which is the rule this module exists to hold.
 */
export type AuthorityBearingVariant = {
  product: AuthorityBearingProduct | null | undefined;
};

export const resolveProductCatalogAuthority = (
  product: AuthorityBearingProduct | null | undefined,
): CatalogAuthority | null => product?.catalogAuthority ?? null;

/** The inheritance rule itself: the variant's master is the product's master. */
export const resolveVariantCatalogAuthority = (
  variant: AuthorityBearingVariant | null | undefined,
): CatalogAuthority | null => resolveProductCatalogAuthority(variant?.product);

export const isUnasMasteredProduct = (
  product: AuthorityBearingProduct | null | undefined,
): boolean => resolveProductCatalogAuthority(product) === "UNAS";

export const isAcroporaMasteredProduct = (
  product: AuthorityBearingProduct | null | undefined,
): boolean => resolveProductCatalogAuthority(product) === "ACROPORA";

export const isUnasMasteredVariant = (
  variant: AuthorityBearingVariant | null | undefined,
): boolean => resolveVariantCatalogAuthority(variant) === "UNAS";

export const isAcroporaMasteredVariant = (
  variant: AuthorityBearingVariant | null | undefined,
): boolean => resolveVariantCatalogAuthority(variant) === "ACROPORA";
