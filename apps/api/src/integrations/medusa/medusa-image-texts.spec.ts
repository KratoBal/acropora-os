import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  imageTextsFor,
  imageTextsMetadataPatch,
  imageTextsMetadataValue,
} from "./medusa-image-texts.js";

describe("imageTextsFor", () => {
  it("pairs the published urls with the rows by index, trimmed", () => {
    assert.deepEqual(
      imageTextsFor(
        ["https://m/1.jpg", "https://m/2.jpg"],
        [
          { altText: "  Pumpa elolrol ", title: null },
          { altText: "   ", title: "Cim" },
        ],
      ),
      [
        { url: "https://m/1.jpg", alt: "Pumpa elolrol", title: null },
        { url: "https://m/2.jpg", alt: null, title: "Cim" },
      ],
    );
  });

  it("gives null for no list, and for a length mismatch", () => {
    assert.equal(imageTextsFor(null, []), null);
    assert.equal(
      imageTextsFor(
        ["https://m/1.jpg"],
        [
          { altText: "a", title: null },
          { altText: "b", title: null },
        ],
      ),
      null,
    );
  });
});

describe("imageTextsMetadataValue", () => {
  it("keeps only images with text, in order", () => {
    assert.equal(
      imageTextsMetadataValue([
        { url: "u1", alt: null, title: null },
        { url: "u2", alt: "b", title: null },
        { url: "u3", alt: null, title: "c" },
      ]),
      JSON.stringify([
        { url: "u2", alt: "b", title: null },
        { url: "u3", alt: null, title: "c" },
      ]),
    );
  });

  it("is null when no image has text", () => {
    assert.equal(
      imageTextsMetadataValue([{ url: "u1", alt: null, title: null }]),
      null,
    );
    assert.equal(imageTextsMetadataValue([]), null);
  });
});

describe("imageTextsMetadataPatch", () => {
  it("null list keeps the existing string value, and nothing else", () => {
    assert.deepEqual(
      imageTextsMetadataPatch(null, { acropora_images: "[]x" }),
      { acropora_images: "[]x" },
    );
    assert.deepEqual(imageTextsMetadataPatch(null, { acropora_images: 5 }), {});
    assert.deepEqual(imageTextsMetadataPatch(null, null), {});
  });

  it("a list says the current state, even when it overrides the old one", () => {
    assert.deepEqual(
      imageTextsMetadataPatch([{ url: "u", alt: null, title: null }], {
        acropora_images: "regi",
      }),
      {},
    );
  });
});
