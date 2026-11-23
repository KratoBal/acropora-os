import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTeachingNarration,
  buildTeachingPrintable,
  buildTeachingSlides,
  type TeachingOutputSource,
} from "@acropora/types";

import {
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
