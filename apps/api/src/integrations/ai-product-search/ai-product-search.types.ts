/**
 * What one product looks like when it travels to the AI.
 *
 * This is the VERSIONED search projection Balazs's decision asks for, in its
 * first shape. Three rules decided what is in it, and each of them came from
 * a measurement rather than from taste.
 *
 * **1. The source is the raw UNAS snapshot, not our own mirror.** The long
 * description, the parameters and the images live there; the mirror carries
 * only a short description. A projection built on the mirror would silently
 * lose most of what the model could say.
 *
 * **2. Price and stock are STRUCTURED fields, never text.** What a model
 * receives as prose it will rephrase: "12 900 Ft" comes back as "around 13
 * thousand", rounded, or in the wrong currency. A structured field the
 * surface renders is not rephrased by anyone. The argument holds even if the
 * price never changes - it is about the nature of text, not about staleness.
 *
 * **3. The freshness travels with the data.** `lastSyncedAt` and
 * `mirrorState` are part of the projection, because a search result that
 * cannot say how old it is turns a stopped sync into a confident answer.
 *
 * And one thing that is deliberately ABSENT: nothing from `ProductExtension`.
 * That table sits next to the product and holds purchase price and preferred
 * supplier. Whatever enters this projection must be treated as spoken aloud,
 * and those two must never be.
 *
 * **A second absence, recorded here because until now nothing recorded it.**
 * `UnasProductSnapshot` - the table this projection reads from - carries three
 * URL columns: `productUrl` and `sefUrl` (our own shop page) and
 * `manufacturerUrl` (the maker's site). None of them travels, and that is not
 * an oversight to be tidied up later: what the model receives it may repeat,
 * and whether this assistant hands out a link at all is an open business rule
 * rather than a field mapping.
 *
 * `productUrl` in particular is the obvious next addition - a surface will
 * want to link to the product - so the absence needs a sentence rather than
 * silence. **Adding any of the three is a decision against that rule, not a
 * widening of the projection.** A test holds the current state, so the
 * conversation happens before the field does.
 */
export interface AiProductSearchHit {
  productId: string;
  /** The primary variant's SKU. Null when the product has no variant. */
  sku: string | null;
  name: string;
  brand: string | null;
  categories: string[];
  descriptionShort: string | null;
  descriptionLong: string | null;
  /** Raw UNAS parameter block, as stored. Shape is the source's, not ours. */
  parameters: unknown;
  variants: Array<{ sku: string; name: string | null }>;
  /**
   * Structured, never folded into the text. Null when the snapshot carries
   * no price at all - which is a different statement from "it is free".
   */
  price: {
    net: number | null;
    gross: number | null;
    currency: string | null;
  } | null;
  /**
   * Which number this is matters as much as the number itself, so the source
   * travels with it. The POS already answers "which one counts" in a fixed
   * order - our own stock first, then what UNAS reported - and this
   * projection follows that order rather than inventing a second one.
   */
  stock: {
    quantity: number | null;
    source: "acropora" | "unas" | "unknown";
  } | null;
  /** When this product was last written by the sync. */
  lastSyncedAt: string | null;
  /** ACTIVE, MISSING or CONFLICT - see `missingSince`. */
  mirrorState: string | null;
  /**
   * Set when the product has disappeared from UNAS. Present in the
   * projection on purpose: "we used to carry this, and have not since X" is
   * knowledge, and dropping it silently would throw that knowledge away.
   */
  missingSince: string | null;
}

/**
 * One search, and everything the surface needs to show what was used.
 *
 * The extra fields are not decoration. The internal test surface exists to
 * judge answers, and a judgement is only interpretable if the judge can see
 * what the answer was built from: which products, how many were left out, how
 * old the oldest one is, and which projection shape produced it.
 */
export interface AiProductSearchResult {
  /** Echoed back, so a stored judgement can be read without the request. */
  query: string;
  hits: AiProductSearchHit[];
  /**
   * How many products matched in total, which may exceed `hits.length`.
   * Without it, "no more results" and "we cut the list" look identical.
   */
  totalMatched: number;
  /**
   * The oldest `lastSyncedAt` among the hits. One number that answers "how
   * stale can this answer be at worst".
   */
  oldestSyncedAt: string | null;
  /** The shape version of this projection. */
  projectionVersion: string;
}
