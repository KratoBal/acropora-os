import type { ContentState } from "./content-state.js";

/**
 * THE STATES IN WHICH AN ARTICLE BODY MAY CHANGE: the author's and the
 * reviewer's. From `AWAITING_APPROVAL` on the text is under (or past) the
 * approver's eye, and a change there would reach the public unapproved; to
 * change it, the item goes back to `AWAITING_REVISION` first (an existing move).
 *
 * Its own module, a leaf: the article repository and the knowledge base's
 * citations both read it, and the article's approval step calls the
 * citation check, so the two may not import each other for it.
 */
export const ARTICLE_EDITABLE_STATES: readonly ContentState[] = [
  "IDEA",
  "DRAFTING",
  "AWAITING_REVIEW",
  "AWAITING_REVISION",
];
