import assert from "node:assert/strict";
import { randomFillSync } from "node:crypto";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { deflateSync } from "node:zlib";

import { PDFDocument } from "pdf-lib";

import {
  collectedPdfIds,
  collectedPdfIndex,
} from "../billing/incoming-collected-pdf.js";
import {
  convertInWorker,
  MAX_PNG_DECODED_BYTES,
  SCAN_CONCURRENCY,
  pngDecodedBytes,
  scanAsPdf,
  scanConversionLoad,
  ScanSlots,
  ScanTimedOut,
  ScanTooLarge,
  ScanUnreadable,
  scanWorkerError,
} from "./purchase-invoice-scan.js";

/** A 2×1 pixel PNG, built at run time (no binary fixture in the repo). */
async function tinyPng(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  void pdf;
  // a minimal valid PNG: signature, IHDR, IDAT, IEND
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQYGBgAKfwF+yHbvgAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}

describe("a scanned invoice (card 5ec62e35)", () => {
  it("a PNG becomes a one-page A4 PDF named after the file", async () => {
    const result = await scanAsPdf(await tinyPng(), "png", "szamla-lapja.png");
    assert.equal(result.fileName, "szamla-lapja.pdf");
    const pdf = await PDFDocument.load(result.bytes);
    assert.equal(pdf.getPageCount(), 1);
    const { width, height } = pdf.getPage(0).getSize();
    assert.deepEqual([Math.round(width), Math.round(height)], [595, 842]);
  });

  // MI PIROSÍT: ha a PDF a készítés idejét is hordozza, egy másodperc múlva
  // más bájt, más lenyomat lesz, és ugyanaz a kép két csatolmány
  it("the same image a second later is the same PDF, byte for byte", async () => {
    const first = await scanAsPdf(await tinyPng(), "png", "a.png");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await scanAsPdf(await tinyPng(), "png", "a.png");
    assert.equal(
      Buffer.from(second.bytes).equals(Buffer.from(first.bytes)),
      true,
      "SCAN-PDF-STABLE",
    );
  });

  it("a PDF is kept as it came", async () => {
    const source = await (await PDFDocument.create()).save();
    const result = await scanAsPdf(source, "pdf", "eredeti.pdf");
    assert.equal(result.bytes, source);
    assert.equal(result.fileName, "eredeti.pdf");
  });

  it("for one invoice key, the directly attached scan comes first", () => {
    const reading = {
      invoiceNumber: "2026-17",
      supplierTaxNumber: "12345678-2-42",
    };
    const index = collectedPdfIndex([
      {
        id: "older-mail",
        fileName: "a.pdf",
        createdAt: new Date("2026-10-01T00:00:00Z"),
        textReading: reading,
        importResult: null,
        purchaseInvoiceId: null,
      },
      {
        id: "attached-scan",
        fileName: "b.pdf",
        createdAt: new Date("2026-10-08T00:00:00Z"),
        textReading: reading,
        importResult: null,
        purchaseInvoiceId: "pi-1",
      },
    ]);
    assert.deepEqual(
      collectedPdfIds(
        {
          documentNumber: "2026-17",
          supplierTaxNumber: "12345678-2-42",
          sourceDocumentId: null,
        },
        index,
      ),
      ["attached-scan", "older-mail"],
    );
  });

  it("a small PNG that declares a giant canvas is refused before it is decoded", async () => {
    const giant = Uint8Array.from(await tinyPng());
    const view = new DataView(giant.buffer);
    view.setUint32(16, 100_000); // width
    view.setUint32(20, 100_000); // height: 10 000 MP declared
    assert.ok(100_000 * 100_000 * 4 > MAX_PNG_DECODED_BYTES);
    await assert.rejects(scanAsPdf(giant, "png", "x.png"), ScanTooLarge);
  });

  // MI PIROSÍT: a pixelszámra kötött korlát (40 MP) átengedi a 20 MP-s,
  // 16 bites RGBA képet, pedig dekódolva 160 MB (barracuda, acrobot 28131)
  it("the limit is the decoded size: a 16-bit RGBA under 25 MP is still too large", async () => {
    const deep = Uint8Array.from(await tinyPng());
    const view = new DataView(deep.buffer);
    view.setUint32(16, 5000); // width
    view.setUint32(20, 4000); // height: 20 MP
    deep[24] = 16; // bit depth
    deep[25] = 6; // RGBA
    await assert.rejects(
      scanAsPdf(deep, "png", "x.png"),
      ScanTooLarge,
      "BYTES-16BIT",
    );
  });

  it("what decoding costs: the raw size, never less than 8-bit RGBA", () => {
    const of = (bitDepth: number, channels: number) =>
      pngDecodedBytes({ width: 1000, height: 1000, bitDepth, channels });
    assert.deepEqual(
      [of(16, 4), of(8, 4), of(8, 3), of(8, 1), of(1, 1)],
      [8_000_000, 4_000_000, 4_000_000, 4_000_000, 4_000_000],
    );
    // an 8-bit scan of 24 MP passes, of 26 MP does not
    assert.ok(
      pngDecodedBytes({
        width: 6000,
        height: 4000,
        bitDepth: 8,
        channels: 3,
      }) <= MAX_PNG_DECODED_BYTES,
    );
    assert.ok(
      pngDecodedBytes({ width: 6500, height: 4000, bitDepth: 8, channels: 3 }) >
        MAX_PNG_DECODED_BYTES,
    );
  });

  it("a broken image behind a good signature is unreadable, not a crash", async () => {
    const png = await tinyPng();
    const broken = Uint8Array.from([...png.subarray(0, 33), 1, 2, 3, 4, 5]);
    await assert.rejects(scanAsPdf(broken, "png", "x.png"), ScanUnreadable);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
    await assert.rejects(scanAsPdf(jpeg, "jpeg", "x.jpg"), ScanUnreadable);
  });
});

/** CRC-32 of a PNG chunk's type and data. */
function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** A width × height 8-bit RGBA PNG of noise, built at run time. */
function noisePng(width: number, height: number): Uint8Array {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  randomFillSync(raw);
  for (let y = 0; y < height; y++) raw[y * stride] = 0; // filter: none
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 1 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/*
  OFF THE EVENT LOOP (card 35fe9a08): pdf-lib decodes and re-compresses a PNG
  synchronously, and a 25 MP scan held the API for 1.5 to 5 seconds. The test
  ticks a 5 ms timer while a 9 MP noise PNG converts: in the worker the longest
  gap is a small part of the conversion; on the main thread the two are equal.
  The conversion's own length is the positive control: a load too light to
  block would pass either way.
*/
describe("the scan conversion runs in a worker (card 35fe9a08)", () => {
  it("the event loop keeps ticking while a large PNG converts", async () => {
    const png = noisePng(3000, 3000);
    let last = performance.now();
    let longestGap = 0;
    const tick = setInterval(() => {
      const now = performance.now();
      longestGap = Math.max(longestGap, now - last);
      last = now;
    }, 5);
    const started = performance.now();
    try {
      const result = await scanAsPdf(png, "png", "nagy.png");
      const took = performance.now() - started;
      // the gap still open when the conversion returns: a loop blocked from
      // start to end never ran the timer at all, and would read as zero
      longestGap = Math.max(longestGap, performance.now() - last);
      assert.equal((await PDFDocument.load(result.bytes)).getPageCount(), 1);
      assert.ok(
        took > 200,
        `the conversion took ${took} ms, too light to tell`,
      );
      assert.ok(
        longestGap < took / 2,
        `the event loop stopped for ${longestGap} ms of ${took} ms`,
      );
    } finally {
      clearInterval(tick);
    }
  });

  /*
    Not a real out-of-heap run: when the worker's heap runs out depends on the
    garbage collector's timing, and the same 4 MB run passed alone and failed
    in the full suite. The mapping is what this code decides, so it is tested
    on the error Node raises (`ERR_WORKER_OUT_OF_MEMORY`).
  */
  it("a worker that runs out of heap is too large, not a crash", () => {
    const oom = Object.assign(new Error("out of memory"), {
      code: "ERR_WORKER_OUT_OF_MEMORY",
    });
    assert.ok(scanWorkerError(oom, 256) instanceof ScanTooLarge);
    const other = new Error("something else");
    assert.equal(scanWorkerError(other, 256), other);
  });

  it("the caller's bytes stay usable after the transfer", async () => {
    const png = await tinyPng();
    const before = Uint8Array.from(png);
    await convertInWorker(png, "png");
    assert.deepEqual(png, before);
  });
});

/*
  BARRACUDA'S #1645 REVIEW: the pixels live outside the worker's heap, so
  concurrent uploads add up, and a worker that never answers would keep the
  request open forever.
*/
describe("scan conversions are bounded (card 35fe9a08)", () => {
  it("at most `limit` tasks run at once, and the rest start in order", async () => {
    const slots = new ScanSlots(2);
    const started: number[] = [];
    let running = 0;
    let most = 0;
    const releases: (() => void)[] = [];
    const tasks = [0, 1, 2, 3].map((n) =>
      slots.run(async () => {
        started.push(n);
        running++;
        most = Math.max(most, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running--;
        return n;
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, [0, 1]);
    releases.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 2]);
    while (releases.length > 0 || started.length < 4) {
      releases.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3]);
    assert.equal(most, 2);
  });

  it("scanAsPdf itself goes through the shared slots", async () => {
    const png = noisePng(1500, 1500);
    const runs = [0, 1, 2].map(() => scanAsPdf(png, "png", "x.png"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(scanConversionLoad(), {
      active: SCAN_CONCURRENCY,
      queued: 3 - SCAN_CONCURRENCY,
    });
    await Promise.all(runs);
    assert.deepEqual(scanConversionLoad(), { active: 0, queued: 0 });
  });

  it("a failed task gives its slot back", { timeout: 5000 }, async () => {
    const slots = new ScanSlots(1);
    await assert.rejects(
      slots.run(async () => {
        throw new Error("boom");
      }),
    );
    assert.equal(await slots.run(async () => "next"), "next");
  });

  it("a worker that does not answer in time is ended, with its own error", async () => {
    const png = noisePng(3000, 3000);
    const started = performance.now();
    await assert.rejects(
      convertInWorker(png, "png", undefined, 50),
      ScanTimedOut,
    );
    // the rejection comes at the limit, not when the conversion would end
    assert.ok(performance.now() - started < 1500);
  });
});
