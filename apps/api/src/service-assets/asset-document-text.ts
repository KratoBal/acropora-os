import type { AssetDocumentText } from "@acropora/types";

import {
  PAGE_END_MARKER,
  pdfTextLines,
} from "../purchasing/supplier-invoice-import/pdf-text-lines.js";

/**
 * AN ASSET ATTACHMENT AS TEXT (Balázs, 2026-10-06 10:23 UTC: "tanitsuk").
 *
 * Sutyerák only saw the text fields of an asset, so a question answered by an
 * uploaded manufacturer's parts list (72555 impeller) stayed unanswered three
 * times. The download gives bytes; this gives the same file's text, read
 * with the reader the supplier-invoice import already uses.
 *
 * Only a PDF has text here. A photo has none, and a scanned PDF has none
 * either: that one comes back with `hasText: false`, not as an error, so the
 * caller can say "the file is a scan" instead of "something broke".
 */
export function isTextReadable(contentType: string): boolean {
  return contentType === "application/pdf";
}

/**
 * The largest file this reads. The upload stops at 10 MB; the margin is for
 * rows written before that limit, and the bound exists because the reader
 * holds the whole document in memory inside the API process.
 */
export const ASSET_DOCUMENT_TEXT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * The longest text returned. A parts list is a few thousand characters; a
 * 300-page manual is not something one answer needs whole, and the cut is
 * said out loud (`truncated`), never silent.
 */
export const ASSET_DOCUMENT_TEXT_MAX_CHARS = 200_000;

/** How many read documents stay in memory. */
export const ASSET_DOCUMENT_TEXT_CACHE_ENTRIES = 32;

type ReadText = Omit<AssetDocumentText, "documentId" | "fileName">;

export function textFromLines(
  lines: readonly string[],
  maxChars = ASSET_DOCUMENT_TEXT_MAX_CHARS,
): ReadText {
  const pageCount = lines.filter((line) => line === PAGE_END_MARKER).length;
  const full = lines.join("\n");
  const hasText = lines.some((line) => line !== PAGE_END_MARKER);
  return {
    pageCount,
    hasText,
    truncated: full.length > maxChars,
    text: full.length > maxChars ? full.slice(0, maxChars) : full,
  };
}

/**
 * Read texts, keyed by the file's sha256.
 *
 * The key is the CONTENT, not the document id: the bytes of a row never
 * change after upload, so a hit can never be stale. The access check is not
 * the cache's job and does not depend on it: the caller resolves the
 * document within the user's scope first, and only then asks here.
 *
 * A read in progress is shared, so two questions about the same file at once
 * parse it once.
 */
export class AssetDocumentTextCache {
  private readonly entries = new Map<string, Promise<ReadText>>();

  constructor(
    private readonly read: (
      bytes: Uint8Array,
    ) => Promise<string[]> = pdfTextLines,
    private readonly capacity = ASSET_DOCUMENT_TEXT_CACHE_ENTRIES,
  ) {}

  async text(
    sha256: string | undefined,
    bytes: () => Promise<Uint8Array>,
  ): Promise<ReadText> {
    if (!sha256) return textFromLines(await this.read(await bytes()));
    const cached = this.entries.get(sha256);
    if (cached) {
      // Most recently used goes last, so the oldest is evicted first.
      this.entries.delete(sha256);
      this.entries.set(sha256, cached);
      return cached;
    }
    const reading = bytes()
      .then((content) => this.read(content))
      .then((lines) => textFromLines(lines));
    this.entries.set(sha256, reading);
    // A failed read is not remembered: the next ask tries again.
    reading.catch(() => this.entries.delete(sha256));
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    return reading;
  }
}
