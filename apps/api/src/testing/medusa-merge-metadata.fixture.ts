/**
 * A copy of `mergeMetadata` from @medusajs/utils 2.20.1
 * (`dist/common/merge-metadata.js`), which the product repository's
 * `deepUpdate` applies to every product update: a key missing from the body
 * stays, and only an empty string removes one. Specs use it to assert the
 * shop's END STATE rather than our request body (measured 2026-10-08, #1624).
 */
export function medusaMergeMetadata(
  metadata: Record<string, unknown>,
  metadataToMerge: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...metadata };
  for (const [key, value] of Object.entries(metadataToMerge)) {
    if (value === "") {
      delete merged[key];
      continue;
    }
    merged[key] = value;
  }
  return merged;
}
