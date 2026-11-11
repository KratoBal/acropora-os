import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAGE_END_MARKER } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import {
  ASSET_DOCUMENT_OCR_ENV,
  OCR_LIMITS,
  OCR_NOTICE,
  OcrGate,
  createScanReader,
  isOcrEnabled,
  isTransientStop,
  ocrPdf,
  type OcrDeps,
  type OcrLimits,
} from "./asset-document-ocr.js";

/*
  THE OCR'S LIMITS AND SWITCH, WITH FAKES (card 126f9b92, acrobot 46667). The engine and the pages are injected, so a limit
  is a test, not a hope: a 200 page file, a stuck page, a process over its memory, a second reading while one runs.
*/
const BYTES = new Uint8Array([1, 2, 3]);

type Fake = {
  deps: OcrDeps;
  calls: {
    recognized: number;
    terminated: number;
    closed: number;
    rendered: number[];
  };
  clock: { ms: number };
  memory: { rss: number };
};

function fake(options: {
  pages: number;
  textOf?: (page: number) => string;
  recognize?: (page: number) => Promise<string>;
  perPageMs?: number;
}): Fake {
  const calls = {
    recognized: 0,
    terminated: 0,
    closed: 0,
    rendered: [] as number[],
  };
  const clock = { ms: 0 };
  const memory = { rss: 100 * 1024 * 1024 };
  const deps: OcrDeps = {
    now: () => clock.ms,
    rss: () => memory.rss,
    openPages: async () => ({
      pageCount: options.pages,
      renderPage: async (page) => {
        calls.rendered.push(page);
        return new Uint8Array([page]);
      },
      close: async () => {
        calls.closed += 1;
      },
    }),
    engine: async () => ({
      recognize: async (picture) => {
        calls.recognized += 1;
        const page = picture[0] ?? 0;
        clock.ms += options.perPageMs ?? 0;
        if (options.recognize) return options.recognize(page);
        return options.textOf
          ? options.textOf(page)
          : `oldal ${page}\n72555 Járókerék`;
      },
      terminate: async () => {
        calls.terminated += 1;
      },
    }),
  };
  return { deps, calls, clock, memory };
}

describe("OCR: a nem szokásos szélek", () => {
  it("a kapcsoló csak a pontos `true`-ra van bekapcsolva", () => {
    assert.equal(isOcrEnabled({ [ASSET_DOCUMENT_OCR_ENV]: "true" }), true);
    for (const value of [undefined, "", "false", "TRUE", "1", " true", "yes"])
      assert.equal(
        isOcrEnabled({ [ASSET_DOCUMENT_OCR_ENV]: value }),
        false,
        JSON.stringify(value),
      );
  });

  it("minden oldalt beolvas, az oldalvégi jelzőkkel, a jelzéssel és megállás nélkül", async () => {
    const { deps, calls } = fake({ pages: 3 });
    const reading = await ocrPdf(BYTES, deps);
    assert.deepEqual(reading.lines, [
      "oldal 1",
      "72555 Járókerék",
      PAGE_END_MARKER,
      "oldal 2",
      "72555 Járókerék",
      PAGE_END_MARKER,
      "oldal 3",
      "72555 Járókerék",
      PAGE_END_MARKER,
    ]);
    assert.deepEqual(reading.ocr, {
      pagesRead: 3,
      pagesTotal: 3,
      stoppedBy: null,
      notice: OCR_NOTICE,
    });
    assert.equal(calls.closed, 1);
  });

  it("a 200 oldalas PDF-ből csak a határig olvas, és kimondja", async () => {
    const { deps, calls } = fake({ pages: 200 });
    const reading = await ocrPdf(BYTES, deps);
    assert.equal(reading.ocr.pagesRead, OCR_LIMITS.maxPages);
    assert.equal(reading.ocr.pagesTotal, 200);
    assert.equal(reading.ocr.stoppedBy, "pages");
    assert.equal(calls.rendered.length, OCR_LIMITS.maxPages);
    assert.equal(calls.closed, 1);
  });

  it("az összidő határán megáll (`time`), az addig olvasott oldalakat megtartja", async () => {
    const limits: OcrLimits = { ...OCR_LIMITS, totalTimeoutMs: 2500 };
    const { deps } = fake({ pages: 10, perPageMs: 1000 });
    const reading = await ocrPdf(BYTES, deps, limits);
    assert.equal(reading.ocr.stoppedBy, "time");
    assert.equal(reading.ocr.pagesRead, 3);
  });

  it("a memóriahatáron megáll (`memory`), mielőtt a következő oldalt elkezdené", async () => {
    const { deps, calls, memory } = fake({ pages: 5 });
    const original = deps.engine;
    let pages = 0;
    deps.engine = async () => {
      const engine = await original();
      return {
        ...engine,
        recognize: async (picture) => {
          pages += 1;
          if (pages === 2) memory.rss = OCR_LIMITS.maxRssBytes + 1;
          return engine.recognize(picture);
        },
      };
    };
    const reading = await ocrPdf(BYTES, deps);
    assert.equal(reading.ocr.stoppedBy, "memory");
    assert.equal(reading.ocr.pagesRead, 2);
    assert.equal(calls.rendered.length, 2);
  });

  it("egy elakadt oldal az oldalhatáron megáll, és a motort eldobja (`time`)", async () => {
    const limits: OcrLimits = { ...OCR_LIMITS, pageTimeoutMs: 30 };
    const { deps, calls } = fake({
      pages: 3,
      recognize: (page) =>
        page === 2
          ? new Promise<string>(() => undefined)
          : Promise.resolve("szöveg"),
    });
    const reading = await ocrPdf(BYTES, deps, limits);
    assert.equal(reading.ocr.stoppedBy, "time");
    assert.equal(reading.ocr.pagesRead, 1);
    assert.equal(calls.terminated, 1);
    assert.equal(calls.closed, 1);
  });

  it("a motor hibája kidobódik, az oldalforrás mégis le van zárva", async () => {
    const { deps, calls } = fake({
      pages: 2,
      recognize: async () => {
        throw new Error("motorhiba");
      },
    });
    await assert.rejects(ocrPdf(BYTES, deps), /motorhiba/);
    assert.equal(calls.closed, 1);
  });

  it("a megállási okok közül a hiba, az idő, a memória és a foglalt átmeneti, az oldalhatár nem", () => {
    assert.equal(isTransientStop(null), false);
    assert.equal(isTransientStop("pages"), false);
    for (const stop of ["time", "memory", "busy", "error"] as const)
      assert.equal(isTransientStop(stop), true, stop);
  });
});

describe("OCR: a beolvasó (kapcsoló és kapu)", () => {
  it("kikapcsolva `null`-t ad, és a motorhoz nem nyúl", async () => {
    const { deps, calls } = fake({ pages: 2 });
    const reader = createScanReader(deps, new OcrGate(), () => ({}));
    assert.equal(await reader(BYTES), null);
    assert.equal(calls.recognized, 0);
    assert.equal(calls.closed, 0);
  });

  it("bekapcsolva olvas", async () => {
    const { deps } = fake({ pages: 1 });
    const reader = createScanReader(deps, new OcrGate(), () => ({
      [ASSET_DOCUMENT_OCR_ENV]: "true",
    }));
    const reading = await reader(BYTES);
    assert.equal(reading?.ocr.pagesRead, 1);
  });

  it("a motor hibája nem dobódik: `error` jelzés, üres szöveg, és a hiba nevét jelenti", async () => {
    const { deps } = fake({
      pages: 1,
      recognize: async () => {
        throw new TypeError("benne a dokumentum szövege");
      },
    });
    const reported: unknown[] = [];
    const reader = createScanReader(
      deps,
      new OcrGate(),
      () => ({ [ASSET_DOCUMENT_OCR_ENV]: "true" }),
      OCR_LIMITS,
      (error) => reported.push(error),
    );
    const reading = await reader(BYTES);
    assert.equal(reading?.ocr.stoppedBy, "error");
    assert.deepEqual(reading?.lines, []);
    assert.equal(reported.length, 1);
  });

  it("egyszerre EGY olvasás fut; a várakozók száma korlátos, a többi `busy`", async () => {
    let release: () => void = () => undefined;
    const gate = new OcrGate(1);
    const { deps, calls } = fake({
      pages: 1,
      recognize: () =>
        new Promise<string>((resolve) => {
          release = () => resolve("szöveg");
        }),
    });
    const reader = createScanReader(deps, gate, () => ({
      [ASSET_DOCUMENT_OCR_ENV]: "true",
    }));
    const first = reader(BYTES); // fut
    const second = reader(BYTES); // vár (a sorban 1 hely)
    const third = await reader(BYTES); // nincs hely
    assert.equal(third?.ocr.stoppedBy, "busy");
    assert.deepEqual(third?.lines, []);
    assert.equal(
      calls.recognized <= 1,
      true,
      "a harmadik nem indította a motort",
    );
    // The first reading has to be inside its engine call before it can be released.
    while (calls.recognized < 1) await new Promise((r) => setImmediate(r));
    release();
    await first;
    // The second reading starts only now: wait until its engine call has begun, then let it finish.
    while (calls.recognized < 2) await new Promise((r) => setImmediate(r));
    release();
    const done = await second;
    assert.equal(done?.ocr.stoppedBy, null);
  });
});

describe("OCR: a kapcsoló a két env sablonban", () => {
  it("mindkét sablon megnevezi, kikapcsolva", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of [".env.example", ".env.production.example"])
      assert.match(
        readFileSync(`../../${file}`, "utf8"),
        /^ASSET_DOCUMENT_OCR=false$/m,
        file,
      );
  });
});
