import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTeachingNarration,
  buildTeachingPrintable,
  buildTeachingSlides,
  type TeachingOutputSource,
} from "@acropora/types";

import {
  estimateTeachingTableHeight,
  fitTeachingTable,
  renderTeachingNarrationText,
  renderTeachingOutputFile,
  teachingFileSlug,
} from "./teaching-output-files.js";

/*
  THE FILES OF A TEACHING OUTPUT (T5.2, slice 2c). What turns these red: a
  slide file that is no zip (pptxgenjs broken, for instance by the removed
  "https" dependency, acrobot msg 52909); a PDF that is no PDF; a narration
  that drops a chapter's reason instead of naming it; a file name that
  carries characters a header cannot.
*/

const AT = "2026-11-15T09:00:00.000Z";

const source: TeachingOutputSource = {
  title: "Az első hat hét: ősz",
  version: 2,
  subtitle: "Próba",
  author: "Akil, Modern Reef blog",
  editor: null,
  audience: "INTERNAL",
  publicBasis: null,
  disclaimer: "A gyártó állításai, nem mértük.",
  parts: [
    {
      key: "a",
      title: "Indulás",
      text: "Cél: {szám: celso}. Várj kb. két hetet.",
      subparts: [],
      checklist: ["Sótartalom: {szám: celso, rövid}"],
      speakerNote: { text: "A cél {szám: celso}.", state: "SOURCE" },
    },
    {
      key: "b",
      title: "Jegyzet nélkül",
      text: "Szöveg.",
      subparts: [],
      checklist: [],
      speakerNote: null,
    },
  ],
  numbers: [
    {
      id: "celso",
      name: "Célsótartalom",
      context: null,
      approx: false,
      quantity: { value: { kind: "exact", value: 1.026 }, unit: "SG" },
      pairs: [],
      partKey: null,
      display: "1,026 SG (kb. 35 PSU)",
      short: "1,026 SG",
      spoken: "egy egész huszonhat ezred",
      inflections: [],
      state: "OK",
      note: null,
    },
  ],
};

describe("teaching output files", () => {
  it("a slide deck is a valid zip (PK header) without the removed https package", async () => {
    const file = await renderTeachingOutputFile(
      buildTeachingSlides(source, AT),
    );
    assert.equal(file.buffer.subarray(0, 2).toString("latin1"), "PK");
    assert.ok(file.buffer.length > 1000);
    assert.equal(file.filename, "az-elso-hat-het-osz-v2-diasor.pptx");
    assert.match(file.type, /presentationml/);
  });

  it("the printable text is a PDF", async () => {
    const file = await renderTeachingOutputFile(
      buildTeachingPrintable(source, AT),
    );
    assert.equal(file.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.equal(file.filename, "az-elso-hat-het-osz-v2.pdf");
  });

  it("the narration names the chapter it could not make", () => {
    const text = renderTeachingNarrationText(
      buildTeachingNarration(source, AT),
    );
    assert.match(
      text,
      /# 1\. rész: Indulás\n\nA cél egy egész huszonhat ezred\./,
    );
    assert.match(text, /# 2\. rész: Jegyzet nélkül\n\n\[jegyzet hiányzik/);
    assert.match(text, /A gyártó állításai, nem mértük\./);
  });

  it("a file name is plain ASCII", () => {
    assert.equal(
      teachingFileSlug("Őszi „vízcsere” 2026!"),
      "oszi-vizcsere-2026",
    );
    assert.equal(teachingFileSlug("???"), "oktatoanyag");
  });
});

/*
  THE ROOM OF A TABLE SLIDE (T5.2, barracuda on #2814). What turns these red: a table that always draws at 12 pt however much it holds, so a
  tall one runs over the note; a note that stays on a fixed line instead of following the table; an estimate that does not grow with the text.
  The numbers are an estimate (see fitTeachingTable), the check that decides is a look at the slide.
*/
describe("fitTeachingTable", () => {
  const cells = (n: number, text: string) =>
    Array.from({ length: n }, (_, i) => `${text} ${i}`);
  it("a small table keeps 12 pt and its note stands right under it", () => {
    const table = {
      header: ["Lépés", "Termék"],
      rows: [
        ["1.", "AmmoMix"],
        ["2.", "Nitri-Bac"],
      ],
      before: [],
      after: ["Fontos: ne lépd túl."],
    };
    const fit = fitTeachingTable(table);
    assert.equal(fit.fontSize, 12);
    assert.equal(fit.fits, true);
    // the note follows the table (1.15 top), not a fixed line
    assert.ok(Math.abs(fit.noteY - (1.15 + fit.height + 0.1)) < 1e-9);
    assert.ok(fit.noteY < 3, "a short table leaves the note high on the slide");
  });

  it("a tall table gets a smaller font, and the estimate grows with the text and shrinks with the font", () => {
    const long =
      "Ez egy hosszú cella, amely több sorba tördelődik a keskeny oszlopban, mert sok szóból áll, és még ez a második fele is hozzátartozik a szöveghez.";
    const table = {
      header: ["Szakasz", "Időzítés", "Fő teendők"],
      rows: Array.from({ length: 6 }, () => [long, long, long]),
      before: [],
      after: [],
    };
    const at12 = estimateTeachingTableHeight(table, 12);
    const at9 = estimateTeachingTableHeight(table, 9);
    assert.ok(at12 > 5, "six long rows at 12 pt do not fit a slide");
    assert.ok(at9 < at12);
    const fit = fitTeachingTable(table);
    assert.ok(fit.fontSize < 12, "the font gets smaller");
    const longer = estimateTeachingTableHeight(
      { ...table, rows: table.rows.map((r) => r.map((c) => c + c)) },
      12,
    );
    assert.ok(longer > at12);
  });

  it("a table that does not fit even at 9 pt says so (fits false) and is drawn at 9 pt", () => {
    const huge = "x".repeat(900);
    const fit = fitTeachingTable({
      header: ["A", "B"],
      rows: Array.from({ length: 6 }, () => [huge, huge]),
      before: ["Felirat"],
      after: ["Megjegyzés"],
    });
    assert.equal(fit.fits, false);
    assert.equal(fit.fontSize, 9);
    assert.ok(cells(1, "x").length === 1);
  });
});
