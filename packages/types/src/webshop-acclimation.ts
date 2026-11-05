/**
 * THE ACCLIMATISATION SECTION OF THE ORDER CONFIRMATION (V2.6, card f4e4832b).
 *
 * A live animal's confirmation can carry a short guide for the first hours at
 * home. The guide differs by kind (a fish, an invertebrate and a coral are not
 * acclimatised the same way), so the shop sends the kinds of live animal in
 * each order (`livestock_kinds`, commerce #684) and this module turns them
 * into the template value `akklimatizacio`.
 *
 * === THE TEXTS ARE EMPTY ON PURPOSE, AND THAT IS THE FEATURE ===
 *
 * Nothing in the codebase may invent the shop's method or its durations: they
 * are the shop's to give, and the advice needs a professional check before it
 * goes next to a living animal (Korall's draft, `v-feluleti-szovegek.md`, V2.6,
 * marks both as open). Until the texts are put in the table below, the value is
 * EMPTY, and an empty value leaves no paragraph behind, so the mail is exactly
 * what it was. Filling the table is a small, separate change, reviewed as text.
 *
 * Two rules keep the section honest:
 * - a kind with no text adds nothing (a fish order never gets a coral's advice
 *   and never gets a gap that reads as advice);
 * - the English mail uses the English table only: a Hungarian guide is never
 *   sent to someone who ordered in English.
 */
export const WEBSHOP_LIVESTOCK_KINDS = [
  "FISH",
  "INVERTEBRATE",
  "CORAL",
] as const;
export type WebshopLivestockKind = (typeof WEBSHOP_LIVESTOCK_KINDS)[number];

export const isWebshopLivestockKind = (
  value: unknown,
): value is WebshopLivestockKind =>
  typeof value === "string" &&
  (WEBSHOP_LIVESTOCK_KINDS as readonly string[]).includes(value);

/** The guide per kind and language: a line break is a line break in the mail. */
export type WebshopAcclimationTexts = Readonly<
  Record<"hu" | "en", Readonly<Partial<Record<WebshopLivestockKind, string>>>>
>;

/**
 * EMPTY UNTIL THE SHOP'S METHOD AND DURATIONS AND THE PROFESSIONAL CHECK ARRIVE
 * (card f4e4832b, open questions 4). See the head of this file.
 */
export const WEBSHOP_ACCLIMATION_TEXTS: WebshopAcclimationTexts = {
  hu: {},
  en: {},
};

/**
 * The value `akklimatizacio` for the kinds of an order (or of both orders of a
 * mixed cart): one text per kind that has one, in the fixed kind order, kinds
 * repeated across orders counted once, separated by a blank line.
 */
export function webshopAcclimationValue(
  kinds: readonly WebshopLivestockKind[],
  locale: "hu" | "en",
  texts: WebshopAcclimationTexts = WEBSHOP_ACCLIMATION_TEXTS,
): string {
  const table = texts[locale];
  return WEBSHOP_LIVESTOCK_KINDS.filter((kind) => kinds.includes(kind))
    .map((kind) => table[kind]?.trim() ?? "")
    .filter((text) => text !== "")
    .join("\n\n");
}
