/**
 * THE UNAS PRODUCT STATUS IN WORDS (Picasso 3.19, acrobot 62278). `docs/M2.1-UNAS-API-DISCOVERY.md` names the four codes:
 * 0 inactive, 1 active, 2 active/new, 3 active/not purchasable. The raw code stays what is stored; this is display only.
 * A code the document does not name is shown as it is, never guessed.
 */
const UNAS_STATUS_WORDS: Readonly<Record<string, string>> = {
  "0": "Inaktív",
  "1": "Aktív",
  "2": "Aktív (új)",
  "3": "Aktív, nem vásárolható",
};

/** The words for a stored UNAS status code; an unknown code comes back unchanged, a missing one is `null`. */
export function unasStatusWords(
  code: string | null | undefined,
): string | null {
  if (code === null || code === undefined || code === "") return null;
  return Object.hasOwn(UNAS_STATUS_WORDS, code)
    ? UNAS_STATUS_WORDS[code]!
    : code;
}

/** The same with the raw code beside the words, for the detail card: `Aktív (1)`; an unknown code is just the code. */
export function unasStatusWithCode(code: string | null | undefined): string {
  const words = unasStatusWords(code);
  if (words === null) return "—";
  return words === code ? words : `${words} (${code})`;
}
