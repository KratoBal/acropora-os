/**
 * Turning a product description into something a model can read.
 *
 * The snapshot stores what UNAS sent, and what UNAS sends is often HTML. Left
 * as it arrives, the tags travel all the way into a model context: they cost
 * tokens, they read as noise, and `&nbsp;` is not a word in any language.
 *
 * **The flag is not the test, and that is the whole point of this file.** The
 * snapshot carries `descriptionShortIsHtml` and `descriptionLongIsHtml`, and
 * the obvious implementation cleans only when they say so. Measured on the
 * live catalogue (polip, 2026-08-27): **774 products claim plain text while
 * the content holds literal `<br>` and `<p>` tags**. Those flags are not our
 * measurement of the content - they are UNAS's statement about it, and they
 * are null when the response carried no description block at all. A cleaner
 * that trusts them is wrong 774 times, silently, in the direction that puts
 * markup in front of the model.
 *
 * So this looks at the content. A flag says what the source believed; the
 * text says what is there.
 */

/**
 * The version of this recipe.
 *
 * It travels with the projection because a stored judgement about an answer
 * is only interpretable if we know what the answer was built from - and how
 * the text was cleaned is part of that. When the rules below change, this
 * changes with them.
 */
export const AI_PRODUCT_SEARCH_TEXT_VERSION = "2026-08-27.1";

/**
 * Tags that end a line rather than sit inside one.
 *
 * Stripping every tag to nothing glues sentences together: a description
 * written as `<p>Elso sor</p><p>Masodik sor</p>` would come out as
 * "Elso sorMasodik sor", which is worse than the markup was. These become a
 * single newline before anything else is removed.
 */
const BLOCK_BOUNDARY =
  /<\s*\/?\s*(br|p|div|li|tr|h[1-6]|ul|ol|table)\b[^>]*>/gi;

/**
 * Anything else that looks like a tag.
 *
 * Deliberately requires a letter after the bracket, so arithmetic survives:
 * "5 < 10 mg" is not markup and must not be eaten.
 */
const TAG = /<\/?[a-zA-Z][^>]*>/g;

/**
 * The named entities that actually turn up; numeric forms are handled below.
 *
 * The accented half of this list is not padding. These are Hungarian product
 * descriptions, and a webshop editor's paste often carries `&oacute;` rather
 * than the letter. An undecoded `s&oacute;` reaches the model as three tokens
 * of noise where one word belongs - and `&odblac;` and `&udblac;` have no
 * Latin-1 equivalent, so nothing else in the chain would have caught them.
 */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  hellip: "...",
  ndash: "-",
  mdash: "-",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  ouml: "ö",
  odblac: "ő",
  uacute: "ú",
  uuml: "ü",
  udblac: "ű",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Ouml: "Ö",
  Odblac: "Ő",
  Uacute: "Ú",
  Uuml: "Ü",
  Udblac: "Ű",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, body: string) => {
      if (body.startsWith("#")) {
        const codePoint =
          body.startsWith("#x") || body.startsWith("#X")
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);

        /**
         * An unparseable or out-of-range reference is left as it stands rather
         * than replaced with a placeholder. A visible `&#999999;` is a bug
         * report; a silent question mark is not.
         */
        if (
          !Number.isFinite(codePoint) ||
          codePoint < 1 ||
          codePoint > 0x10ffff
        ) {
          return match;
        }

        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }

      /**
       * Matched exactly, never case-folded. `&Oacute;` and `&oacute;` are two
       * different characters, and lower-casing the lookup would quietly turn
       * every sentence-opening accented capital into a lowercase letter.
       */
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

/**
 * A description as plain text, or null when there is nothing left to say.
 *
 * Null rather than an empty string on purpose: "this product has no
 * description" and "this product has a description that is empty" are the
 * same thing to a reader, and the projection already uses null for absence.
 */
export function plainText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const withBreaks = value.replace(BLOCK_BOUNDARY, "\n");
  const withoutTags = withBreaks.replace(TAG, "");
  const decoded = decodeEntities(withoutTags);

  const collapsed = decoded
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return collapsed.length > 0 ? collapsed : null;
}
