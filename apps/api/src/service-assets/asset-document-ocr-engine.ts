import { copyFileSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { OcrDeps, OcrEngine, OcrPages } from "./asset-document-ocr.js";

/**
 * THE REAL ENGINE BEHIND `asset-document-ocr.ts`: pdfjs renders a page to a picture, tesseract.js reads it (Hungarian and
 * English data). EVERYTHING HEAVY IS IMPORTED WHEN FIRST USED: with the switch off nothing here is ever loaded, so the API's
 * start and memory are what they were before the OCR.
 *
 * MEASURED (2026-11-11, `exchange-out/ocr-merese-2026-11-11.md`): a page rendered to ~1800x2500 px reads in about a second
 * with ~1 % character errors on a clean and a degraded sample; English only is 8 %, so BOTH languages load.
 *
 * `wasm-feature-detect` is PINNED TO 1.8.0 in the root `package.json` (`pnpm.overrides`): 1.10.0 uses `import.source`, a
 * syntax Node 22.23.3 and 22.23.4 refuse (`SyntaxError: Unexpected identifier 'source'`), and tesseract.js loads it in its
 * worker. `asset-document-ocr-engine.spec.ts` starts the real worker so that a break like that is a red test, not a scan
 * that silently stays unread.
 */

/** The target width of a rendered page, in pixels (an A4 page at about 220 dpi), and the most pixels one page may have. */
const TARGET_WIDTH_PX = 1800;
const MAX_PIXELS = 6_000_000;

/** An idle engine is dropped after this long: its memory goes back (the worker holds the language models). */
const IDLE_TERMINATE_MS = 60_000;

type TesseractWorker = {
  recognize(image: Uint8Array): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

/**
 * `langPath` of tesseract.js is ONE directory, and the two language packages are two: the two gzipped data files are copied
 * (about 6 MB) into one temporary directory, once per process.
 */
let dataDirectory: string | null = null;
function languageDirectory(): string {
  if (dataDirectory) return dataDirectory;
  const require = createRequire(import.meta.url);
  const directory = mkdtempSync(join(tmpdir(), "acropora-ocr-data-"));
  for (const language of ["hun", "eng"]) {
    const packageJson = require.resolve(
      `@tesseract.js-data/${language}/package.json`,
    );
    copyFileSync(
      join(
        dirname(packageJson),
        "4.0.0_best_int",
        `${language}.traineddata.gz`,
      ),
      join(directory, `${language}.traineddata.gz`),
    );
  }
  dataDirectory = directory;
  return directory;
}

let shared: { worker: Promise<TesseractWorker>; idle?: NodeJS.Timeout } | null =
  null;

async function sharedWorker(): Promise<TesseractWorker> {
  if (shared?.idle) clearTimeout(shared.idle);
  if (!shared) {
    const { createWorker } = await import("tesseract.js");
    const directory = languageDirectory();
    shared = {
      worker: createWorker(["hun", "eng"], 1, {
        langPath: directory,
        cachePath: directory,
        gzip: true,
        logger: () => undefined,
      }) as unknown as Promise<TesseractWorker>,
    };
    // A worker that failed to start must not stay the shared one.
    shared.worker.catch(() => {
      shared = null;
    });
  }
  return shared.worker;
}

function scheduleIdleTerminate(): void {
  if (!shared) return;
  if (shared.idle) clearTimeout(shared.idle);
  const current = shared;
  current.idle = setTimeout(() => {
    if (shared === current) shared = null;
    void current.worker
      .then((worker) => worker.terminate())
      .catch(() => undefined);
  }, IDLE_TERMINATE_MS);
  current.idle.unref?.();
}

export async function dropSharedWorker(): Promise<void> {
  const current = shared;
  shared = null;
  if (current?.idle) clearTimeout(current.idle);
  if (current)
    await current.worker
      .then((worker) => worker.terminate())
      .catch(() => undefined);
}

async function realEngine(): Promise<OcrEngine> {
  const worker = await sharedWorker();
  return {
    async recognize(picture) {
      try {
        const { data } = await worker.recognize(picture);
        return data.text;
      } finally {
        scheduleIdleTerminate();
      }
    },
    terminate: dropSharedWorker,
  };
}

async function realPages(bytes: Uint8Array): Promise<OcrPages> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: false,
  });
  const document = await loadingTask.promise;
  return {
    pageCount: document.numPages,
    async renderPage(pageNumber) {
      const page = await document.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(
        TARGET_WIDTH_PX / natural.width,
        Math.sqrt(MAX_PIXELS / (natural.width * natural.height)),
      );
      const viewport = page.getViewport({ scale });
      // pdfjs makes the canvas with the `@napi-rs/canvas` it already depends on (an optional dependency of pdfjs-dist).
      const factory = (
        document as unknown as {
          canvasFactory: {
            create(
              width: number,
              height: number,
            ): {
              canvas: { toBuffer(type: string): Uint8Array };
              context: unknown;
            };
            destroy(canvasAndContext: unknown): void;
          };
        }
      ).canvasFactory;
      const target = factory.create(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      try {
        await page.render({
          canvasContext: target.context,
          viewport,
          canvas: target.canvas,
        } as unknown as Parameters<typeof page.render>[0]).promise;
        return new Uint8Array(target.canvas.toBuffer("image/png"));
      } finally {
        factory.destroy(target);
        page.cleanup();
      }
    },
    async close() {
      await loadingTask.destroy();
    },
  };
}

/** The real dependencies of the OCR: what the API uses when the switch is on. */
export const realOcrDeps: OcrDeps = {
  openPages: realPages,
  engine: realEngine,
  rss: () => process.memoryUsage.rss(),
  now: () => Date.now(),
};
