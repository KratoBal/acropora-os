import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cleanEditedSlides,
  compareTeachingDecks,
  compareTeachingTexts,
  teachingTextSentences,
  parseTeachingEditDecision,
  teachingDeckText,
  type TeachingSlideText,
} from "./teaching-edit.js";
import type { TeachingSlideDeck } from "./teaching-output.js";

/*
  THE EDITED DECK AGAINST THE GENERATED ONE (T5.2, "differs from the
  source"). What turns these red: a reworded, dropped or added point not
  shown; the same points reordered taken as no change; a slide added or
  removed not shown; the footer stamp counted as content; a moved slide
  "guessed" so that a real change hides.
*/

const s = (title: string, ...points: string[]): TeachingSlideText => ({
  title,
  points,
});

describe("compareTeachingDecks", () => {
  it("sees no difference when only case and spacing differ", () => {
    const diff = compareTeachingDecks(
      [s("Indulás", "Cél: 1,026 SG")],
      [s("indulás ", "cél:  1,026 SG")],
    );
    assert.equal(diff.changed, 0);
    assert.equal(diff.slides[0]?.change, "SAME");
  });

  it("names a reworded point as removed and added, and a changed title", () => {
    const diff = compareTeachingDecks(
      [s("Indulás", "Várj 4 hetet.", "Mérd a sót.")],
      [s("Az indulás", "Várj 6 hetet.", "Mérd a sót.")],
    );
    const slide = diff.slides[0];
    assert.equal(slide?.change, "CHANGED");
    assert.equal(slide?.titleChanged, true);
    assert.deepEqual(slide?.removedPoints, ["Várj 4 hetet."]);
    assert.deepEqual(slide?.addedPoints, ["Várj 6 hetet."]);
  });

  it("takes the same points in another order as a change", () => {
    const diff = compareTeachingDecks([s("A", "x", "y")], [s("A", "y", "x")]);
    assert.equal(diff.slides[0]?.change, "CHANGED");
    assert.deepEqual(diff.slides[0]?.addedPoints, []);
  });

  it("shows a slide added at the end and one removed", () => {
    assert.deepEqual(
      compareTeachingDecks([s("A")], [s("A"), s("Új", "pont")]).slides.map(
        (d) => [d.position, d.change],
      ),
      [
        [1, "SAME"],
        [2, "ADDED"],
      ],
    );
    assert.deepEqual(
      compareTeachingDecks([s("A"), s("B", "p")], [s("A")]).slides.map((d) => [
        d.change,
        d.removedPoints,
      ]),
      [
        ["SAME", []],
        ["REMOVED", ["p"]],
      ],
    );
  });

  it("does not guess a moved slide: an inserted slide changes every slide after it", () => {
    const diff = compareTeachingDecks(
      [s("A"), s("B"), s("C")],
      [s("A"), s("Beszúrt"), s("B"), s("C")],
    );
    assert.deepEqual(
      diff.slides.map((d) => d.change),
      ["SAME", "CHANGED", "CHANGED", "ADDED"],
    );
  });
});

describe("the footer stamp is no content", () => {
  const footer = "Akil · 2. verzió · generálva 2026-11-15T09:00:00Z";
  it("is left out of both sides", () => {
    const deck = {
      kind: "SLIDES",
      stamp: { footer },
      slides: [
        {
          kind: "CLOSING",
          title: "Vége",
          points: [footer],
          partKey: null,
          subpartKey: null,
        },
      ],
      overFrame: [],
    } as unknown as TeachingSlideDeck;
    assert.deepEqual(teachingDeckText(deck), [s("Vége")]);
    assert.deepEqual(
      cleanEditedSlides([s("Vége", footer, " ", "Új pont ")], footer),
      [s("Vége", "Új pont")],
    );
  });
});

describe("parseTeachingEditDecision", () => {
  it("takes a yes or a no with an optional note, strictly", () => {
    assert.deepEqual(
      parseTeachingEditDecision({ toSource: true, note: " ok " }),
      {
        ok: true,
        value: { toSource: true, note: "ok" },
      },
    );
    assert.deepEqual(parseTeachingEditDecision({ toSource: false }), {
      ok: true,
      value: { toSource: false, note: null },
    });
    for (const bad of [
      null,
      {},
      { toSource: "igen" },
      { toSource: true, x: 1 },
      { toSource: true, note: 5 },
    ])
      assert.equal(
        parseTeachingEditDecision(bad).ok,
        false,
        JSON.stringify(bad),
      );
  });
});

/*
  THE TEXT DIFF (an edited PDF or narration). What turns these red: a line
  wrapped differently counted as a change; a changed sentence not shown as
  removed and added; the order of what changed lost; a kept sentence counted
  as changed.
*/
describe("compareTeachingTexts", () => {
  const sentences = teachingTextSentences;

  it("a text wrapped differently is the same text", () => {
    const a = sentences("Várj 4 hetet. Mérd a sót.\nKész.");
    const b = sentences("Várj 4\nhetet.   Mérd a\nsót. Kész.");
    assert.deepEqual(compareTeachingTexts(a, b), {
      removed: [],
      added: [],
      same: 3,
      changed: 0,
    });
  });

  it("names a changed sentence as removed and added, in order, and keeps the rest", () => {
    const diff = compareTeachingTexts(
      sentences("Első. Várj 4 hetet. Mérd a sót. Utolsó."),
      sentences("Első. Várj 6 hetet. Mérd a sót. Új mondat. Utolsó."),
    );
    assert.deepEqual(diff.removed, ["Várj 4 hetet."]);
    assert.deepEqual(diff.added, ["Várj 6 hetet.", "Új mondat."]);
    assert.equal(diff.same, 3);
    assert.equal(diff.changed, 2);
  });

  it("does not cut at kb. or a decimal comma, and cuts before a bullet or a heading", () => {
    assert.deepEqual(sentences("Várj kb. 4 hetet. • Mérd. # 2. rész: Só"), [
      "Várj kb. 4 hetet.",
      "• Mérd.",
      "# 2. rész: Só",
    ]);
  });
});
