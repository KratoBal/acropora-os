import type { AssetDocumentOcr, AssetDocumentOcrStop } from "@acropora/types";

import { PAGE_END_MARKER } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";

/**
 * THE OCR OF A SCANNED ASSET DOCUMENT (card 126f9b92; Sutyerák #13; acrobot 46667: option A, tesseract.js).
 *
 * `asset-document-text.ts` reads the text LAYER of a PDF; a scan has none and answers `hasText: false`. This module reads the
 * pages as pictures instead. IT DOES NOT HOLD THE ENGINE ITSELF: the page source and the engine are passed in (`OcrDeps`), so
 * the limits below are tested with fakes, and the real tesseract.js and pdfjs live in `asset-document-ocr-engine.ts`.
 *
 * THE FOUR CONDITIONS OF THE DECISION, each in this file:
 *  - a SWITCH, off by default (`ASSET_DOCUMENT_OCR`, exactly `true`);
 *  - the result is MARKED (`ocr` with a notice): a machine reading is wrong in the places that matter (a measured sample read
 *    `l/óra` as `|/6ra`), so the caller says so;
 *  - LIMITS per page and in total, in time and in memory, and one page count: a 200 page scan must not hold the API;
 *  - ONE reading at a time (`OcrGate`), the others wait a little or answer "busy".
 */

/** The switch: exactly `true` turns the OCR on (off by default, like the Medusa switches). Read per call. */
export const ASSET_DOCUMENT_OCR_ENV = "ASSET_DOCUMENT_OCR";

export const isOcrEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env[ASSET_DOCUMENT_OCR_ENV] === "true";

/**
 * The limits. Constants, not settings: a setting nobody tuned is a limit nobody trusts, and every one of these is
 * measured or bounded by a measurement (2026-11-11, one page: render 1-3 s, recognition ~1 s, process peak 320-500 MB).
 */
export const OCR_LIMITS = {
  /** Pages read from one document; the rest is said out loud (`stoppedBy: "pages"`). */
  maxPages: 20,
  /** Render plus recognition of ONE page; past it the engine is dropped and the reading stops (`time`). */
  pageTimeoutMs: 30_000,
  /** The whole reading, from the first page; checked before each page (`time`). */
  totalTimeoutMs: 120_000,
  /** The process's resident memory, checked before each page (`memory`): the tesseract worker and the canvas live in it. */
  maxRssBytes: 1_200 * 1024 * 1024,
  /** Readings waiting behind the running one; the next one answers `busy`. */
  maxQueued: 2,
} as const;

export type OcrLimits = {
  [K in keyof typeof OCR_LIMITS]: number;
};

export const OCR_NOTICE =
  "Gépi szövegfelismerés (OCR) a szkennelt oldalakról: hibázhat, különösen számoknál, mértékegységeknél és ékezeteknél. " +
  "Fontos adatot az eredeti dokumentumon kell ellenőrizni.";

/** One recognised page: the text as the engine read it. */
export interface OcrEngine {
  recognize(picture: Uint8Array): Promise<string>;
  /** Drops the worker. The next `recognize` of a new engine starts a fresh one. */
  terminate(): Promise<void>;
}

/** The pages of one open document, as pictures. */
export interface OcrPages {
  pageCount: number;
  renderPage(pageNumber: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface OcrDeps {
  openPages(bytes: Uint8Array): Promise<OcrPages>;
  engine(): Promise<OcrEngine>;
  /** The process's resident memory, in bytes. */
  rss(): number;
  /** Milliseconds, monotonic enough for the limits. */
  now(): number;
}

export interface OcrReading {
  /** Reading-order lines with the page end markers, ready for `textFromLines`. */
  lines: string[];
  ocr: AssetDocumentOcr;
}

/** A reading that stopped for a reason that may not hold next time: the cache must not keep it. */
export const isTransientStop = (stop: AssetDocumentOcrStop | null): boolean =>
  stop === "time" || stop === "memory" || stop === "busy" || stop === "error";

/**
 * WHETHER THE TEXT CACHE KEEPS A READING (card 126f9b92, nautilus's stage measurement 2026-11-12).
 *
 * A finished reading and a stop at the page limit are the file's own, and are kept. A stop for time, memory, a busy reader or an
 * error may not hold next time, so those are forgotten: EXCEPT a stop for TIME that already read pages. On the stage one scanned
 * page takes about 6.7 s, so the 120 s budget ends the reading at page 17 or 18 of a 20 page scan: that is the file on this
 * machine, not a hiccup, and forgetting it made every opening of a long scan read for two minutes again (with 1.3 s main-thread
 * blocks per page). The kept answer still says what it is (`pagesRead` of `pagesTotal`, `stoppedBy: "time"`, the notice), and the
 * cache is in memory: a restart, or eviction by 32 newer files, reads the file again.
 *
 * A time stop with NO page read is forgotten (nothing worth keeping, and a stuck first page may be a stuck worker); a memory stop
 * is forgotten even with pages read (the pressure may be gone), as a busy reader and an error are.
 */
export const keepsReading = (ocr: AssetDocumentOcr): boolean =>
  !isTransientStop(ocr.stoppedBy) ||
  (ocr.stoppedBy === "time" && ocr.pagesRead > 0);

class PageTimeout extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    // Not unref'd: while a page is being read the timer is what ends it, and it is cleared the moment the page is done.
    timer = setTimeout(() => reject(new PageTimeout()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The reading itself. Pages are read one after the other; before EACH page the total time and the memory are checked, and
 * each page has its own time limit. The first reason to stop wins and is named; pages read so far are kept.
 */
export async function ocrPdf(
  bytes: Uint8Array,
  deps: OcrDeps,
  limits: OcrLimits = OCR_LIMITS,
): Promise<OcrReading> {
  const pages = await deps.openPages(bytes);
  const lines: string[] = [];
  let pagesRead = 0;
  let stoppedBy: AssetDocumentOcrStop | null = null;
  try {
    const wanted = Math.min(pages.pageCount, limits.maxPages);
    const started = deps.now();
    const engine = await deps.engine();
    for (let pageNumber = 1; pageNumber <= wanted; pageNumber += 1) {
      if (deps.now() - started >= limits.totalTimeoutMs) {
        stoppedBy = "time";
        break;
      }
      if (deps.rss() > limits.maxRssBytes) {
        stoppedBy = "memory";
        break;
      }
      try {
        const text = await withTimeout(
          (async () => engine.recognize(await pages.renderPage(pageNumber)))(),
          limits.pageTimeoutMs,
        );
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) lines.push(trimmed);
        }
        lines.push(PAGE_END_MARKER);
        pagesRead += 1;
      } catch (error) {
        if (error instanceof PageTimeout) {
          // The worker may be stuck inside the page: drop it, a later reading starts a fresh one.
          await engine.terminate().catch(() => undefined);
          stoppedBy = "time";
          break;
        }
        throw error;
      }
    }
    if (stoppedBy === null && pages.pageCount > limits.maxPages)
      stoppedBy = "pages";
  } finally {
    await pages.close().catch(() => undefined);
  }
  return {
    lines,
    ocr: {
      pagesRead,
      pagesTotal: pages.pageCount,
      stoppedBy,
      notice: OCR_NOTICE,
    },
  };
}

/**
 * ONE READING AT A TIME. The tesseract worker and the canvas are heavy (320-500 MB measured, one core), and the readings run
 * in the API process next to the requests it serves. Waiting readings are few (`maxQueued`); beyond them the answer is `busy`
 * at once, and the caller can ask again: nothing piles up.
 */
export class OcrGate {
  private tail: Promise<unknown> = Promise.resolve();
  private active = 0;

  constructor(private readonly maxQueued: number = OCR_LIMITS.maxQueued) {}

  /** `null` means busy: the work did not run. */
  async run<T>(work: () => Promise<T>): Promise<T | null> {
    if (this.active >= 1 + this.maxQueued) return null;
    this.active += 1;
    const turn = this.tail.then(
      () => work(),
      () => work(),
    );
    this.tail = turn.catch(() => undefined);
    try {
      return await turn;
    } finally {
      this.active -= 1;
    }
  }
}

export const busyReading = (): OcrReading => ({
  lines: [],
  ocr: { pagesRead: 0, pagesTotal: 0, stoppedBy: "busy", notice: OCR_NOTICE },
});

export const failedReading = (): OcrReading => ({
  lines: [],
  ocr: { pagesRead: 0, pagesTotal: 0, stoppedBy: "error", notice: OCR_NOTICE },
});

/**
 * What the text cache calls for a scan. `null` = the OCR is off (the cache then behaves exactly as before, no `ocr` field).
 * An engine or render failure is NOT thrown: the caller still gets the scan answer plus `stoppedBy: "error"`, because a
 * broken OCR must not turn "this file is a scan" into "something broke".
 */
export function createScanReader(
  deps: OcrDeps,
  gate: OcrGate = new OcrGate(),
  env: () => NodeJS.ProcessEnv = () => process.env,
  limits: OcrLimits = OCR_LIMITS,
  onError: (error: unknown) => void = () => undefined,
): (bytes: Uint8Array) => Promise<OcrReading | null> {
  return async (bytes) => {
    if (!isOcrEnabled(env())) return null;
    try {
      const reading = await gate.run(() => ocrPdf(bytes, deps, limits));
      return reading ?? busyReading();
    } catch (error) {
      onError(error);
      return failedReading();
    }
  };
}
