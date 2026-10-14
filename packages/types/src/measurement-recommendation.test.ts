import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasMalformedRecommendationToken,
  parseRecommendationText,
  recommendationBlocks,
  recommendationProductIds,
} from "./measurement-recommendation.js";

describe("parseRecommendationText (2b3983e1)", () => {
  it("RECO-PARSE: text and product tokens in order; a malformed token stays text", () => {
    assert.deepEqual(
      parseRecommendationText(
        "A KH alacsony: {{termek:cmp1}} segít, vagy {{termek:cmp-2_x}}. {{termek:}} {{termek:a b}}",
      ),
      [
        { kind: "text", text: "A KH alacsony: " },
        { kind: "product", productId: "cmp1" },
        { kind: "text", text: " segít, vagy " },
        { kind: "product", productId: "cmp-2_x" },
        { kind: "text", text: ". {{termek:}} {{termek:a b}}" },
      ],
    );
    assert.deepEqual(parseRecommendationText(""), []);
    assert.deepEqual(parseRecommendationText("{{termek:x}}"), [
      { kind: "product", productId: "x" },
    ]);
  });

  it("RECO-IDS: each referenced product once, in first-seen order", () => {
    assert.deepEqual(
      recommendationProductIds(
        "{{termek:b}} és {{termek:a}}, majd {{termek:b}}",
      ),
      ["b", "a"],
    );
  });

  it("RECO-MALFORMED: a brace left after the real tokens is malformed", () => {
    assert.deepEqual(
      [
        "Jó: {{termek:abc}} és {{termek:x-1}}.",
        "Szóköz: {{termek: abc}}",
        "Ékezet: {{termék:abc}}",
        "Keret: {{ termek:abc }}",
        "Csonka: {{termek:abc",
        "Fél: termek:abc}}",
        "Semmi kapcsos.",
      ].map(hasMalformedRecommendationToken),
      [false, true, true, true, true, true, false],
    );
  });
});

/*
  A TAGOLÁS (Balázs, 2026-10-14: Vélemény, Javaslat, Ajánlott termékek). MI
  PIROSÍT: ha a három cím (kettősponttal, markdown-jelöléssel vagy anélkül) nem
  lesz fejléc; ha egy „Javaslatunk szerint …” mondat fejléc lenne; ha a „- ”
  sorok nem listát adnak, vagy a lista a termék-hivatkozást elveszíti; ha az üres
  sor nem választ bekezdést; ha egy régi, tagolatlan szöveg nem egy bekezdés marad.
*/
describe("recommendationBlocks", () => {
  const blocks = (text: string) =>
    recommendationBlocks(parseRecommendationText(text));

  it("RECO-BLOCKS: the three headings, paragraphs and a product list", () => {
    const text = [
      "Vélemény:",
      "A KH alacsony.",
      "A kalcium rendben van.",
      "",
      "**Javaslat:** Emelje lassan a KH-t.",
      "",
      "## Ajánlott termékek",
      "- {{termek:p1}}: a KH emeléséhez",
      "• {{termek:p2}}",
    ].join("\n");
    assert.deepEqual(blocks(text), [
      { kind: "heading", text: "Vélemény" },
      {
        kind: "paragraph",
        lines: [
          [{ kind: "text", text: "A KH alacsony." }],
          [{ kind: "text", text: "A kalcium rendben van." }],
        ],
      },
      { kind: "heading", text: "Javaslat" },
      {
        kind: "paragraph",
        lines: [[{ kind: "text", text: "Emelje lassan a KH-t." }]],
      },
      { kind: "heading", text: "Ajánlott termékek" },
      {
        kind: "list",
        items: [
          [
            { kind: "product", productId: "p1" },
            { kind: "text", text: ": a KH emeléséhez" },
          ],
          [{ kind: "product", productId: "p2" }],
        ],
      },
    ]);
  });

  it("RECO-BLOCKS-PLAIN: an old unsectioned text stays one paragraph; a sentence starting with a heading word is not a heading", () => {
    assert.deepEqual(blocks("Javaslatunk szerint {{termek:p1}} segít."), [
      {
        kind: "paragraph",
        lines: [
          [
            { kind: "text", text: "Javaslatunk szerint " },
            { kind: "product", productId: "p1" },
            { kind: "text", text: " segít." },
          ],
        ],
      },
    ]);
    // két bekezdés üres sorral; kis- és nagybetű, ékezet nélküli cím is cím
    assert.deepEqual(
      blocks("ajanlott termekek:\n{{termek:p1}}\n\nEgy.\nKettő."),
      [
        { kind: "heading", text: "Ajánlott termékek" },
        { kind: "paragraph", lines: [[{ kind: "product", productId: "p1" }]] },
        {
          kind: "paragraph",
          lines: [
            [{ kind: "text", text: "Egy." }],
            [{ kind: "text", text: "Kettő." }],
          ],
        },
      ],
    );
    assert.deepEqual(blocks(""), []);
  });
});
