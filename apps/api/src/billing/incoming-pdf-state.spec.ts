import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

import { collectedPdfIndex } from "./incoming-collected-pdf.js";
import {
  incomingHasPdf,
  incomingPdfIds,
  type IncomingPdfRow,
} from "./incoming-pdf-state.js";

/*
  EGY BEJÖVŐ SZÁMLA PDF-JE: EGY SZABÁLY (kártya 229fb4bb, T3.2). MI PIROSÍT: ha a lista, az
  adatlap, a csatolás kapuja vagy az ellenőrző lap a három forrás (tárolt jel, csatolt,
  begyűjtött) valamelyikét kihagyná; ha a feed saját dokumentuma önmagában „van PDF”-nek
  számítana (lehet XML); ha a jelöltek sorrendje nem a használat sorrendje (feed, csatolt,
  begyűjtött) vagy ismétlődne; ha egy új hívó saját, harmadik változatot rakna össze (az őrző).
*/
const row = (over: Partial<IncomingPdfRow> = {}): IncomingPdfRow => ({
  id: "in-1",
  hasPdf: false,
  documentNumber: "KI 2026/77",
  supplierTaxNumber: "12345678-2-41",
  sourceDocumentId: null,
  ...over,
});

const collectedDoc = (id: string) => ({
  id,
  fileName: `${id}.pdf`,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  textReading: {
    invoiceNumber: "KI 2026/77",
    supplierTaxNumber: "12345678-2-41",
  },
  importResult: null,
  purchaseInvoiceId: null,
});

describe("incomingHasPdf", () => {
  const none = {
    attached: new Map<string, string[]>(),
    collected: new Map<string, string[]>(),
  };

  it("no source at all: no PDF; each of the three sources alone: a PDF", () => {
    assert.equal(incomingHasPdf(row(), none), false);
    assert.equal(
      incomingHasPdf(row({ hasPdf: true }), none),
      true,
      "the stored flag",
    );
    assert.equal(
      incomingHasPdf(row(), {
        ...none,
        attached: new Map([["in-1", ["att-1"]]]),
      }),
      true,
      "an attached PDF",
    );
    assert.equal(
      incomingHasPdf(row(), {
        ...none,
        collected: collectedPdfIndex([collectedDoc("col-1")] as never),
      }),
      true,
      "a collected PDF",
    );
  });

  it("the feed's own document alone is not a PDF (it may be XML), and another row's attachment is not this row's", () => {
    assert.equal(
      incomingHasPdf(row({ sourceDocumentId: "feed-1" }), none),
      false,
    );
    assert.equal(
      incomingHasPdf(row(), {
        ...none,
        attached: new Map([["in-2", ["att-9"]]]),
      }),
      false,
    );
  });
});

describe("incomingPdfIds", () => {
  it("the feed's document first, then the attached, then the collected, each once", () => {
    const collected = collectedPdfIndex([
      collectedDoc("col-1"),
      collectedDoc("att-1"),
    ] as never);
    assert.deepEqual(
      incomingPdfIds(row({ sourceDocumentId: "feed-1" }), {
        attached: new Map([["in-1", ["att-1", "att-2"]]]),
        collected,
      }),
      ["feed-1", "att-1", "att-2", "col-1"],
    );
  });

  it("without the feed's document or any PDF: no candidates", () => {
    assert.deepEqual(
      incomingPdfIds(row(), { attached: new Map(), collected: new Map() }),
      [],
    );
  });
});

/*
  AZ ŐRZŐ: a `collectedPdfIds` a kifejezés építőeleme; hívni csak az egy szabály, a saját
  definíciója és a beszerzési számla külön szabálya (más entitás) hívhatja. Egy új hívó, amelyik
  maga rakná össze a tárolt jel + csatolt + begyűjtött kifejezést, itt pirosít. A mérő a
  forrásszöveget olvassa; a saját mintája ezért kizárt (`SAJAT`), és egy pozitív kontroll
  igazolja, hogy a minta a hívást meg is találja.
*/
const SRC = new URL("../", import.meta.url).pathname.replace(
  /\/test-dist\//,
  "/src/",
);
const ENGEDELYEZETT = new Set([
  "billing/incoming-collected-pdf.ts",
  "billing/incoming-pdf-state.ts",
  "purchasing/purchase-invoice-pdf.ts",
]);
const SAJAT = "incoming-pdf-state.spec.ts";
const HIVAS = /\bcollectedPdfIds\s*\(/;

const forrasok = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? forrasok(join(dir, entry.name))
      : entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".spec.ts") &&
          entry.name !== SAJAT
        ? [join(dir, entry.name)]
        : [],
  );

describe("the one PDF rule has no third variant", () => {
  it("the matcher finds a call (positive control)", () => {
    assert.ok(HIVAS.test("const x = collectedPdfIds(row, index)"));
    assert.ok(!HIVAS.test("// a collectedPdfIds nevű függvény"));
  });

  /*
    A LISTA-SOR HARMADIK ARGUMENTUMA A PDF-SZABÁLY EREDMÉNYE, NEM EGY KÓDOLT ÉRTÉK. Az ellenőrző lap
    (`purchaseReview`) eddig fixen `false`-t adott, és a listán „van PDF” sort PDF nélkülinek
    mutatta. A mérő a hívás harmadik argumentumát nézi: literál (`true`/`false`) nem lehet.
  */
  const KODOLT_PDF =
    /\btoIncomingListItem\(\s*[\w.]+,\s*(?:new Map\(\)|[\w.]+),\s*(?:true|false)\b/;
  it("the list item's PDF argument is never a hard-coded literal", () => {
    assert.ok(
      KODOLT_PDF.test("toIncomingListItem(approved, new Map(), false, x)"),
    );
    assert.ok(
      !KODOLT_PDF.test("toIncomingListItem(approved, new Map(), hasPdf, x)"),
    );
    const hivok = forrasok(SRC)
      .filter((file) => KODOLT_PDF.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));
    assert.deepEqual(hivok, [], "pass incomingHasPdf(row, sources)");
  });

  it("collectedPdfIds is called only where the rule allows", () => {
    const files = forrasok(SRC);
    assert.ok(files.length > 100, `walked ${files.length} files from ${SRC}`);
    const hivok = files
      .filter((file) => HIVAS.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file))
      .filter((file) => !ENGEDELYEZETT.has(file));
    assert.deepEqual(
      hivok,
      [],
      "put the decision in incomingHasPdf / incomingPdfIds (incoming-pdf-state.ts)",
    );
  });
});
