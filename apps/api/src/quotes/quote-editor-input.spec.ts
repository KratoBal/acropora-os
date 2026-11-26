import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  blockContent,
  milestonesInput,
  quantityInput,
  richTextInput,
  templateInput,
} from "./quote-editor-input.js";
import { snippetMilestones } from "./quote-snippets.service.js";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const para = (text: string, marks?: unknown[]) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});

describe("quote rich text on the server (decision 5)", () => {
  /*
    URGENT BUG HUNT (card fa6d7fa6, Luca 2026-11-26): the shapes below are the PATCH bodies the real editor sent from the test OS
    (measured in a browser: one bold letter, nested bullet list, mixed formatting with a hard break). Each must be accepted for every
    text kind, as stored AND as the save path sees it (blockContent).
    WHAT TURNS IT RED: if the server starts rejecting marks on a split text run, a list inside a list item, a hard break or an italic run.
  */
  const FROM_EDITOR: Array<[string, unknown]> = [
    [
      "one bold letter splits the run in three",
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "l", marks: [{ type: "bold" }] },
          { type: "text", text: "ma" },
        ],
      }),
    ],
    [
      "a bullet list with a nested list and bold items",
      doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              para("egy", [{ type: "bold" }]),
              {
                type: "bulletList",
                content: [{ type: "listItem", content: [para("beljebb")] }],
              },
            ],
          },
        ],
      }),
    ],
    [
      "mixed: two paragraphs, a hard break, italic, an ordered list",
      doc(
        para("a", [{ type: "bold" }, { type: "italic" }]),
        {
          type: "paragraph",
          content: [
            { type: "text", text: "elso" },
            { type: "hardBreak" },
            { type: "text", text: "masodik" },
          ],
        },
        { type: "paragraph" },
        {
          type: "orderedList",
          content: [{ type: "listItem", content: [para("elem")] }],
        },
      ),
    ],
  ];
  for (const [name, value] of FROM_EDITOR)
    for (const kind of [
      "TEXT",
      "TERMS",
      "SECTION",
      "OPTIONS",
      "SUMMARY",
    ] as const)
      it(`accepts ${name} on a ${kind} block, unchanged`, () => {
        assert.deepEqual(blockContent(kind, value), value);
      });

  it("keeps the allowed subset", () => {
    const value = doc(para("Szia", [{ type: "bold" }]));
    assert.deepEqual(richTextInput(value), value);
  });

  /*
    LUCA 2026-11-26 (card fa6d7fa6, AJ-2026-0021): a pasted bold paragraph with line breaks arrives with the bold mark ON the hardBreak node
    (ProseMirror applies the pasted <b> to the <br>). The whole block was refused. A line break carries no formatting: the mark is dropped,
    the text keeps its own. WHAT TURNS IT RED: if that shape is refused again, if the mark reaches the stored JSON, if the text loses its bold,
    or if a mark on any OTHER non-text node is let through.
  */
  it("accepts a pasted bold line break, stores it without the mark, and keeps the text's bold", () => {
    const pasted = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "elso", marks: [{ type: "bold" }] },
        { type: "hardBreak", marks: [{ type: "bold" }] },
        { type: "text", text: "masodik", marks: [{ type: "bold" }] },
      ],
    });
    for (const kind of ["TEXT", "TERMS", "SECTION"] as const)
      assert.deepEqual(
        blockContent(kind, pasted),
        doc({
          type: "paragraph",
          content: [
            { type: "text", text: "elso", marks: [{ type: "bold" }] },
            { type: "hardBreak" },
            { type: "text", text: "masodik", marks: [{ type: "bold" }] },
          ],
        }),
      );
  });

  for (const [name, value] of [
    [
      "a mark on a paragraph",
      doc({ type: "paragraph", marks: [{ type: "bold" }] }),
    ],
    [
      "a mark on a list item",
      doc({
        type: "bulletList",
        content: [
          { type: "listItem", marks: [{ type: "bold" }], content: [para("x")] },
        ],
      }),
    ],
    [
      "a non-array mark list on a line break",
      doc({
        type: "paragraph",
        content: [{ type: "hardBreak", marks: "bold" }],
      }),
    ],
  ] as Array<[string, unknown]>)
    it(`still refuses ${name}`, () => {
      assert.throws(() => richTextInput(value), { status: 400 } as object);
    });

  // what a paste or a shortcut could bring in: none may reach the stored JSON
  for (const [name, value] of [
    [
      "heading without attributes",
      doc({ type: "heading", content: [{ type: "text", text: "x" }] }),
    ],
    [
      "heading",
      doc({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "x" }],
      }),
    ],
    ["blockquote", doc({ type: "blockquote", content: [para("x")] })],
    ["underline mark", doc(para("x", [{ type: "underline" }]))],
    [
      "link mark",
      doc(para("x", [{ type: "link", attrs: { href: "https://x.test" } }])),
    ],
    [
      "an extra attribute",
      doc({ ...para("x"), attrs: { style: "color:red" } }),
    ],
    ["a non-doc root", para("x")],
    ["a link mark without attributes", doc(para("x", [{ type: "link" }]))],
    [
      "an attribute on an allowed mark",
      doc(para("x", [{ type: "bold", attrs: { x: 1 } }])),
    ],
  ] as const)
    it(`rejects ${name}`, () => {
      assert.throws(() => richTextInput(value), { status: 400 } as object);
    });
});

describe("quote block content", () => {
  it("IMAGE is not creatable in P1; a page break has no content", () => {
    assert.throws(() => blockContent("IMAGE", null), { status: 400 } as object);
    assert.equal(blockContent("PAGE_BREAK", undefined), Prisma.DbNull);
    assert.throws(() => blockContent("PAGE_BREAK", doc()), {
      status: 400,
    } as object);
  });
  it("TEXT needs text, SECTION may be empty", () => {
    assert.throws(() => blockContent("TEXT", null), { status: 400 } as object);
    assert.equal(blockContent("SECTION", null), Prisma.DbNull);
  });
});

describe("quote decimals and milestones", () => {
  it("a quantity must be positive and within the column", () => {
    assert.equal(quantityInput("1,5").toString(), "1.5");
    assert.throws(() => quantityInput("0"), { status: 400 } as object);
    assert.throws(() => quantityInput("1.1234567"), { status: 400 } as object);
  });
  it("milestones sum to exactly 100", () => {
    assert.equal(
      milestonesInput([
        { label: "Előleg", percent: "30" },
        { label: "Átadás", percent: "70" },
      ]).length,
      2,
    );
    assert.throws(() => milestonesInput([{ label: "Előleg", percent: "30" }]), {
      status: 400,
    } as object);
  });
  it("only a PAYMENT snippet carries milestones, and it must", () => {
    assert.equal(snippetMilestones("TEXT", undefined), Prisma.DbNull);
    assert.throws(
      () => snippetMilestones("TEXT", [{ label: "a", percent: "100" }]),
      { status: 400 } as object,
    );
    assert.throws(() => snippetMilestones("PAYMENT", []), {
      status: 400,
    } as object);
    assert.deepEqual(
      snippetMilestones("PAYMENT", [{ label: "Egy", percent: "100" }]),
      [{ label: "Egy", percent: "100" }],
    );
  });
});

describe("quote template JSON (decision 1)", () => {
  it("copies text blocks and milestones through the editor's rules", () => {
    const t = templateInput({
      blocks: [
        { kind: "TEXT", title: " Bevezető ", content: doc(para("x")) },
        { kind: "PAGE_BREAK" },
      ],
      milestones: [{ label: "Egy", percent: "100" }],
    });
    assert.equal(t.blocks[0]!.title, "Bevezető");
    assert.equal(t.blocks[1]!.content, Prisma.DbNull);
    assert.equal(t.milestones.length, 1);
  });
  it("a broken template is a 400, not a half-built quote", () => {
    assert.throws(
      () => templateInput({ blocks: [{ kind: "VIDEO" }], milestones: [] }),
      { status: 400 } as object,
    );
    assert.throws(
      () =>
        templateInput({
          blocks: [{ kind: "TEXT", content: doc({ type: "heading" }) }],
          milestones: [],
        }),
      { status: 400 } as object,
    );
    assert.throws(() => templateInput({ blocks: {}, milestones: [] }), {
      status: 400,
    } as object);
  });
});
