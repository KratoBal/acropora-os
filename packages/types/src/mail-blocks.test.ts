import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  misplacedBlockVariables,
  renderMailTemplateWithBlocks,
  type MailRenderSteps,
} from "./mail-blocks.js";

/*
  The real steps (`sanitizeRichHtml`, `richHtmlToText`) live in
  `@acropora/rich-text`, which this package does not depend on. These stand-ins
  keep the shape that matters here: paragraphs become text blocks separated by
  an empty line. The full pipeline with the real sanitizer is asserted in the
  API (`webshop-mail.render.spec.ts`).
*/
const steps: MailRenderSteps = {
  sanitize: (html) => html,
  toText: (html) =>
    [...html.matchAll(/<p>(.*?)<\/p>/g)]
      .map((m) => (m[1] as string).replace(/<[^>]*>/g, ""))
      .join("\n\n"),
};

const ITEMS = {
  html: '<ul style="margin:0"><li>Só × 1: 14&nbsp;000 Ft</li></ul>',
  text: "- Só × 1: 14 000 Ft",
};

describe("renderMailTemplateWithBlocks", () => {
  it("puts the block where its paragraph stood, unescaped, in HTML and text", () => {
    const out = renderMailTemplateWithBlocks(
      '<p>Szia {{nev}}!</p><p><span data-variable="tetelek">{{tetelek}}</span></p><p>Vége</p>',
      { nev: "<Anna>" },
      { tetelek: ITEMS },
      steps,
      "n1",
    );
    assert.deepEqual(out, {
      ok: true,
      html: `<p>Szia &lt;Anna&gt;!</p>${ITEMS.html}<p>Vége</p>`,
      text: "Szia &lt;Anna&gt;!\n\n- Só × 1: 14 000 Ft\n\nVége",
    });
  });

  it("a block that is not in this mail leaves no paragraph and no empty line", () => {
    const out = renderMailTemplateWithBlocks(
      "<p>Eleje</p><p>{{pont}}</p><p>Vége</p>",
      {},
      { pont: null },
      steps,
      "n2",
    );
    assert.deepEqual(out, {
      ok: true,
      html: "<p>Eleje</p><p>Vége</p>",
      text: "Eleje\n\nVége",
    });
  });

  it("a block inside a sentence is refused, not rendered", () => {
    const out = renderMailTemplateWithBlocks(
      "<p>A tételek: {{tetelek}}</p>",
      {},
      { tetelek: ITEMS },
      steps,
      "n3",
    );
    assert.deepEqual(out, { ok: false, unknown: [], misplaced: ["tetelek"] });
  });

  it("an unknown variable is still refused, next to the blocks", () => {
    const out = renderMailTemplateWithBlocks(
      "<p>{{tetelek}}</p><p>{{nincs_ilyen}}</p>",
      {},
      { tetelek: ITEMS },
      steps,
      "n4",
    );
    assert.deepEqual(out, {
      ok: false,
      unknown: ["nincs_ilyen"],
      misplaced: [],
    });
  });

  /*
    A value is customer data (a name, a note). Even one that spells a block
    placeholder or the marker must stay text: the marker is random per render,
    and the block placeholders are resolved before the values go in.
  */
  it("a value can neither spell a block nor its marker", () => {
    const out = renderMailTemplateWithBlocks(
      "<p>{{nev}}</p><p>{{tetelek}}</p>",
      { nev: "{{tetelek}} ACROPORABLOCKn5N0X" },
      { tetelek: ITEMS },
      steps,
      "n5",
    );
    assert.equal(out.ok, true);
    assert.equal(
      out.ok && out.html,
      `<p>{{tetelek}} ACROPORABLOCKn5N0X</p>${ITEMS.html}`,
    );
  });
});

describe("misplacedBlockVariables", () => {
  it("names only the blocks that share a paragraph with something", () => {
    assert.deepEqual(
      misplacedBlockVariables(
        '<p data-align="center">{{a}}</p><p>x {{b}}</p><p><strong>{{c}}</strong></p>',
        ["a", "b", "c", "d"],
      ),
      ["b", "c"],
    );
  });
});
