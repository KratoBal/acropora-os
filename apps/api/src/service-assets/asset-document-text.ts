import type { AssetDocumentText } from "@acropora/types";

import {
  PAGE_END_MARKER,
  pdfTextLines,
} from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import {
  OCR_PARTIAL_READING_TTL_MS,
  keepsReading,
  type OcrReading,
} from "./asset-document-ocr.js";

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
 *
 * WITH THE OCR SWITCH ON (`asset-document-ocr.ts`, card 126f9b92) a scan is read
 * as pictures instead, and the answer carries `ocr` (the notice that it is a
 * machine reading, the pages read, why it stopped). A file with its own text is
 * never sent to the OCR, and with the switch off nothing here changes.
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
  /**
   * `partialUntil`: set when the reading is a PARTIAL one the time budget cut (`stoppedBy: "time"`); the entry then expires, so a
   * short reading cut in a slow minute (3 of 20) does not stay short until a restart (barracuda on #2483). A complete reading,
   * a stop at the page limit and a failed read have none: they are the file's own (or are not kept at all).
   */
  private readonly entries = new Map<
    string,
    { reading: Promise<ReadText>; partialUntil: number | null }
  >();

  constructor(
    private readonly read: (
      bytes: Uint8Array,
    ) => Promise<string[]> = pdfTextLines,
    private readonly capacity = ASSET_DOCUMENT_TEXT_CACHE_ENTRIES,
    /** Reads a SCAN as pictures; `null` = the OCR is off. Called only for a file with pages and no text. */
    private readonly scan?: (bytes: Uint8Array) => Promise<OcrReading | null>,
    /** How long a partial reading stays; a complete one stays for good. Milliseconds. */
    private readonly partialTtlMs: number = OCR_PARTIAL_READING_TTL_MS,
    /** The clock, injected so the expiry is tested without waiting. */
    private readonly now: () => number = Date.now,
  ) {}

  /** The text layer first; only a scan (pages, no text) goes to the OCR. */
  private async readOne(content: Uint8Array): Promise<ReadText> {
    const plain = textFromLines(await this.read(content));
    if (plain.hasText || plain.pageCount === 0 || !this.scan) return plain;
    const reading = await this.scan(content);
    if (!reading) return plain;
    const read = textFromLines(reading.lines);
    return read.hasText
      ? { ...read, pageCount: plain.pageCount, ocr: reading.ocr }
      : { ...plain, ocr: reading.ocr };
  }

  async text(
    sha256: string | undefined,
    bytes: () => Promise<Uint8Array>,
  ): Promise<ReadText> {
    if (!sha256) return this.readOne(await bytes());
    const cached = this.entries.get(sha256);
    if (cached) {
      if (cached.partialUntil !== null && this.now() >= cached.partialUntil) {
        // an expired partial reading: ask again (a slow minute may have cut it short)
        this.entries.delete(sha256);
      } else {
        // Most recently used goes last, so the oldest is evicted first.
        this.entries.delete(sha256);
        this.entries.set(sha256, cached);
        return cached.reading;
      }
    }
    const reading = bytes().then((content) => this.readOne(content));
    const entry = { reading, partialUntil: null as number | null };
    this.entries.set(sha256, entry);
    // A failed read is not remembered: the next ask tries again. Neither is an OCR reading that stopped for a reason
    // that may not hold next time (memory, a busy reader, an error, a time stop with no page read); a stop at the page
    // limit is the file's own, and so is a partial reading the time budget cut (`keepsReading`).
    const forget = () => {
      if (this.entries.get(sha256) === entry) this.entries.delete(sha256);
    };
    reading.then((read) => {
      if (read.ocr && !keepsReading(read.ocr)) forget();
      // the clock starts when the partial reading is FINISHED, not when it was asked for (it ran for up to two minutes)
      else if (read.ocr?.stoppedBy === "time")
        entry.partialUntil = this.now() + this.partialTtlMs;
    }, forget);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    return reading;
  }
}
