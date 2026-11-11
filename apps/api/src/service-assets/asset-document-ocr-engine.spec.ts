import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";

import { PDFDocument } from "pdf-lib";

import { OCR_LIMITS, ocrPdf } from "./asset-document-ocr.js";
import { dropSharedWorker, realOcrDeps } from "./asset-document-ocr-engine.js";

/*
  THE REAL ENGINE, STARTED (card 126f9b92, acrobot 46667: "a test that catches exactly this break").

  The break: `tesseract.js` 7 loads `wasm-feature-detect` in its worker, and 1.10.0 of that package uses `import.source`, which Node
  22.23.3 and 22.23.4 refuse (`SyntaxError: Unexpected identifier 'source'`). The package is pinned to 1.8.0 in the root
  `package.json` (`pnpm.overrides`). Reading the override is half of the guard; the other half is that the worker really STARTS
  and reads a picture under the Node this suite runs on. A fake engine can never see this, which is why this file does not use one.

  The picture is a small committed fixture (`fixtures/ocr-szoveg.png`, generated text: `72555 Járókerék 0,45 kW`, no customer
  data). The path is the package root's (the compiled run executes from `test-dist/`), and every read is inside a test.
*/
const FIXTURE = "src/service-assets/fixtures/ocr-szoveg.png";

after(async () => {
  await dropSharedWorker();
});

describe("OCR engine (real tesseract.js)", () => {
  it("the root package.json pins wasm-feature-detect to 1.8.0 (the version Node 22 can parse)", () => {
    const root = JSON.parse(readFileSync("../../package.json", "utf8")) as {
      pnpm?: { overrides?: Record<string, string> };
    };
    assert.equal(root.pnpm?.overrides?.["wasm-feature-detect"], "1.8.0");
  });

  it(
    "the worker starts under this Node and reads the picture: the part number and the unit survive",
    { timeout: 120_000 },
    async () => {
      const engine = await realOcrDeps.engine();
      const text = await engine.recognize(
        new Uint8Array(readFileSync(FIXTURE)),
      );
      assert.match(text, /72555/);
      assert.match(text, /0,45/);
    },
  );

  it(
    "an image-only PDF goes end to end: pdfjs renders the page, the engine reads it, the lines carry the page marker",
    { timeout: 120_000 },
    async () => {
      const pdf = await PDFDocument.create();
      const image = await pdf.embedPng(readFileSync(FIXTURE));
      const page = pdf.addPage([595.28, 841.89]);
      page.drawImage(image, { x: 40, y: 600, width: 500, height: 89 });
      const reading = await ocrPdf(await pdf.save(), realOcrDeps, OCR_LIMITS);
      assert.equal(reading.ocr.pagesRead, 1);
      assert.equal(reading.ocr.stoppedBy, null);
      assert.match(reading.lines.join("\n"), /72555/);
    },
  );
});
