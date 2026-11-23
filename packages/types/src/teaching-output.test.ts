import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTeachingOutput,
  parseTeachingSentInput,
  teachingOutputFlags,
  buildTeachingNarration,
  buildTeachingPrintable,
  buildTeachingSlides,
  fillTeachingText,
  TEACHING_OPEN_MARK,
  teachingSentences,
  type TeachingOutputSource,
} from "./teaching-output.js";
import {
  estimateTeachingTableHeight,
  fitTeachingTable,
} from "./teaching-table-fit.js";
import type { TeachingNumber, TeachingPart } from "./teaching-source.js";

/*
  THE OUTPUTS (T5.2, spec v2, point 2). What turns these red: a number in an
  output that is not the table's form (a typed value, the wrong form, the
  written form in the narration); an open-question number without its mark; a
  statement dropped to fit the slide frame instead of the over-frame flag; a
  narration made from a missing or suggested note, or with a spoken form made
  up; an output that does not carry its source version.
*/

const AT = "2026-11-15T08:00:00.000Z";

const num = (
  over: Partial<TeachingNumber> & { id: string },
): TeachingNumber => ({
  name: over.id,
  context: null,
  approx: false,
  quantity: { value: { kind: "exact", value: 1 }, unit: "ml" },
  pairs: [],
  partKey: null,
  display: "1 ml",
  short: "1 ml",
  spoken: null,
  inflections: [],
  state: "OK",
  note: null,
  ...over,
});

const part = (over: Partial<TeachingPart> & { key: string }): TeachingPart => ({
  title: over.key,
  text: "",
  subparts: [],
  checklist: [],
  speakerNote: null,
  ...over,
});

const SALT = num({
  id: "celso",
  name: "Célsótartalom",
  display: "1,026 SG (kb. 35 PSU)",
  short: "1,026 SG",
  spoken: "egy egész huszonhat ezred",
});

const source = (
  over: Partial<TeachingOutputSource> = {},
): TeachingOutputSource => ({
  title: "Az első hat hét",
  version: 3,
  subtitle: null,
  author: "Akil, Modern Reef blog",
  editor: "Acropora szerkesztőség",
  audience: "INTERNAL",
  publicBasis: null,
  disclaimer: "A termékleírások a gyártó állításait adják vissza.",
  parts: [],
  numbers: [SALT],
  ...over,
});

describe("fillTeachingText", () => {
  it("puts the table's form in, written or spoken", () => {
    const text = "Cél: {szám: celso}, röviden {szám: celso, rövid}.";
    assert.equal(
      fillTeachingText(text, [SALT], "written").text,
      "Cél: 1,026 SG (kb. 35 PSU), röviden 1,026 SG.",
    );
    assert.equal(
      fillTeachingText(text, [SALT], "spoken").text,
      "Cél: egy egész huszonhat ezred, röviden egy egész huszonhat ezred.",
    );
  });

  it("marks an open number in writing, and never makes up a spoken form", () => {
    const open = num({
      id: "ciklus",
      display: "2-4 hét",
      short: "2-4 hét",
      state: "OPEN_QUESTION",
    });
    assert.equal(
      fillTeachingText("{szám: ciklus}", [open], "written").text,
      `2-4 hét ${TEACHING_OPEN_MARK}`,
    );
    const spoken = fillTeachingText("Kb. {szám: ciklus}.", [open], "spoken");
    assert.equal(spoken.text, "Kb. {szám: ciklus}.");
    assert.deepEqual(spoken.unresolved, ["ciklus"]);
  });

  it("uses an inflection's written and spoken form", () => {
    const het = num({
      id: "het",
      inflections: [
        { name: "hétig", written: "4 hétig", spoken: "négy hétig" },
      ],
    });
    assert.equal(
      fillTeachingText("kb. {szám: het, hétig}", [het], "written").text,
      "kb. 4 hétig",
    );
    assert.equal(
      fillTeachingText("kb. {szám: het, hétig}", [het], "spoken").text,
      "kb. négy hétig",
    );
  });

  it("marks a number open by the analysis (a conflict) too", () => {
    assert.equal(
      fillTeachingText(
        "{szám: celso, rövid}",
        [SALT],
        "written",
        new Set(["celso"]),
      ).text,
      `1,026 SG ${TEACHING_OPEN_MARK}`,
    );
  });
});

describe("teachingSentences", () => {
  it("does not split at kb. or a decimal comma, splits before a capital", () => {
    assert.deepEqual(
      teachingSentences(
        "Várj kb. 4 hetet. A só 1,026 SG legyen! Kész?\n\nÚj bekezdés",
      ),
      ["Várj kb. 4 hetet.", "A só 1,026 SG legyen!", "Kész?", "Új bekezdés"],
    );
  });

  // T5.2, card b731bd4d (acrobot 59390, korall's stage finding on version 3 and 4): the paragraph was one line, so "1." stood alone,
  // "megrepedhet. 3." carried the next item's number, and a bullet's "-" stood mid-sentence. WHAT TURNS IT RED: any of the three back;
  // a soft-wrapped line or a table row split off as its own point.
  it("keeps a list item's number with it, drops a bullet mark, and starts a point at each list line", () => {
    assert.deepEqual(
      teachingSentences(
        "Az okok:\n1. Készítsd elő a vizet. Keverd egy napig.\n2) Ellenőrizd a sót.\n3. A kő megrepedhet.\n- A felső réteg oxigéndús.\n– Lent kevés az oxigén.\n• Ez a harmadik.",
      ),
      [
        "Az okok:",
        "1. Készítsd elő a vizet.",
        "Keverd egy napig.",
        "2) Ellenőrizd a sót.",
        "3. A kő megrepedhet.",
        "A felső réteg oxigéndús.",
        "Lent kevés az oxigén.",
        "Ez a harmadik.",
      ],
    );
  });

  it("a soft-wrapped line continues its sentence, and a run of lines with a bar is a table, not sentences", () => {
    assert.deepEqual(
      teachingSentences(
        "Ez egy hosszú mondat, ami\na következő sorban folytatódik.\n\nAdagolás |\nAdag | hetente egyszer\n- Egy pont\nfolytatással.",
      ),
      [
        "Ez egy hosszú mondat, ami a következő sorban folytatódik.",
        // the table: the header and the row as "a | b" lines (a reader without tables); the empty cell of "Adagolás |" is a cell
        "Adagolás |",
        "Adag | hetente egyszer",
        "Egy pont folytatással.",
      ],
    );
  });
});

describe("buildTeachingPrintable", () => {
  it("stamps the version and the source, fills the text, lists the part's numbers", () => {
    const out = buildTeachingPrintable(
      source({
        parts: [
          part({
            key: "elso",
            text: "Első bekezdés {szám: celso, rövid}.\n\nMásodik.",
            checklist: ["Mérd: {szám: celso}"],
          }),
        ],
      }),
      AT,
    );
    assert.equal(out.stamp.sourceVersion, 3);
    assert.equal(
      out.stamp.footer,
      `Akil, Modern Reef blog · 3. verzió · generálva ${AT}`,
    );
    assert.equal(
      out.disclaimer,
      "A termékleírások a gyártó állításait adják vissza.",
    );
    assert.deepEqual(out.parts[0]?.paragraphs, [
      "Első bekezdés 1,026 SG.",
      "Második.",
    ]);
    assert.deepEqual(out.parts[0]?.checklist, ["Mérd: 1,026 SG (kb. 35 PSU)"]);
    assert.deepEqual(out.parts[0]?.numbers, [
      {
        numberId: "celso",
        name: "Célsótartalom",
        context: null,
        value: "1,026 SG (kb. 35 PSU)",
        open: false,
      },
    ]);
  });
});

describe("buildTeachingSlides", () => {
  const sentences = (n: number) =>
    Array.from({ length: n }, (_, i) => `Állítás ${i + 1}.`).join(" ");

  it("title first, closing last, checklist on its own slide, at most five points", () => {
    const deck = buildTeachingSlides(
      source({
        parts: [
          part({
            key: "a",
            title: "Indulás",
            text: sentences(7),
            checklist: ["x", "y"],
          }),
        ],
      }),
      AT,
    );
    assert.deepEqual(
      deck.slides.map((s) => [s.kind, s.points.length]),
      [
        ["TITLE", 2],
        ["CONTENT", 5],
        ["CONTENT", 2],
        ["CHECKLIST", 2],
        ["CLOSING", 1],
      ],
    );
    assert.equal(deck.slides[1]?.title, "Indulás (1/2)");
    assert.deepEqual(deck.overFrame, []);
  });

  it("keeps every statement and flags the part over the frame (no sub-parts: 4 slides)", () => {
    const deck = buildTeachingSlides(
      source({ parts: [part({ key: "a", text: sentences(22) })] }),
      AT,
    );
    const points = deck.slides
      .filter((s) => s.kind === "CONTENT")
      .flatMap((s) => s.points);
    assert.equal(points.length, 22, "nothing dropped");
    assert.deepEqual(deck.overFrame, [
      { partKey: "a", subpartKey: null, slides: 5, limit: 4 },
    ]);
  });

  it("a part with sub-parts: one slide each, at most two, and the frame follows the sub-parts (Akil part 4)", () => {
    const deck = buildTeachingSlides(
      source({
        parts: [
          part({
            key: "negy",
            title: "4. rész",
            subparts: [
              { key: "l1", title: "1. lépés", text: sentences(3) },
              { key: "l2", title: "2. lépés", text: sentences(6) },
              { key: "l3", title: "3. lépés", text: sentences(16) },
            ],
          }),
        ],
      }),
      AT,
    );
    assert.deepEqual(
      deck.slides.filter((s) => s.kind === "CONTENT").map((s) => s.subpartKey),
      // 6 sentences are one slide of six (a lone sixth is not a slide), 16 are 5, 5 and 5+1
      ["l1", "l2", "l3", "l3", "l3"],
    );
    assert.deepEqual(deck.overFrame, [
      { partKey: "negy", subpartKey: "l3", slides: 3, limit: 2 },
    ]);
  });
});

describe("buildTeachingSlides: a table, a lone last point, a title-like point (T5.2, card b731bd4d, korall 2026-11-23)", () => {
  const content = (text: string) =>
    buildTeachingSlides(
      source({ parts: [part({ key: "a", text })] }),
      AT,
    ).slides.filter((s) => s.kind === "CONTENT");
  const sentences = (n: number) =>
    Array.from({ length: n }, (_, i) => `Állítás ${i + 1}.`).join(" ");

  it("a table is one unit: its header and at most six rows on a slide, a caption before it and a note after it with it, the rows are no sentences", () => {
    const slides = content(
      [
        "Bevezető mondat.",
        "Protokoll",
        "Lépés | Termék | Adag\n1. | AmmoMix | 5 ml\n2. | Nitri-Bac | 3 ml\n3. | A | 1\n4. | B | 2\n5. | C | 3\n6. | D | 4\n7. | E | 5",
        "Fontos: ne lépd túl.",
      ].join("\n\n"),
    );
    assert.equal(slides.length, 3, "the intro, then the table in two slides");
    assert.deepEqual(slides[0]?.points, ["Bevezető mondat."]);
    assert.equal(slides[0]?.table, undefined);
    const [, first, second] = slides;
    assert.deepEqual(first?.table?.header, ["Lépés", "Termék", "Adag"]);
    assert.equal(first?.table?.rows.length, 6);
    // the number of a row is a cell, not a list mark
    assert.deepEqual(first?.table?.rows[0], ["1.", "AmmoMix", "5 ml"]);
    assert.deepEqual(first?.table?.before, ["Protokoll"]);
    assert.deepEqual(first?.table?.after, []);
    // the long table goes on with the header again, and the note stands under its last rows
    assert.deepEqual(second?.table?.header, ["Lépés", "Termék", "Adag"]);
    assert.equal(second?.table?.rows.length, 1);
    assert.deepEqual(second?.table?.after, ["Fontos: ne lépd túl."]);
    // a reader without tables gets the caption, the header and the rows as text
    assert.equal(first?.points[0], "Protokoll");
    assert.equal(first?.points[1], "Lépés | Termék | Adag");
    assert.equal(first?.points.length, 8);
  });

  it("a markdown table: the outer bars are no cells, the row of dashes is no data; a table without outer bars keeps its empty cells (barracuda on #2814)", () => {
    const slides = content(
      "| Lépés | Termék |\n|---|:---:|\n| 1. | AmmoMix |\n| 2. | Nitri-Bac |",
    );
    assert.equal(slides.length, 1);
    assert.deepEqual(slides[0]?.table?.header, ["Lépés", "Termék"]);
    assert.deepEqual(slides[0]?.table?.rows, [
      ["1.", "AmmoMix"],
      ["2.", "Nitri-Bac"],
    ]);
    // the source's own form: no outer bars on the first line, an empty first cell on the last ("Hatásos | NEM hatásos" / " | bakteriális fertőzések")
    const own = content(
      "Hatásos | NEM hatásos\ndarakór | bársonykór\n | bakteriális fertőzések",
    );
    assert.deepEqual(own[0]?.table?.rows[1], ["", "bakteriális fertőzések"]);
    assert.equal(own[0]?.table?.rows.length, 2);
    // a "--- | ---" line under the header is dropped without outer bars too
    assert.deepEqual(
      content("Faj | Megjegyzés\n--- | ---\nbohóchal | szívós")[0]?.table?.rows,
      [["bohóchal", "szívós"]],
    );
  });

  it("the frame counts the text slides: a table slide is not counted, the text slides of the same sub-part still are", () => {
    const rows = Array.from(
      { length: 8 },
      (_, i) => `${i + 1}. | A${i} | B${i}`,
    ).join("\n");
    const table = `Lépés | Termék | Adag\n${rows}`;
    const deckOf = (subText: string) =>
      buildTeachingSlides(
        source({
          parts: [
            part({
              key: "a",
              title: "A rész",
              subparts: [{ key: "a1", title: "Alrész", text: subText }],
            }),
          ],
        }),
        AT,
      );
    // an intro, a table of eight rows (two slides) and a closing paragraph: four slides, two of them text: within the frame of two
    const within = deckOf(`${sentences(2)}\n\n${table}\n\n${sentences(3)}`);
    const slides = within.slides.filter((s) => s.kind === "CONTENT");
    assert.equal(slides.length, 4);
    assert.equal(slides.filter((s) => s.table).length, 2);
    assert.deepEqual(within.overFrame, []);
    // the same sub-part with twelve sentences of text besides the table: three text slides, over the frame of two, counted as three
    // (the last sentence is long: a short last point before a table would be its caption)
    const closing =
      "Ez egy hosszú záró mondat, amely biztosan nem felirat, mert jóval hosszabb nyolcvan karakternél, és nem kettősponttal végződik.";
    const over = deckOf(`${sentences(11)} ${closing}\n\n${table}`);
    assert.deepEqual(over.overFrame, [
      { partKey: "a", subpartKey: "a1", slides: 3, limit: 2 },
    ]);
  });

  it("a lone last point joins the slide before it (six points), and no slide of a text run shows one point after another", () => {
    const sizes = (n: number) =>
      content(sentences(n)).map((s) => s.points.length);
    assert.deepEqual(sizes(5), [5]);
    assert.deepEqual(sizes(6), [6], "a sixth point is not a slide of its own");
    assert.deepEqual(sizes(11), [5, 6]);
    assert.deepEqual(sizes(12), [5, 5, 2], "two points are not an orphan");
  });

  it("a title-like point does not end a slide: it goes with its explanation to the next one", () => {
    const slides = content(
      `${sentences(4)}\n\n1. Hatalmas felület. A korall nagy felületen ad otthont az élőlényeknek.`,
    );
    assert.deepEqual(
      slides.map((s) => s.points.length),
      [4, 2],
    );
    assert.equal(slides[1]?.points[0], "1. Hatalmas felület.");
    // an opening sentence that is long is no title, and an item of one sentence has no explanation to go with
    const long = `1. ${"Nagyon hosszú nyitó mondat, ami már nem címsor szerű, mert túl sok szóból áll."} Utána jön a magyarázat.`;
    assert.deepEqual(
      content(`${sentences(4)}\n\n${long}`).map((s) => s.points.length),
      // five points on the slide, and the explanation alone after it would be a lone last point, so it joins: six
      [6],
    );
    assert.deepEqual(
      content(`${sentences(4)}\n\n1. Csak ennyi.`).map((s) => s.points.length),
      [5],
    );
  });
});

describe("buildTeachingNarration", () => {
  it("speaks the disclaimer at the opening, chapters by part, spoken forms", () => {
    const out = buildTeachingNarration(
      source({
        parts: [
          part({
            key: "a",
            title: "Indulás",
            speakerNote: { text: "A cél {szám: celso}.", state: "SOURCE" },
          }),
          part({ key: "b", title: "Nincs jegyzet" }),
          part({
            key: "c",
            title: "Javaslat",
            speakerNote: { text: "Gépi szöveg.", state: "SUGGESTED" },
          }),
        ],
      }),
      AT,
    );
    assert.equal(
      out.opening,
      "Az első hat hét. Akil, Modern Reef blog. A termékleírások a gyártó állításait adják vissza.",
    );
    assert.deepEqual(
      out.chapters.map((c) => [c.heading, c.text, c.missing]),
      [
        ["# 1. rész: Indulás", "A cél egy egész huszonhat ezred.", null],
        ["# 2. rész: Nincs jegyzet", null, "NO_NOTE"],
        ["# 3. rész: Javaslat", null, "SUGGESTED_NOTE"],
      ],
    );
  });

  it("a chapter whose number has no spoken form is not narrated, and names the number", () => {
    const out = buildTeachingNarration(
      source({
        numbers: [num({ id: "adag" })],
        parts: [
          part({
            key: "a",
            speakerNote: { text: "Adag: {szám: adag}.", state: "SOURCE" },
          }),
        ],
      }),
      AT,
    );
    assert.equal(out.chapters[0]?.text, null);
    assert.equal(out.chapters[0]?.missing, "NO_SPOKEN_FORM");
    assert.deepEqual(out.chapters[0]?.unspeakable, ["adag"]);
  });

  it("names the open numbers a chapter speaks", () => {
    const out = buildTeachingNarration(
      source({
        parts: [
          part({
            key: "a",
            speakerNote: { text: "{szám: celso}", state: "SOURCE" },
          }),
        ],
      }),
      AT,
      new Set(["celso"]),
    );
    assert.deepEqual(out.chapters[0]?.openNumbers, ["celso"]);
  });
});

describe("output records", () => {
  it("builds each kind, and reads the flags off the body", () => {
    const src = source({
      parts: [
        part({
          key: "a",
          text: Array.from({ length: 22 }, (_, i) => `Állítás ${i}.`).join(" "),
        }),
      ],
    });
    assert.equal(buildTeachingOutput("PRINTABLE", src, AT).kind, "PRINTABLE");
    assert.deepEqual(
      teachingOutputFlags(buildTeachingOutput("SLIDES", src, AT)),
      {
        overFrame: 1,
        tableOverflow: 0,
        chaptersWithoutNarration: 0,
      },
    );
    assert.deepEqual(
      teachingOutputFlags(buildTeachingOutput("NARRATION", src, AT)),
      {
        overFrame: 0,
        tableOverflow: 0,
        chaptersWithoutNarration: 1,
      },
    );
  });

  it("parses where an output went, strictly", () => {
    assert.deepEqual(
      parseTeachingSentInput({ to: "  Hírlevél ", public: true }),
      {
        ok: true,
        value: { to: "Hírlevél", public: true },
      },
    );
    for (const bad of [
      null,
      [],
      {},
      { to: " ", public: false },
      { to: "x" },
      { to: "x", public: "igen" },
      { to: "x", public: false, y: 1 },
      { to: "x".repeat(301), public: false },
    ])
      assert.equal(parseTeachingSentInput(bad).ok, false, JSON.stringify(bad));
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

  it("a table that does not fit even at 9 pt says so (fits false, how far it runs over) and is drawn at 9 pt", () => {
    const huge = "x".repeat(900);
    const fit = fitTeachingTable({
      header: ["A", "B"],
      rows: Array.from({ length: 6 }, () => [huge, huge]),
      before: ["Felirat"],
      after: ["Megjegyzés"],
    });
    assert.equal(fit.fits, false);
    assert.equal(fit.fontSize, 9);
    assert.ok(fit.over > 0, "it runs below its room");
    assert.equal(
      fitTeachingTable({ header: ["A"], rows: [["b"]], before: [], after: [] })
        .over,
      0,
    );
    assert.ok(cells(1, "x").length === 1);
  });
});

describe("buildTeachingSlides: the table that does not fit is in the deck (T5.2, barracuda on #2815)", () => {
  const deckOf = (text: string) =>
    buildTeachingSlides(
      source({ parts: [part({ key: "a", title: "A rész", text })] }),
      AT,
    );
  it("a table too big for 9 pt is listed with its slide number and how far it runs over, and the flag counts it", () => {
    const huge = "x".repeat(900);
    const big = `Szakasz | Idő\n${Array.from({ length: 6 }, () => `${huge} | ${huge}`).join("\n")}`;
    // a long opening sentence: a short last point before a table would be its caption and stand on the table's slide
    const intro =
      "Ez egy hosszú bevezető mondat, amely biztosan nem felirat, mert jóval hosszabb nyolcvan karakternél, és nem kettősponttal végződik.";
    const deck = deckOf(`${intro}\n\n${big}`);
    assert.equal(deck.tableOverflow?.length, 1);
    const entry = deck.tableOverflow?.[0];
    // the title slide is the first, the intro the second, the table the third
    assert.equal(entry?.slide, 3);
    assert.equal(deck.slides[(entry?.slide ?? 0) - 1]?.title, entry?.title);
    assert.equal(entry?.partKey, "a");
    assert.ok((entry?.over ?? 0) > 0);
    assert.equal(teachingOutputFlags(deck).tableOverflow, 1);
  });

  it("a table that fits is not listed, and a deck stored before the field existed counts zero", () => {
    const deck = deckOf("Szakasz | Idő\nElőkészítés | 0. nap");
    assert.deepEqual(deck.tableOverflow, []);
    assert.equal(teachingOutputFlags(deck).tableOverflow, 0);
    const { tableOverflow: _gone, ...old } = deck;
    assert.equal(teachingOutputFlags(old).tableOverflow, 0);
  });
});
